from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Business, BusinessMembership, User


def lock_business(db: Session, business_id: str) -> bool:
    return db.scalar(select(Business.id).where(Business.id == business_id).with_for_update()) is not None


def get_membership(db: Session, business_id: str, membership_id: str):
    return db.scalar(
        select(BusinessMembership).where(
            BusinessMembership.business_id == business_id,
            BusinessMembership.id == membership_id,
        ).execution_options(populate_existing=True)
    )


def other_active_owner_count(db: Session, business_id: str, membership_id: str) -> int:
    return db.scalar(
        select(func.count()).select_from(BusinessMembership)
        .join(User, User.id == BusinessMembership.user_id)
        .where(BusinessMembership.business_id == business_id,
               BusinessMembership.id != membership_id,
               BusinessMembership.role == "owner",
               BusinessMembership.status == "active", User.status == "active")
    )
