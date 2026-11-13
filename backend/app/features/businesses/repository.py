"""SQLAlchemy operations for businesses."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Business


from app.features.access.principal import TenantAccess
from app.persistence import tenant


def add_business(db: Session, business: Business) -> None:
    db.add(business)


def list_businesses(db: Session) -> list[Business]:
    return db.scalars(select(Business)).all()




def get_business_scoped(db: Session, context: TenantAccess):
    return tenant.get(db, context, Business, tenant.business_id(context))


def list_for_principal(db: Session, principal):
    from app.models import BusinessMembership, User
    return db.scalars(select(Business).join(
        BusinessMembership, BusinessMembership.business_id == Business.id,
    ).join(User, User.id == BusinessMembership.user_id).where(
        User.id == principal.user_id, User.auth_issuer == principal.issuer,
        User.auth_subject == principal.subject, User.status == "active",
        BusinessMembership.status == "active",
    ).order_by(Business.created_at, Business.id)).all()


def insert_business_and_owner(db: Session, business: Business, membership):
    # INSERT only: cannot attach ownership to an existing business via this path.
    from sqlalchemy import inspect
    if not inspect(business).transient or not inspect(membership).transient:
        raise ValueError("New business and membership records are required")
    if membership.business_id != business.id or membership.role != "owner" or membership.status != "active":
        raise ValueError("Invalid initial owner")
    db.add(business)
    db.flush()
    db.add(membership)
