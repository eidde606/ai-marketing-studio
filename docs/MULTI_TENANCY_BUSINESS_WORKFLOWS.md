# Slice 4 — Business, draft, and campaign authorization

Base: `17baadd2eeacc4defc5bf6bf7a8622782b35fb76`.
No migrations, ownership backfills, or production access.

## Migrated entry points

All existing businesses, drafts, and campaigns routes receive the existing
`get_authenticated_principal` dependency. They retain `verify_token`, JWT checks,
and ALLOWED_USER_ID. Application services call the existing access policy before
using TenantAccess and scoped persistence. No HTTP route queries a repository.

- GET /businesses lists only active memberships of the active application user.
  Other users' businesses and legacy businesses without verified ownership are
  absent. Creation is not triggered by reading or signing in.
- POST /businesses creates a new UUID business and an active owner membership for
  its authenticated creator in one transaction. Supplied resource IDs cannot pick
  an existing business. The repository accepts transient records only and uses
  INSERT, not upsert/merge. Failure rolls back both records. No existing business
  gains an owner through this workflow.
- Draft create/list require the selected business's membership and appropriate
  EDIT_CONTENT/READ permission. ID-only routes resolve only the business selector
  via a join to the actor's active membership and active user, then call the existing
  permission service before fetching/locking the draft. There is no unrestricted
  draft fetch followed by an authorization check in migrated routes.
- Draft edits and destinations require EDIT_CONTENT. Approval and rejection require
  APPROVE_CONTENT (Owner/Admin). Pending-only and completed-video eligibility checks
  remain. Members may soft-delete pending drafts; deleting non-pending content
  requires APPROVE_CONTENT. Existing Owner/Admin soft-delete/history/idempotency and
  in-progress operation exclusions remain.
- Campaign read/list require READ; create/update/delete/associate/disassociate require
  MANAGE_CAMPAIGNS (all three roles). Every referenced draft and campaign is scoped
  to the selected business. Existing validation, progress calculation, published
  history visibility, and association conflict responses remain.

Lists preserve the complete-array HTTP contract by consuming bounded repository
pages; results are not silently truncated to the first 100 rows. Campaign's existing
Spanish business-not-found response is retained for both unknown and inaccessible
businesses. Draft-ID requests use the same Draft not found response for foreign and
missing IDs. Active members lacking an operation permission receive 403.

## Transactions and revocation

Draft mutations lock the scoped draft, recheck current permission after the lock,
and apply conditional scoped SQL. Permission is checked again before commit, and
post-commit reads use freshly authorized scope. No provider call is introduced.

Campaign mutations lock the campaign before draft rows. Deletion locks associated
same-tenant drafts in stable ID order; association locks its target draft. Permission
is rechecked after those waits, before mutation and before commit. The existing
scoped repository lock calls then reacquire already held locks without introducing
another wait. Parent-first ordering is shared by these migrated workflows to avoid
association/deletion races and opposing lock order. Draft-only media workflows do
not acquire campaign locks. Database isolation remains PostgreSQL READ COMMITTED.

`rollback_on_failure` is an explicit service opt-in that releases locks and rolls
back pending writes on exceptions. Commits remain owned by each application workflow;
repositories neither commit nor roll back. A permission failure before commit cannot
leave writes pending for a direct caller to accidentally commit. Authorization is
not a promise that concurrent revocation can undo an operation already committed;
the last successful pre-commit check is the authorization decision for that write.

## Legacy inventory and deferred integrations

The guarded inventory changes from 123 to **112** operation pairs. It remains a
broad call inventory, not a vulnerability count: authentication bootstrap and
principal-filtered business listing/creation are intentionally present despite
being authorized contracts rather than single-tenant `_scoped` methods.

All migrated draft/campaign HTTP workflows use scoped resource operations. The two
old draft helpers `require_draft` and `require_pending_draft` remain exclusively for
`media.workflows_service._draft` and `_pending_draft`. A static guard prevents new
callers or use by migrated routes. Their repository edges remain in the inventory;
they have not been falsely counted as migrated.

OAuth, social publishing, analytics, AI conversations/generation, media/storage,
HeyGen, webhook, and background-task authorization remain for their planned slices.
Those endpoints still have known legacy gaps and must not be considered protected
by this slice simply because their underlying draft belongs to a business.
ALLOWED_USER_ID remains mandatory; multi-user admission stays disabled. The legacy
nullable-tenant records remain inaccessible through these new authorized workflows.
No ownership is inferred from that allowlist or a business name. Existing businesses
require an explicitly reviewed ownership manifest before users can see them here.

## Tests and rollout considerations

New workflow tests exercise the real access policy and repositories with explicitly
provisioned fixture identities/memberships. JWT verification alone is stubbed in
workflow fixtures; separate real-signature authentication tests still exercise the
production chain. Existing direct-DB business fixtures now explicitly grant their
intended owner's membership. No fixture installs an automatic membership hook and
no production fallback was added to satisfy tests.

Coverage includes Owner/Admin/Member behavior, suspended/revoked memberships,
filtered business lists, foreign/missing resource IDs, cross-business associations,
new-business ownership and rollback, approval restrictions, soft deletion, and
complete lists exceeding 100 rows. Disposable PostgreSQL tests revoke or demote an
actor while actual approval, campaign deletion, and association workflows wait on a
row lock; mutation is denied and transactions release their locks. Existing
PostgreSQL schema, repository isolation, and concurrency tests remain enabled.

A deployment would require the prior schema migrations and explicit provisioning
of the legitimate application user plus verified memberships. None is executed by
this slice. Invitations, billing, internationalization, frontend/Flutter changes,
RLS/composite-constraint migrations, and Slice 5 are outside this approval.
