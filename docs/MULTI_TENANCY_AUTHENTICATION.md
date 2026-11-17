# Slice 2 — Authentication and membership authorization boundary

Base: `d16ba6405f163a802d9e9582715d0d472b2bfaa4`.

## Integration

Existing protected routes still depend on `auth.verify_token` and receive the
same JWT claims dictionary. Its dependency chain is now:

1. `_verify_supabase_token`: existing JWKS signature verification, ES256/RS256
   restriction, issuer/audience validation, required exp/iat/iss/aud/sub claims,
   30-second leeway, and the unchanged ALLOWED_USER_ID restriction.
2. `get_authenticated_principal`: converts verified issuer/subject to an internal
   Principal and calls the access application service.
3. `access.service.resolve_principal`: asks its repository for the active local
   application user matching the exact issuer/subject pair. It returns an immutable
   AuthenticatedPrincipal (issuer, subject, internal user_id).
4. `verify_token`: returns the original claims only after resolution succeeds.

FastAPI shares these dependency results within a request, not between requests.
No route or authentication dependency queries a repository or database directly.
The architecture guards now include app.auth. No feature workflows, routes, URLs,
response bodies, schema, or provider adapters are refactored by this slice.

## Deliberate authentication change

An allowlisted Supabase account must now have an active matching app_users row.
Unknown and disabled identities both receive 403 `Application access denied` before
protected feature execution. Missing/invalid JWTs retain 401; non-allowlisted
identities retain 403. Existing generic verification failures retain their existing
503 behavior. No local user, membership, or owner is auto-created from a JWT.

**Do not deploy this change without a separate rollout approval.** The Slice 1
schema must exist, and the legitimate allowlisted identity must be provisioned
through a reviewed process. With empty identity tables, protected requests fail
closed. This implementation neither provisions production identities nor assigns
business ownership. Existing ownership still requires an explicitly approved
manifest. A missing schema/database failure must not fall back to legacy admission.

## Service integration contract for subsequent slices

HTTP boundaries receive `Depends(get_authenticated_principal)` and pass that trusted
value to their feature application service. Inside that service:

```python
context = require_permission(db, principal, business_id, Permission.PUBLISH)
# Next: feature repository lookup using context.business_id AND resource ID.
# Then: normal workflow eligibility checks and provider operations.
```

Use the existing access service; do not duplicate role switches, infer a tenant
from the first membership, or trust JWT/client-supplied role or business claims.
`require_permission` returns the existing TenantAccess business context and performs
fresh active-user, active-membership, role, and business checks on every call. For
resolved principals it also matches the internal user ID, preventing a stale
principal from silently resolving to a replacement identity row. TenantAccess is
not a long-lived authorization token and does not establish resource ownership.

Missing/suspended/revoked membership and unknown business return the same 404.
Insufficient permission for an active membership returns 403. Owners/Admins/Members
retain the Slice 1 permission matrix. Members may use Sofía and Leo. Quotas remain
a future service policy; no billing is implemented.

## Security boundary and remaining gaps

This slice integrates the **application-user gate** into existing protected routes.
It does not integrate business authorization into every legacy feature. Existing
allowlisted active users retain the previous feature behavior, including unfiltered
business listing and resource-ID-only operations. An active user alone is not proof
of business membership. All those feature entry points still require their planned
service/repository integration before multi-user admission can be enabled.

OAuth callbacks, webhooks, background jobs, and external provider credential flows
retain their existing authentication/resolution behavior and need their dedicated
later slices. A revoked membership is enforced by the reusable access boundary,
not yet by every legacy endpoint. The JWT allowlist is mandatory and has no new
multi-user toggle. Never remove it based on this slice's tests alone.

Application-user creation is not exposed. No invitations, ownership backfill,
comprehensive audit events, frontend changes, billing, or RLS changes are included.
Account disable/ownership lifecycle still requires the Slice 1 owner invariant;
no new account-lifecycle mutation service is exposed.

## Validation

The new authentication integration tests use real RSA/EC signatures and mock only
JWKS key selection. They exercise the production dependency chain on existing
business routes and a test-only router for principal/business-context responses.
The test-only router is never registered in production. Tests cover invalid claims,
missing credentials, wrong signatures/algorithms, unknown/disabled users, unchanged
allowlist enforcement, memberships/roles across businesses, no automatic grants,
request-local caching, and ignored client/JWT-selected roles.

Existing workflow tests retain their explicit authentication overrides. Those tests
prove feature regression behavior, not real authentication. The additional tests
remove the override to exercise the production chain. PostgreSQL tests use only a
new disposable Unix-socket cluster and validate committed revocation/disable changes
from a second connection during a request transaction (READ COMMITTED).

```sh
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/test_authentication_integration.py backend/tests/test_tenant_foundation.py backend/tests/test_architecture.py backend/tests/test_closed_layers.py -q
PG_BIN_DIR=/Applications/Postgres.app/Contents/Versions/15/bin RUN_ISOLATED_POSTGRES=1 PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
```

The PG_BIN_DIR override is local-machine-specific; choose installed PostgreSQL
binaries elsewhere. No existing database URL is accepted by the disposable fixture.

## Roadmap

Slice 3 requires separate approval for tenant-scoped persistence, followed by each
feature's authorization integration. Preserve verified ownership/backfill gates.
Invitations, audit events, tenant AI usage limits, and RLS remain separate work.
Frontend internationalization is a separate future phase, not part of tenancy or
billing implementation.
