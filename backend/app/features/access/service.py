from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from . import repository
from .permissions import Permission, allows
from .principal import Principal, TenantAccess


def require_permission(
    db: Session, principal: Principal, business_id: str, permission: Permission,
) -> TenantAccess:
    """No provisioning, ownership inference, cached roles, or allowlist bypass."""
    membership = repository.active_membership(db, principal, business_id)
    if membership is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
    user_id, membership_id, role = membership
    if not allows(role, permission):
        raise ApplicationError(ErrorKind.FORBIDDEN, "Operation not permitted")
    return TenantAccess(user_id, business_id, membership_id, role)
