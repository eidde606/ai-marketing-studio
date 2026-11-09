# Campaign Management: Phase 2

This is a structural refactor of Campaign Management. It retains the existing
API, database entities, Spanish UI, publication rules and deployment entry point.

## Backend: follow a request

`React → campaignsApi → apiClient → campaign routes → service → repository → database`

The same SQLAlchemy session is passed through the layers. There is no new session,
framework, generic repository class, dependency injection container, or worker.

| File under `backend/app/` | Responsibility |
| --- | --- |
| `campaign_routes.py` | Re-exports the router at the existing import path so `main.py` stays unchanged. |
| `features/__init__.py`, `features/campaigns/__init__.py` | Mark the feature packages; no initialization side effects. |
| `features/campaigns/routes.py` | Keeps all seven endpoint operations, authentication dependency, request parsing and HTTP error translation. |
| `features/campaigns/schemas.py` | Keeps the existing Pydantic create/update validators; documents response dictionary shapes with TypedDict. |
| `features/campaigns/service.py` | Coordinates create/edit/delete/association workflows, checks rules, calculates progress and builds response dictionaries. Owns commits and refreshes. |
| `features/campaigns/repository.py` | Contains SQLAlchemy lookups, eager loading, business filters, ordering, row locking, insertion and unlink/deletion operations. Never commits. |

For example, deleting a campaign works as follows:

1. The route receives the business and campaign IDs after the existing token check.
2. The service asks the repository to find that campaign within that business.
3. The repository unlinks that business's drafts and marks the campaign for deletion.
4. The service commits once, exactly as before.
5. The existing Spanish success message returns to React. Drafts, approvals,
   soft-delete flags and publication history remain stored.

`CampaignError` is one small exception carrying the existing status and message.
Routes convert it to FastAPI's HTTPException. Unexpected errors still propagate
as before; this refactor does not add a global error handler or new error policy.

Response TypedDicts are type documentation, not new runtime validators. Adding
FastAPI response models could change OpenAPI, serialization or legacy-data error
behavior. Routes intentionally retain the existing dictionary serialization.
The complete generated OpenAPI document was compared before and after extraction.

## Backend invariants retained

- Same methods, paths, route function names, create status 201 and other statuses.
- Same authorized-user dependency and business-specific queries.
- Same whitespace trimming, explicit-null rejection and partial-date validation.
- Same campaign ordering and case-insensitive content ordering with ID tie-breaks.
- Same eager loading on campaign lists and existing detail loading behavior.
- Same commits, refreshes and row lock for draft associations; no repository commits.
- Same campaign deletion transaction: unlink drafts and delete campaign together.
- A published platform status plus its ID is required for campaign progress.
- A draft published to both platforms counts once. Approval, copy, download and
  timestamps alone do not count. Rejected drafts remain pending for progress.
- Deleted unpublished drafts are excluded; confirmed deleted publications remain.
- Cross-business content is excluded from campaign responses even if a bad
  association was previously stored.

## Frontend: one owner for state

The feature lives in `frontend/src/features/campaigns/`:

| File | Responsibility |
| --- | --- |
| `CampaignsPage.tsx` | Owns fetched campaigns/drafts, selected campaign, form values, selected draft, loading/busy/error/success state, API calls and mutation lock. |
| `CampaignForm.tsx` | Renders the controlled create/edit form, dates, status and save/cancel/delete buttons. Calls page callbacks. |
| `CampaignList.tsx` | Renders campaign summaries, selection and server-provided progress. Reports the selected ID. |
| `CampaignDetails.tsx` | Renders the selected campaign, progress explanation and associated content; reports edit/detach actions. |
| `CampaignDraftAssociation.tsx` | Renders the eligible draft selector and associate button; reports selection/association actions. |
| `campaignLabels.ts` | Shares existing Spanish status labels and date formatting. |

`components/CampaignsPage.tsx` re-exports the feature page so App and existing tests
keep their import paths. The Phase 1 API service remains at its existing path.
No other API services or application components are migrated.

The children are controlled components: they receive values and report actions;
they do not fetch data or maintain duplicate campaign state. The page composes
association controls inside the details component using `children`, so details
need not pass selection state through another layer. No custom hook or context is
needed. Existing CSS classes, element structure, labels, IDs, confirmations and
busy/disabled behavior are preserved.

## Regression tests

Three new backend cases were run against the old implementation before extraction:

- Exact response fields, ordering and cross-business content filtering.
- Existing Spanish error details and HTTP status codes.
- Simulated commit failure during deletion: the request session rolls back both
  the draft unlink and campaign deletion.

Six new frontend cases also passed before extraction:

- Create with trimmed text, selected status and dates.
- Edit/archive and clear dates while retaining the objective.
- Cancel without saving.
- Associate/detach and display server progress without changing publication state.
- Select another campaign and refresh its progress.
- Retain form values when saving fails.

The five Phase 0 deletion UI tests and the Phase 1 API contract/client tests remain.
Backend tests use isolated SQLite and block outbound requests. Frontend tests mock
API services or fetch. No live publishing or paid AI service is contacted.

## Limits

SQLite tests do not prove PostgreSQL concurrency or advisory-lock behavior. Query
and transaction structure are preserved, but simultaneous production requests
were not exercised. No browser screenshot, live authentication/CORS, migration,
or deployment check was performed. Existing business-switch lifecycle behavior is
unchanged; additional race tests would be needed before altering it.

Backend request validation remains runtime Pydantic validation; response types
are not runtime validation. The project has no configured backend lint command.
Frontend project-wide lint has existing unrelated findings in App.tsx and the
shared button/badge components. They are outside this refactor.
