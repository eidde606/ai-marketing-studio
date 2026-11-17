# Slice 3 — Tenant-scoped persistence contracts

Base: `5a63ffd8da17b552b32eb6b592a79a70c0bed18f` on
`feature/multi-tenant-foundation`. No schema changes or data backfill.

## Scope and authorization

New feature repository functions end in `_scoped` and require `(db, context, ...)`,
where context is a `TenantAccess` returned by the access application service. There
is no optional tenant, default tenant, environment-based tenant, or raw-business-ID
fallback. A client-selected business ID is **not** an authorized context.

```python
# Application service, after authenticated-principal resolution:
context = require_permission(db, principal, requested_business_id, Permission.PUBLISH)
draft = repository.get_draft_scoped(db, context, draft_id)
# Check workflow eligibility, then use a scoped atomic mutation.
```

Repositories do not authenticate users or decide permissions. TenantAccess is an
internal value, not a cryptographically unforgeable capability. Services must not
construct it from request data, cache it between requests, or skip authorization
when calling a new repository API. Membership must be rechecked at the appropriate
service boundary, including after long waits/provider work.

Shared SQL mechanics live in `app/persistence/tenant.py`; only repositories may
import them. Routes cannot import either repositories or persistence helpers.
Existing provider adapters, JWT verification, and ALLOWED_USER_ID are unchanged.

## Contracts

| Feature repository | New scoped operations |
| --- | --- |
| businesses | Read the authorized business |
| drafts | Get/lock, paginated list/history, transient insert, conditional field/status update, atomic soft delete |
| campaigns | Get/list with tenant-filtered drafts, tenant-only count, transient insert, field update, atomic association, unlink/delete |
| content | Conversation get/list/insert; message list/insert through a tenant-owned parent |
| analytics | Scoped draft access reused from drafts; tenant-connected Facebook account |
| facebook | Account get/list/insert/update; draft getter reused; publication claim/reset/result persistence; OAuth insert/consume; handoff read/lock/delete |
| tiktok | Account get/list/insert, conditional credential refresh; draft getter reused; publication claim/result persistence; OAuth insert/consume |
| instagram | Connection get/insert/update; OAuth insert/consume with tenant/Page relationship checks |
| media | Revision get/list/insert/conditional updates; revision advisory lock; image reservation/failure/save/reset; draft media update; HeyGen attempt get/latest/insert/update and draft-before-attempt locking |

Reads return None/empty results for foreign IDs. Mutations return False/None if
scope, resource, or expected-state predicates do not match. Invalid contexts or
unsupported field dictionaries raise TypeError/ValueError; routes must not expose
these internal APIs directly. Services retain HTTP error translation and workflow
policy. State-update methods do not themselves grant approval/publishing authority.

All mutations include tenant predicates in SQL. Child records without business_id
(image revisions/messages) use a parent EXISTS predicate. HeyGen attempts require
both their own business and their draft's business to match. TikTok claims verify
that the selected connected TikTok account belongs to the same tenant. Campaign
associations verify both campaign and draft, without treating either ID as proof.

Insert helpers accept only supported **transient** ORM records, reject supplied
business IDs that disagree with context, and reject ORM relationship graphs. They
use INSERT ... SELECT with scoped parent predicates, rather than adding arbitrary
ORM instances to the Session. They return the inserted key; they do not populate
or attach the caller's transient object. Fetch the result through a scoped getter.
Identity/ownership records and business creation are intentionally not supported
by this helper. No existing null-tenant records are assigned a tenant.

New pagination has a stable secondary ID ordering, a 1–100 row limit, and a
nonnegative offset. Tenant predicates apply before limiting/counting. Campaign
counts exclude soft-deleted drafts; they are not a replacement for the existing
service's published-history progress calculation.

## Existing behavior preserved

Existing publication, soft-delete, and image/revision mutation predicates were
extracted into shared statement builders. Legacy and scoped entry points use the
same builders; the new entry point adds the tenant predicate. No transaction
commit/rollback moved into repositories. No provider calls changed.

Legacy campaign get/list now filter the loaded draft relationship by business;
legacy campaign deletion now includes business in the DELETE predicate instead of
an unrestricted ORM delete. This strengthens existing callers without assuming
that their business selectors have already passed membership authorization.

