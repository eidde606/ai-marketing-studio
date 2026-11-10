"""Persistence helpers for draft-scoped HeyGen generation attempts."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Business, Draft, HeyGenGenerationAttempt

ACTIVE_STATUSES = ("SUBMITTING", "UNKNOWN", "PROCESSING")


def lock_draft_for_generation(
    db: Session,
    *,
    business_id: str,
    draft_id: str,
) -> Draft | None:
    business = db.scalar(select(Business.id).where(Business.id == business_id))
    if business is None:
        return None

    return db.scalar(
        select(Draft)
        .where(
            Draft.id == draft_id,
            Draft.business_id == business_id,
            Draft.deleted_at.is_(None),
        )
        .with_for_update()
    )


def active_attempt_for_draft(
    db: Session,
    draft_id: str,
    *,
    lock: bool = False,
) -> HeyGenGenerationAttempt | None:
    statement = select(HeyGenGenerationAttempt).where(
        HeyGenGenerationAttempt.draft_id == draft_id,
        HeyGenGenerationAttempt.status.in_(ACTIVE_STATUSES),
    )
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement)


def latest_attempt_for_draft(
    db: Session,
    *,
    user_id: str,
    business_id: str,
    draft_id: str,
) -> HeyGenGenerationAttempt | None:
    return db.scalar(
        select(HeyGenGenerationAttempt)
        .where(
            HeyGenGenerationAttempt.user_id == user_id,
            HeyGenGenerationAttempt.business_id == business_id,
            HeyGenGenerationAttempt.draft_id == draft_id,
        )
        .order_by(
            HeyGenGenerationAttempt.created_at.desc(),
            HeyGenGenerationAttempt.id.desc(),
        )
        .limit(1)
    )


def has_active_attempt(db: Session, draft_id: str) -> bool:
    return active_attempt_for_draft(db, draft_id) is not None
