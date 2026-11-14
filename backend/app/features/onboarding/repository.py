"""Identity- and tenant-scoped persistence for onboarding state."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Business, BusinessMembership, OnboardingProgress, User
from app.features.access.principal import AuthenticatedPrincipal


def lock_active_user(db: Session, principal: AuthenticatedPrincipal):
    return db.scalar(
        select(User).where(
            User.id == principal.user_id,
            User.auth_issuer == principal.issuer,
            User.auth_subject == principal.subject,
            User.status == "active",
        ).with_for_update().execution_options(populate_existing=True)
    )


def progress_for_user(db: Session, user_id: str, *, lock: bool = False):
    statement = select(OnboardingProgress).where(OnboardingProgress.user_id == user_id)
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def add_progress(db: Session, user_id: str) -> OnboardingProgress:
    progress = OnboardingProgress(user_id=user_id, current_step=1, data={})
    db.add(progress)
    db.flush()
    return progress


def owned_business(db: Session, business_id: str, user_id: str):
    return db.scalar(
        select(Business).join(
            BusinessMembership, BusinessMembership.business_id == Business.id,
        ).where(
            Business.id == business_id,
            BusinessMembership.user_id == user_id,
            BusinessMembership.role == "owner",
            BusinessMembership.status == "active",
        ).execution_options(populate_existing=True)
    )
