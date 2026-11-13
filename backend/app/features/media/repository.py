"""Persistence helpers for draft-scoped HeyGen generation attempts."""
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import (
    Business,
    Draft,
    HeyGenGenerationAttempt,
    HeyGenWebhookDelivery,
    ImageRevision,
)

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
        .execution_options(populate_existing=True)
    )


def lock_draft_for_attempt(db: Session, attempt_id: str) -> Draft | None:
    # Use submission's lock order: draft first, then attempt. Refresh cached
    # state after waiting for a concurrent lifecycle transaction.
    draft_id = db.scalar(
        select(HeyGenGenerationAttempt.draft_id)
        .where(HeyGenGenerationAttempt.id == attempt_id)
    )
    return db.scalar(
        select(Draft).where(Draft.id == draft_id).with_for_update()
        .execution_options(populate_existing=True)
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


def latest_attempt(
    db: Session,
    draft_id: str,
) -> HeyGenGenerationAttempt | None:
    return db.scalar(
        select(HeyGenGenerationAttempt)
        .where(HeyGenGenerationAttempt.draft_id == draft_id)
        .order_by(
            HeyGenGenerationAttempt.created_at.desc(),
            HeyGenGenerationAttempt.id.desc(),
        )
        .limit(1)
    )


def attempt_for_provider_video(
    db: Session,
    provider_video_id: str,
) -> HeyGenGenerationAttempt | None:
    return db.scalar(
        select(HeyGenGenerationAttempt).where(
            HeyGenGenerationAttempt.provider_video_id == provider_video_id,
        )
    )


def attempt_by_id(
    db: Session,
    attempt_id: str,
) -> HeyGenGenerationAttempt | None:
    return db.get(HeyGenGenerationAttempt, attempt_id)


def webhook_delivery(
    db: Session,
    delivery_id: str,
) -> HeyGenWebhookDelivery | None:
    return db.get(HeyGenWebhookDelivery, delivery_id)


def webhook_delivery_by_key(
    db: Session,
    deduplication_key: str,
) -> HeyGenWebhookDelivery | None:
    return db.scalar(
        select(HeyGenWebhookDelivery).where(
            HeyGenWebhookDelivery.deduplication_key == deduplication_key,
        )
    )


def pending_webhook_delivery_for_attempt(
    db: Session,
    attempt_id: str,
) -> HeyGenWebhookDelivery | None:
    return db.scalar(
        select(HeyGenWebhookDelivery)
        .where(
            HeyGenWebhookDelivery.callback_id == attempt_id,
            HeyGenWebhookDelivery.processed_at.is_(None),
        )
        .order_by(HeyGenWebhookDelivery.received_at)
        .limit(1)
    )


def has_active_attempt(db: Session, draft_id: str) -> bool:
    return active_attempt_for_draft(db, draft_id) is not None


def lock_draft_revisions(db: Session, draft_id: str) -> None:
    db.execute(select(func.pg_advisory_xact_lock(func.hashtext(draft_id))))


def active_revision(db: Session, draft_id: str) -> ImageRevision | None:
    return db.scalar(
        select(ImageRevision)
        .where(
            ImageRevision.draft_id == draft_id,
            ImageRevision.status.in_(["generating", "ready"]),
        )
        .limit(1)
    )


def add_revision(db: Session, revision: ImageRevision) -> None:
    db.add(revision)


def get_revision(
    db: Session,
    draft_id: str,
    revision_id: str,
) -> ImageRevision | None:
    revision = db.get(ImageRevision, revision_id)
    if revision is None or revision.draft_id != draft_id:
        return None
    return revision


def list_revisions(db: Session, draft_id: str) -> list[ImageRevision]:
    return db.scalars(
        select(ImageRevision)
        .where(ImageRevision.draft_id == draft_id)
        .order_by(ImageRevision.created_at.desc())
    ).all()


def mark_revision_failed(db: Session, revision_id: str) -> None:
    db.execute(
        update(ImageRevision)
        .where(
            ImageRevision.id == revision_id,
            ImageRevision.status == "generating",
        )
        .values(status="failed")
    )


def mark_revision_rejected(db: Session, revision_id: str) -> None:
    db.execute(
        update(ImageRevision)
        .where(
            ImageRevision.id == revision_id,
            ImageRevision.status == "generating",
        )
        .values(status="rejected")
    )


def save_ready_revision(
    db: Session,
    revision_id: str,
    revised_path: str,
) -> bool:
    result = db.execute(
        update(ImageRevision)
        .where(
            ImageRevision.id == revision_id,
            ImageRevision.status == "generating",
        )
        .values(
            revised_image_path=revised_path,
            status="ready",
        )
        .returning(ImageRevision.id)
    )
    return result.first() is not None


def reserve_image_generation(
    db: Session,
    draft_id: str,
    generation_id: str,
    started_at,
) -> bool:
    result = db.execute(
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.deleted_at.is_(None),
            Draft.status == "pending",
            Draft.image_status.in_(["not_started", "failed"]),
            Draft.image_url.is_(None),
            Draft.image_prompt.is_not(None),
            Draft.image_prompt != "",
        )
        .values(
            image_status="generating",
            image_started_at=started_at,
            image_generation_id=generation_id,
        )
        .returning(Draft.id)
    )
    return result.first() is not None


def mark_image_generation_failed(
    db: Session,
    draft_id: str,
    generation_id: str,
) -> None:
    db.execute(
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.image_status == "generating",
            Draft.image_generation_id == generation_id,
        )
        .values(
            image_status="failed",
            image_started_at=None,
            image_generation_id=None,
        )
    )


def save_generated_image(
    db: Session,
    draft_id: str,
    generation_id: str,
    storage_path: str,
) -> bool:
    result = db.execute(
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.deleted_at.is_(None),
            Draft.status == "pending",
            Draft.image_status == "generating",
            Draft.image_generation_id == generation_id,
            Draft.image_url.is_(None),
        )
        .values(
            image_url=storage_path,
            media_type="image",
            image_status="completed",
            image_started_at=None,
            image_generation_id=None,
        )
        .returning(Draft.id)
    )
    return result.first() is not None


def reset_image_generation(db: Session, draft_id: str, cutoff) -> bool:
    result = db.execute(
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.deleted_at.is_(None),
            Draft.status == "pending",
            Draft.image_status == "generating",
            Draft.image_url.is_(None),
            Draft.image_started_at.is_not(None),
            Draft.image_started_at < cutoff,
        )
        .values(
            image_status="failed",
            image_started_at=None,
            image_generation_id=None,
        )
        .returning(Draft.id)
    )
    return result.first() is not None
