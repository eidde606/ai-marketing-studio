# Backend architecture guardrail

`test_architecture.py` enforces one incremental rule: HTTP route modules must
access repositories through application services, never import them directly.
It parses Python source with the standard-library AST parser and does not import
application modules, connect to the database, or call providers. No dependencies
are added.

Scope is discovered automatically under `backend/app`: `routes.py`,
`*_routes.py`, modules inside such route packages, and the legacy `app.main`
entry point. Repository dependencies are identified by module/package components
named `repository`, `repositories`, or ending in `_repository`. Keep these
conventions for new modules, or extend the detector and its tests when adding a
new naming convention. Absolute and relative imports, aliases, imported symbols,
wildcards from repository modules, and imports inside functions or conditional
blocks are checked. Service imports are allowed.

**Current baseline exceptions: none.** The two Instagram corrections removed the
remaining direct repository imports from feature routes. The explicit
`ROUTE_REPOSITORY_EXCEPTIONS` mapping is empty. Any future approved legacy
exception must specify an exact `(source_module, repository_module)` pair and a
nonempty reason, with the same pair documented here. Directory exclusions and
wildcard exceptions are not supported. When refactoring an excepted dependency,
remove its mapping and documentation in the same change: stale exceptions fail.
New dependencies outside those exact pairs also fail.

This first guardrail does not enforce service-to-repository boundaries, detect
direct SQL/ORM operations, trace dependencies through re-exports or services, or
resolve dynamic imports (`importlib`/`__import__`). A green result does not certify
the entire closed layered architecture.

The legacy service/repository inventory also permits five exact OAuth bootstrap
lookups. A callback has only an opaque state token, so it must read the stored
business and initiating identity before resolving current membership. These
lookups return metadata only; callbacks then re-resolve the active initiator,
require `MANAGE_CONNECTIONS`, and consume state through tenant-scoped repository
operations. Do not add OAuth credentials, account, draft, or publication reads to
this bootstrap exception.

Run it from `backend` using the existing environment:

```sh
../.venv/bin/python -B -m pytest tests/test_architecture.py -q -p no:cacheprovider
```

The complete `pytest tests` suite includes both the repository scan and focused
detector tests for prohibited imports, compliant imports, and exact/stale baselines.

# Phase 0: automated testing baseline

This phase adds tests and test-only setup. It intentionally preserves production
code, API contracts, prompts, database schema, migrations, and configuration.
Branch: `refactor/modular-monolith`, based on fetched `origin/develop` at
`f0181a36d1fed7633f17d13497d9a871fc97b7a9`.

## Run the checks

Use the existing development dependencies. From the repository root:

```sh
cd backend
../.venv/bin/python -B -m pytest tests -q -p no:cacheprovider
```

From `frontend`:

```sh
npm test -- --no-file-parallelism
./node_modules/.bin/tsc --noEmit --incremental false
```

The original baseline had 43 passing backend cases and one passing frontend
case. One original Facebook success test had no assertions, so that green result
did not prove successful publication. Parameterized cases count as individual
tests; a larger count is not a coverage percentage.

Phase 0 verification results:

| Check | Result |
| --- | --- |
| Full backend suite | 80 passed, one existing Starlette deprecation warning |
| Full frontend suite | 5 passed |
| TypeScript, no emit | Passed |
| ESLint for `CampaignsPage.test.tsx`, JSON formatter | No errors or warnings |
| `git diff --check` | Passed |

No live API or PostgreSQL concurrency validation was performed. The existing
repository-wide lint findings from the audit are outside this test-only change.

## Isolation and external services

`conftest.py` supplies test-process environment values before importing the app:
an in-memory SQLite URL, fake Supabase/OpenAI/HeyGen credentials, and a fake
authorized user. It disables dotenv loading, so repository `.env` files are not
loaded. No environment files or production settings are edited. The installed
python-dotenv supports `PYTHON_DOTENV_DISABLED`; retain that support when changing
development dependencies.

