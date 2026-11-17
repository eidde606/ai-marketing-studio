# Multi-tenancy foundation — Slice 1

Base: `2465578b106c537446ef39168a3546e37d718435` from origin/main.

This slice adds application users, memberships, and internal authorization policy.
It does **not** make the existing HTTP application multi-tenant safe. No existing
route, JWT validation, ALLOWED_USER_ID restriction, provider workflow, or frontend
contract changes. Do not enable multi-user access yet.

## Schema and identity

Migration `c2a41d8e930f` follows `b6d23e8a41c0` and creates only `app_users` and
`business_memberships`. Identities are unique by verified issuer and stable subject;
emails are not identity keys. Memberships are unique by business/user, with checked
roles (owner/admin/member) and statuses (active/suspended/revoked). Foreign keys
restrict orphaning through parent deletion. There is no membership default role.
Timestamps use timezone-aware columns. ORM changes maintain updated_at; direct SQL
maintenance must update that timestamp explicitly.

No user provisioning, ownership assignment, invitations, or backfill occurs in the
migration. Existing nullable drafts and business IDs remain unchanged. Initial
ownership and any existing-data repair require an explicitly approved manifest.

## Closed layers

Future routes pass verified identities to feature services. Feature services call
`access.service.require_permission`; its repository performs fresh active-user and
active-membership queries. A Principal is an internal trusted value, not a token
validator and never a request-body schema. TenantAccess is a request-local result,
not a reusable authorization cache. Resource-specific tenant ownership checks must
still be added to each feature in subsequent slices.

Membership mutations use their own service and repository. Services own commit and
rollback through Transactions. No new routes are exposed. Use a clean operation
session: membership mutation commits/rolls back that session. The shared ORM model
module is retained; no provider adapters are duplicated.

## Permissions

All active roles can read business content/analytics/connection status, edit pending
content and campaigns, use Sofía/Leo, generate/upload media, and submit for approval.
Admins and Owners can approve, publish (including retry/recovery), manage social
connections, edit the business profile, and manage Members. Only Owners manage
Admins/Owners or archive a business. Admins cannot promote Members to Admin/Owner,
modify another Admin, or modify Owners. A member can revoke their own membership
without changing role. Unknown permissions/roles fail closed.

AI permissions are separate policy entries to support future tenant usage limits.
No quotas, billing, or permission overrides are introduced now. Conversations and
generated content remain intended to be shared within a business.

No active membership (including absent or disabled user) produces the same
non-disclosing NOT_FOUND error as an unknown business. A visible business with an
insufficient role produces FORBIDDEN. Target memberships are always tenant-scoped.

## Last owner

Every existing-membership role/status mutation locks the business row, rechecks the
actor's authorization after the lock, and counts active Owners whose users remain
active. Removal, suspension, demotion, and self-departure cannot remove the last
active Owner. A successor can be promoted before the former Owner leaves.

This is an application-service invariant, not a database trigger. Future account
suspension/deletion, bulk changes, ownership bootstrap, and administrative tools
must use the same invariant and lock order. No account-disable service or endpoint
is exposed in this slice. Do not directly disable users with owner memberships.
Multi-business account lifecycle operations will need deterministic business lock
ordering. The lock/count algorithm assumes PostgreSQL READ COMMITTED (the current
application default); alternate isolation levels require explicit retry policy/tests.

## Validation

Offline focused tests:

```sh
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/test_tenant_foundation.py backend/tests/test_architecture.py backend/tests/test_closed_layers.py -q
```

Disposable PostgreSQL tests (requires installed initdb/pg_ctl/postgres):

```sh
RUN_ISOLATED_POSTGRES=1 PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/test_tenant_foundation_postgres.py -q
```

Optional `PG_BIN_DIR` selects the binary directory. Tests never accept a database
URL: they initialize an empty cluster inside a private temporary directory, listen
only on its Unix socket, and stop/remove the cluster afterward. They migrate the
actual Alembic history to the old head, validate upgrade and constraints, preserve
legacy records, exercise downgrade/re-upgrade, and race two last-owner departures.
No .env credentials or existing server are used.

Full regression suite:

```sh
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
```

PostgreSQL tests skip unless explicitly enabled. SQLite does not establish actual
row-lock correctness. Existing tests mock external providers.

## Deployment and rollback

No production migration is authorized or executed. When later approved: verify a
backup/restore, apply the additive migration, and retain the allowlist. The new
tables initially remain empty. Prefer an application rollback that retains these
tables. The migration downgrade drops identity/membership data and is appropriate
only for empty/disposable schemas or an explicitly reviewed recovery plan. It does
not delete existing businesses/drafts. Do not downgrade a populated production
identity schema without a backup and explicit approval.

### Local database recovery and ownership provisioning

Before any database change, confirm that the configured `DATABASE_URL` is the
intended non-production target. Record its redacted host/database identity, run
read-only `alembic current` and `alembic heads`, and inspect counts/IDs for
`businesses`, `drafts`, `app_users`, and `business_memberships`. Never infer the
database identity from a developer's shell or copy production credentials into a
local environment.

After separate approval, take and verify a restorable backup, then upgrade the
confirmed target to the reviewed Alembic head. The existing additive identity
migration creates `app_users` and `business_memberships` without populating
either table; the HeyGen asset migration likewise creates an empty access
registry. Neither migration assigns business ownership or classifies provider
assets.

Initial ownership must use a reviewed manifest mapping each exact business ID
to a verified auth issuer/subject and explicit `owner` role. Confirm that the
identity corresponds to the still-enforced `ALLOWED_USER_ID`, resolve or reject
businesses with missing/ambiguous ownership, and separately identify drafts
with null or invalid business IDs. Provision one application user per verified
identity, then the approved active membership rows. Validate all foreign keys
and that each in-scope business has exactly one intended active Owner before
enabling application traffic. Do not use email matching, create default
ownership, or backfill HeyGen stock/private asset records automatically.

## Deferred work

Slice 2 requires separate approval: integrate verified identities and membership
checks into existing application workflows while retaining ALLOWED_USER_ID. Later
slices scope resources, OAuth, publishing, media, jobs, analytics, and frontend.
Invitations and comprehensive audit events remain on the roadmap. RLS, AI usage
limits, account disabling, and an approved ownership-manifest backfill are not
implemented here. No multi-user cutover is safe until all workflows pass isolation
tests and existing ownership has been verified.
