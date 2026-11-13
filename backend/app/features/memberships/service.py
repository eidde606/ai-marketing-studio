"""Changes to existing memberships only; initial ownership requires a manifest.

All owner-affecting operations must lock the business before authorization/counts.
No account-disable or ownership-bootstrap endpoint is exposed by this slice.
"""
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access.permissions import Permission, Role
from app.features.access.principal import Principal
from app.features.access.service import require_permission
from app.transactions import Transactions
from . import repository


def change_membership(
    db: Session, principal: Principal, business_id: str, membership_id: str,
    *, role: str, status: str,
) -> None:
    transactions = Transactions(db)
    try:
        if role not in {r.value for r in Role} or status not in {"active", "suspended", "revoked"}:
            raise ApplicationError(ErrorKind.INVALID_INPUT, "Invalid membership role or status")
        # Check access before locking an arbitrary tenant, then recheck after waiting.
        require_permission(db, principal, business_id, Permission.READ)
        if not repository.lock_business(db, business_id):
            raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
        actor = require_permission(db, principal, business_id, Permission.READ)
        target = repository.get_membership(db, business_id, membership_id)
        if target is None:
            raise ApplicationError(ErrorKind.NOT_FOUND, "Membership not found")
        leaving = target.user_id == actor.user_id and role == target.role and status == "revoked"
        if not leaving:
            permission = (
                Permission.MANAGE_OWNERS if "owner" in {target.role, role}
                else Permission.MANAGE_ADMINS if "admin" in {target.role, role}
                else Permission.MANAGE_MEMBERS
            )
            require_permission(db, principal, business_id, permission)
        if (target.role == "owner" and target.status == "active"
                and (role != "owner" or status != "active")
                and repository.other_active_owner_count(db, business_id, target.id) == 0):
            raise ApplicationError(ErrorKind.CONFLICT, "Business must retain an active owner")
        target.role = role
        target.status = status
        transactions.commit()
    except Exception:
        transactions.rollback()
        raise
