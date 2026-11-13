"""Authorization queries always refresh state; no commits or policy here."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Business, BusinessMembership, User
from .principal import AuthenticatedPrincipal, Principal


def active_user_id(db: Session, principal: Principal) -> str | None:
    return db.scalar(
        select(User.id).where(
            User.auth_issuer == principal.issuer,
            User.auth_subject == principal.subject,
            User.status == "active",
        )
    )


def active_membership(db: Session, principal: Principal, business_id: str):
    statement = (
        select(User.id, BusinessMembership.id, BusinessMembership.role)
        .join(BusinessMembership, BusinessMembership.user_id == User.id)
        .join(Business, Business.id == BusinessMembership.business_id)
        .where(
            User.auth_issuer == principal.issuer,
            User.auth_subject == principal.subject,
            User.status == "active",
            BusinessMembership.business_id == business_id,
            BusinessMembership.status == "active",
        )
    )
    if isinstance(principal, AuthenticatedPrincipal):
        statement = statement.where(User.id == principal.user_id)
    return db.execute(statement).one_or_none()
