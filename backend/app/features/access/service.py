from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from . import repository
from .permissions import Permission, allows
from .principal import AuthenticatedPrincipal, Principal, TenantAccess


def resolve_principal(db: Session, identity: Principal) -> AuthenticatedPrincipal:
    """Read-only resolution after JWT verification; never auto-provision users."""
    user_id = repository.active_user_id(db, identity)
    if user_id is None:
        # Do not distinguish an unregistered identity from a disabled account.
        raise ApplicationError(ErrorKind.FORBIDDEN, "Application access denied")
    return AuthenticatedPrincipal(identity.issuer, identity.subject, user_id)


def require_permission(
    db: Session, principal: Principal, business_id: str, permission: Permission,
) -> TenantAccess:
    """Resolve a fresh business context for one service operation.

    HTTP services receive AuthenticatedPrincipal from the auth dependency. User
    status and membership are queried again here, including after lock waits.
    TenantAccess is a selector for scoped persistence, not proof of resource
    ownership; feature repositories must also constrain each referenced resource.
    No provisioning, ownership inference, cached roles, or allowlist bypass.
    """
    membership = repository.active_membership(db, principal, business_id)
    if membership is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
    user_id, membership_id, role = membership
    if not allows(role, permission):
        raise ApplicationError(ErrorKind.FORBIDDEN, "Operation not permitted")
    return TenantAccess(user_id, business_id, membership_id, role)


def require_draft_permission(db: Session, principal: AuthenticatedPrincipal,
                             draft_id: str, permission: Permission) -> TenantAccess:
    business_id = repository.visible_draft_business(db, principal, draft_id)
    if business_id is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Draft not found")
    return require_permission(db, principal, business_id, permission)