An automatic fixture blocks HTTPX network transports and socket connection calls
during tests. It also checks attempted requests at teardown, so a caught provider
exception cannot hide an accidental network call. FastAPI's in-process test
transport still works. Each new route test gets fresh SQLite tables, enabled
foreign keys, and restored dependency overrides after cleanup. Existing suites
retain their own isolated database fixtures.

Publishing tests mock Facebook submission, verification, token decryption and
storage access. AI tests mock SDK responses rather than contacting OpenAI.
Frontend tests mock the campaign and draft API modules, block `fetch`, clean up
rendered components, and restore spies between cases. No publishing or paid AI
request is needed for this baseline.

## What the tests protect

### Facebook publishing

The completed success test checks the HTTP response, exact provider arguments,
stored publication ID, timestamp and publication status. It then submits again
and checks that no second provider call occurs.

Additional cases cover:

- Image response IDs: prefer `post_id`, falling back to `id`.
- Text/image/video timeouts, absent IDs, HTTP 429, 500 and 503: return 502,
  persist `needs_review`, and reject resubmission without a second provider call.
- Explicit HTTP 400/401/403 rejection: return 502 and restore `not_published`.
  These cases document the existing distinction between rejection and uncertainty.
- Storage failure or invalid image bytes: restore `not_published` without
  contacting Facebook.
- Video submission: store the ID but remain in review until verification reports
  `ready`. Processing is not publication. Once published, verification does not
  contact the provider again.

Reading records through a new database session proves persistence rather than
only checking an in-memory object or a successful HTTP response.

### AI platform and publishing destinations

The tests call both generation endpoints with mocked Sofía and Leo SDK responses.
They check two calls in order, the current model and output platform enum, saved
content, business scoping, conversation instructions, pending status and the
absence of publication IDs or automatic campaign assignment.

Current behavior, deliberately left unchanged:

| Generated platform | Automatic generation destination | Conversation generation destination |
| --- | --- | --- |
| `Facebook` | `facebook` | `facebook` |
| `TikTok` | `facebook` | `facebook` |
| `Instagram` | `facebook` | `facebook` |
| `tiktok` (synthetic boundary input) | `tiktok` | `facebook` |

The AI output schema uses title-case names. The automatic route only recognizes
lowercase `facebook`/`tiktok` for destinations; the conversation route uses the
model's Facebook default. Lowercase `tiktok` is a mocked route-boundary case, not
an output allowed by the current AI schema. These are characterization tests:
they record what exists, not a recommendation for the desired product behavior.
An intentional future correction should change these expectations in its own PR.

### Campaign deletion UI

The existing cancellation test is retained. New cases verify that:

- Successful deletion removes the campaign and closes its editor, selects a
  remaining campaign, and makes preserved content available for reassociation.
- Deleting the last campaign shows the empty state and Spanish success message.
- A failed request leaves the campaign, form and association intact, displays a
  Spanish error, and permits a successful retry.
- A pending request leaves the campaign visible and prevents duplicate submission.

These tests verify frontend behavior with mocked data. Existing backend campaign
deletion tests separately verify that stored drafts and publication history survive.

## Remaining gaps and future regression checks

- SQLite does not verify PostgreSQL row locks or advisory locks. Sequential
  duplicate-submit tests do not prove concurrent publishing safety.
- Provider mocks do not prove live Facebook/TikTok integration compatibility.
- OAuth expiry/replay, real JWT cryptographic validation, token refresh races,
  TikTok publishing outcomes, image-generation races, and HeyGen completion still
  need dedicated coverage.
- Database commit failures and process interruption after an external submission
  are not simulated here.
- Business switching during pending frontend mutations and broader approval/media
  UI interactions remain untested.
- No production database, migration, browser end-to-end, deployment, or live paid
  API checks are included.

Before each future refactoring PR, run the affected tests, then the relevant full
suites and TypeScript check. Add PostgreSQL concurrency tests before moving
publication claims or transaction boundaries. Keep behavior fixes separate from
structural refactoring, and preserve existing Spanish messages and API responses.

The baseline environment reports a Starlette warning about its HTTPX TestClient
integration. No dependency changes are part of Phase 0.
