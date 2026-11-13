# Backend closed-layer refactoring

Work stays on `refactor/backend-drafts-business`. No schema, frontend, provider
contract, deployment or production changes are part of this work.

## Dependency order

1. Businesses: service-owned transaction policy through explicit transaction mechanics.
2. Drafts: preserve atomic eligibility predicates and row locks in repositories.
3. Campaigns: typed application errors, explicit transaction policy, repository queries.
4. Instagram: service-owned connection policy and transaction boundaries.
5. Sofía/Leo: characterize conversation persistence/failures, then extract workflows.
6. Analytics: preserve business-scoped account lookup, provider error handling and response contracts.
7. Facebook OAuth: preserve the multi-stage state/handoff/page-selection contract.
8. TikTok token refresh: preserve expiry handling and token persistence.
9. Facebook/TikTok publishing: retain reservations, uncertain outcomes and verification.
10. Images/revisions/manual video: preserve advisory locks and cross-media reservations.
11. HeyGen: preserve attempts, idempotency, leases, webhook deduplication and reconciliation.
12. Composition root: finish router registration and architecture enforcement.

Each feature gets a separate local commit after relevant tests pass. Complete
offline backend tests run at milestones. Characterization tests precede complex
workflow moves. Tests may move their provider monkeypatch targets as ownership
changes; assertions and public HTTP contracts are retained.

## Boundary decisions

Routes own HTTP validation/translation and authentication dependencies. Services
own workflow and transaction policy. Repositories own queries, row locks, atomic
claims and persistence operations. Provider modules are integration adapters.

`app.transactions.Transactions` encapsulates commit/rollback/refresh mechanics;
services explicitly invoke it at the existing boundaries. It does not introduce
automatic commits, new sessions, retries, or a context-manager transaction.
SQLAlchemy entity objects remain shared internal data objects to preserve the
identity map and response serialization. Service assignment of entity fields is
application policy, while query construction and persistence commands belong in
repositories. Splitting ORM models or introducing duplicate DTOs is not required
for this migration and could change lazy loading/serialization behavior.

## Risks retained during structural work

Offline SQLite tests and simulated scheduling do not establish real PostgreSQL
row/advisory-lock correctness. No live provider, production database, or migration
validation is performed. Preserve existing statement and commit ordering rather
than redesigning concurrency or fixing product semantics during extraction.

## Progress

- Planning: inspected current feature services, route imports, repository behavior,
  test isolation, provider patch locations, and the existing architecture guardrail.
- Businesses: 32 focused tests passed; explicit transaction mechanics extracted.
- Drafts: 28 focused tests passed; lock/claim SQL and operation order unchanged.
- Campaigns: 23 focused tests passed, including commit-failure rollback; HTTP status
  mapping now belongs to routes, with typed application errors in the service.
- Instagram: 47 focused tests passed before and after extraction. Service owns
  state-consumption commit and authorization-preservation decisions; repository
  owns only persistence. The second connection read remains after encryption to
  preserve the original ordering. No repository commits remain in these features.
- Sofía/Leo content and conversations: extracted from `main.py` into content
  routes, schemas, application services, repository queries, and provider
  adapters. Existing route paths, generation prompts, response shapes, and
  transaction ordering are retained. Characterization tests cover generated
  platform/destination behavior, conversation persistence, business isolation,
  provider failures, and rollback.
- Facebook analytics: extracted engagement and reach routes into a feature
  service/repository boundary while reusing the existing Facebook provider.
  Published-post eligibility, business-scoped connected-account lookup,
  provider error mapping, and response shapes remain unchanged. Baseline and
  post-extraction focused suites each passed 23 tests.
- TikTok OAuth/account listing: characterization tests passed before extraction.
  The feature now owns its routes, service workflow, SQL repository and provider
  adapter; state hashing/expiry and its consume-and-commit-before-provider-call
  ordering remain unchanged. Legacy route/provider modules are compatibility
  imports. Publishing and the `main.py` token-refresh orchestration remain
  outside this slice.
- Facebook OAuth/Page selection: added offline characterization for state
  issuance/consumption, provider failure, temporary Page handoff, user checks,
  reconnect, token secrecy and business-scoped listing. The feature now owns
  routes, schemas, service, repository and provider adapter. Facebook login
  configuration, callback URI, provider calls, Page-selection lock, and commit
  boundaries are unchanged; legacy root modules re-export feature entry points.
- TikTok token refresh: the five-minute expiry window, encrypted credential
  handling, refresh-token rotation, persistence commit and existing reconnect
  errors now live in the TikTok service/repository. The `main.py` helper only
  translates application errors for legacy publishing and verification routes;
  those publishing workflows remain the next slice.
- Facebook publishing and video verification: the existing mock-based
  characterization suite now exercises service-owned status transitions,
  atomic publication claims, media validation, uncertain outcomes, retry
  blocking, verification, manual reset and authentication. The endpoints,
  service workflow and query/claim repository are feature-owned; provider and
  storage adapters are reused. Existing transaction boundaries and response
  messages are preserved.
- TikTok publishing and verification: added offline characterization for
  business-scoped accounts, creator settings, MP4/storage validation, privacy
  filtering, atomic claim, ambiguous submission outcomes, duplicate blocking,
  status recovery and authentication. The video-only publishing workflow,
  verification endpoints, repository claims and provider adapter now belong to
  the TikTok feature. The existing unsupported-photo response and all
  transaction boundaries are retained.

`test_closed_layers.py` additionally rejects direct session operations in feature
routes/services, HTTPException construction in feature services, and commits or
rollbacks in repositories. Its exact module/function/operation baseline currently
contains only the pre-existing HeyGen generation service operations, scheduled
for step 9; resolved exceptions fail until removed. The original import guard
continues to prohibit every direct route-to-repository import.