The new revision lock uses the same advisory key as existing workflows. A foreign
resource is filtered out before calling the lock function. HeyGen locks remain
ordered draft first, attempt second. Expected statuses/generation IDs/timestamps
remain conditions on atomic lifecycle writes; leases and lifecycle decisions stay
in services. New scoped methods do not change the existing job scheduling model.

Scoped entity reads use raiseload to prevent new unscoped lazy relationship queries
and refresh existing cached entity state. Campaign reads explicitly load only
same-tenant children. Services should use a clean operation Session and flush any
intended pending changes before a refresh-capable scoped read. Do not use arbitrary
ORM relationship traversal, db.get, or refresh as a substitute for a scoped API.
These APIs are not a global SQLAlchemy identity-map/flush firewall: later direct
ORM mutations remain an explicitly tracked migration gap.

## Remaining legacy callers

`backend/tests/legacy_repository_calls.json` records all 123 current legacy
service-function/repository-operation pairs (with call counts). A static test
requires an exact match: new legacy edges, count increases, and stale entries fail.
This inventory includes already business-filtered legacy functions as well as
unscoped functions; it is deliberately broader than a list of vulnerabilities.
No feature service has been falsely upgraded by manufacturing TenantAccess from
its current business_id argument. Existing services lack the approved membership
and permission integration needed to call the new contracts safely.

| Caller module(s), under app/features | Remaining operations and migration reason |
| --- | --- |
| businesses/service.py | Global list and business insert; user-filtered listing and atomic owner creation need Slice 4 plus verified ownership |
| drafts/service.py | ID-only require/lock/delete and ORM edits/status changes; principal/permission integration belongs to Slice 4 |
| campaigns/service.py | Business selectors and ORM updates/associations; SQL child loading/delete tightened now, authorization still pending |
| content/service.py | Business selectors, parent-object message access, ORM inserts; needs authenticated AI/conversation context integration |
| analytics/service.py | Draft lookup by ID, then account by business; needs authorized draft context |
| facebook/service.py | OAuth state/handoff bootstrap, connection selection, direct credential updates; callback membership revalidation is not a repository-only change |
| facebook/publishing_service.py | ID-only drafts, claim/reset, ORM publication state changes; needs permission and resource context across provider calls |
| tiktok/service.py, publishing_service.py | OAuth token bootstrap, credential mutation, draft lookup/publication state; needs trusted callback identity and tenant-aware refresh/publishing orchestration |
| instagram/service.py | Business selector and connection object mutation; needs current membership checks throughout callback completion |
| media/workflows_service.py | ID-only drafts/revisions, ORM media changes, upload/provider operations; needs authorized media context before storage/provider work |
| media/generation_service.py | ID-only attempt recovery, lease/storage attachment, provider-video resolution, webhook ingress/deduplication; needs explicit trusted system context plus user-context integration |

OAuth state-hash and signed-webhook/provider-ID resolution are special bootstrap
operations: their purpose is to resolve trusted tenant context. They must not be
converted by accepting an arbitrary callback business ID. Unmatched webhook
records have no business column; no pretend tenant-scoped delivery API was added.
Those system paths remain restricted legacy operations for the integrations slice.

## Validation and limitations

SQLite tests cover foreign-ID reads/updates/deletes, corrupt campaign relationships,
message/revision parent scoping, scoped inserts, social credentials, OAuth replay
and actor binding, publication claims, media recovery, cached objects, pagination,
counts, rejected tenant reassignment, and storage paths.

Disposable PostgreSQL tests use the actual migration history and verify:

- INSERT ... SELECT and scoped parent/message queries against PostgreSQL.
- Foreign row/advisory locks do not block a caller operating in another tenant;
  lock_timeout makes accidental foreign locks fail the test.
- Two competing publication claims have exactly one winner and leave the other
  tenant's publication untouched.

The earlier PostgreSQL membership, migration, and revocation tests remain enabled
in the full suite. No test connects to an existing database or reads production
credentials. All clusters are created temporarily with Unix sockets only.

The current schema still permits some malformed cross-tenant foreign-key links.
Scoped APIs reject/hide them, but composite constraints and null-tenant cleanup
require verified data inventory and approved migrations. No RLS was added.
Background/webhook authorization, OAuth revocation, storage URL signing, private
HeyGen catalog access, and application-wide feature authorization remain pending.
**The application is not ready for multi-user admission. ALLOWED_USER_ID remains
mandatory.** No frontend, invitations, billing, internationalization, or Slice 4
work is included.
