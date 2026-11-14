"""Authorization queries always refresh state; no commits or policy here."""
from sqlalchemy import func, select
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


def active_membership(db: Session, principal: Principal, business_id: str, *, lock=False):
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
    if lock:
        statement = statement.with_for_update(of=(User, BusinessMembership))
    return db.execute(statement).one_or_none()


def visible_draft_business(db: Session, principal: AuthenticatedPrincipal, draft_id: str):
    """Resolve an ID-only route through active membership, never unrestricted Draft.get."""
    from app.models import Draft
    return db.scalar(select(Draft.business_id).join(
        BusinessMembership, BusinessMembership.business_id == Draft.business_id,
    ).join(User, User.id == BusinessMembership.user_id).where(
        Draft.id == draft_id, User.id == principal.user_id,
        User.auth_issuer == principal.issuer, User.auth_subject == principal.subject,
        User.status == "active", BusinessMembership.status == "active",
    ))


def lock_business_for_authorization(db: Session, business_id: str):
    # Same first lock as membership mutations; held only during short persistence.
    return db.scalar(select(Business.id).where(Business.id == business_id).with_for_update())


def lock_all_businesses_for_initial_provisioning(db: Session) -> set[str]:
    return set(db.scalars(
        select(Business.id).order_by(Business.id).with_for_update()
    ).all())


def has_application_users(db: Session) -> bool:
    return db.scalar(select(func.count()).select_from(User)) > 0


def has_business_memberships(db: Session) -> bool:
    return db.scalar(select(func.count()).select_from(BusinessMembership)) > 0


def add_initial_user_and_owner_memberships(
    db: Session,
    user: User,
    memberships: list[BusinessMembership],
) -> None:
    from sqlalchemy import inspect

    if not inspect(user).transient or user.status != "active":
        raise ValueError("An active, new application user is required")
    if not memberships or any(
        not inspect(membership).transient
        or membership.user_id != user.id
        or membership.role != "owner"
        or membership.status != "active"
        for membership in memberships
    ):
        raise ValueError("New active Owner memberships for this user are required")
    business_ids = [membership.business_id for membership in memberships]
    if len(set(business_ids)) != len(business_ids):
        raise ValueError("Initial Owner memberships must have unique business IDs")

    db.add(user)
    db.flush()
    db.add_all(memberships)
    db.flush()
