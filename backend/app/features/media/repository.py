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


from app.features.access.principal import TenantAccess
from app.persistence import tenant


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


def lock_attempt_for_update(
    db: Session,
    attempt_id: str,
    *,
    lock_draft: bool = False,
) -> tuple[Draft | None, HeyGenGenerationAttempt | None]:
    draft = lock_draft_for_attempt(db, attempt_id) if lock_draft else None
    attempt = db.scalar(
        select(HeyGenGenerationAttempt)
        .where(HeyGenGenerationAttempt.id == attempt_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return draft, attempt


def refreshed_attempt(
    db: Session,
    attempt_id: str,
) -> HeyGenGenerationAttempt | None:
    return db.scalar(
        select(HeyGenGenerationAttempt)
        .where(HeyGenGenerationAttempt.id == attempt_id)
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


def add_attempt(db: Session, attempt: HeyGenGenerationAttempt) -> None:
    db.add(attempt)


def webhook_delivery(
    db: Session,
    delivery_id: str,
) -> HeyGenWebhookDelivery | None:
    return db.get(HeyGenWebhookDelivery, delivery_id)


def add_webhook_delivery(
    db: Session,
    delivery: HeyGenWebhookDelivery,
) -> None:
    db.add(delivery)


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
        _mark_revision_failed_statement(revision_id)
    )


def mark_revision_rejected(db: Session, revision_id: str) -> None:
    db.execute(
        _mark_revision_rejected_statement(revision_id)
    )


def save_ready_revision(
    db: Session,
    revision_id: str,
    revised_path: str,
) -> bool:
    result = db.execute(
        _save_ready_revision_statement(revision_id, revised_path)
    )
    return result.first() is not None


def reserve_image_generation(
    db: Session,
    draft_id: str,
    generation_id: str,
    started_at,
) -> bool:
    result = db.execute(
        _reserve_image_generation_statement(draft_id, generation_id, started_at)
    )
    return result.first() is not None


def mark_image_generation_failed(
    db: Session,
    draft_id: str,
    generation_id: str,
) -> None:
    db.execute(
        _mark_image_generation_failed_statement(draft_id, generation_id)
    )


def save_generated_image(
    db: Session,
    draft_id: str,
    generation_id: str,
    storage_path: str,
) -> bool:
    result = db.execute(
        _save_generated_image_statement(draft_id, generation_id, storage_path)
    )
    return result.first() is not None


def reset_image_generation(db: Session, draft_id: str, cutoff) -> bool:
    result = db.execute(
        _reset_image_generation_statement(draft_id, cutoff)
    )
    return result.first() is not None


def _mark_revision_failed_statement(revision_id):
    return (
        update(ImageRevision)
        .where(
            ImageRevision.id == revision_id,
            ImageRevision.status == "generating",
        )
        .values(status="failed")
    )


def _mark_revision_rejected_statement(revision_id):
    return (
        update(ImageRevision)
        .where(
            ImageRevision.id == revision_id,
            ImageRevision.status == "generating",
        )
        .values(status="rejected")
    )


def _save_ready_revision_statement(revision_id, revised_path):
    return (
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


def _reserve_image_generation_statement(draft_id, generation_id, started_at):
    return (
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


def _mark_image_generation_failed_statement(draft_id, generation_id):
    return (
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


def _save_generated_image_statement(draft_id, generation_id, storage_path):
    return (
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


def _reset_image_generation_statement(draft_id, cutoff):
    return (
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




def get_revision_scoped(db: Session, context: TenantAccess, draft_id: str, revision_id: str):
    return db.scalar(tenant.selection(ImageRevision, context).where(
        ImageRevision.id == revision_id, ImageRevision.draft_id == draft_id))


def list_revisions_scoped(db: Session, context: TenantAccess, draft_id: str, *, limit=100, offset=0):
    return db.scalars(tenant.page(tenant.selection(ImageRevision, context)
        .where(ImageRevision.draft_id == draft_id).order_by(ImageRevision.created_at.desc(), ImageRevision.id),
        limit=limit, offset=offset)).all()


def lock_draft_revisions_scoped(db: Session, context: TenantAccess, draft_id: str) -> bool:
    # Preserve the same advisory-lock key as legacy workflows. No foreign key lock
    # is taken for a resource outside the scope. IDs are immutable in the new APIs.
    return db.execute(select(func.pg_advisory_xact_lock(func.hashtext(Draft.id)))
        .where(Draft.id == draft_id, tenant.predicate(Draft, context))).first() is not None


def get_attempt_scoped(db: Session, context: TenantAccess, attempt_id: str):
    return tenant.get(db, context, HeyGenGenerationAttempt, attempt_id)


def latest_attempt_scoped(db: Session, context: TenantAccess, draft_id: str, *, active_only=False):
    statement = tenant.selection(HeyGenGenerationAttempt, context).where(
        HeyGenGenerationAttempt.draft_id == draft_id)
    if active_only:
        statement = statement.where(HeyGenGenerationAttempt.status.in_(ACTIVE_STATUSES))
    return db.scalar(statement.order_by(HeyGenGenerationAttempt.created_at.desc(),
                                       HeyGenGenerationAttempt.id.desc()).limit(1))


def lock_attempt_scoped(db: Session, context: TenantAccess, attempt_id: str):
    # Draft then attempt, matching submission/completion's existing lock order.
    draft_id = db.scalar(select(HeyGenGenerationAttempt.draft_id).where(
        tenant.predicate(HeyGenGenerationAttempt, context), HeyGenGenerationAttempt.id == attempt_id))
    if draft_id is None:
        return None, None
    draft = tenant.get(db, context, Draft, draft_id, lock=True)
    attempt = tenant.get(db, context, HeyGenGenerationAttempt, attempt_id, lock=True)
    return (draft, attempt) if draft is not None and attempt is not None else (None, None)


def update_attempt_scoped(db: Session, context: TenantAccess, attempt_id: str, *,
                          expected_status: str, expected_updated_at, values: dict) -> bool:
    # Service owns lifecycle policy; expected state/timestamp protects stale leases.
    allowed = {"status", "storage_status", "storage_path", "completion_lease_until",
               "submission_lease_until", "provider_video_id", "updated_at"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported attempt fields")
    if values.get("storage_path") is not None:
        tenant.validate_storage_path(context, values["storage_path"])
    return db.execute(update(HeyGenGenerationAttempt).where(
        tenant.predicate(HeyGenGenerationAttempt, context), HeyGenGenerationAttempt.id == attempt_id,
        HeyGenGenerationAttempt.status == expected_status,
        HeyGenGenerationAttempt.updated_at == expected_updated_at,
    ).values(**values).returning(HeyGenGenerationAttempt.id)).scalar_one_or_none() is not None


def mark_revision_failed_scoped(db: Session, context: TenantAccess, revision_id) -> bool:
    statement = _mark_revision_failed_statement(revision_id).where(tenant.predicate(ImageRevision, context))
    statement = statement.returning(ImageRevision.id)
    return db.execute(statement).scalar_one_or_none() is not None


def mark_revision_rejected_scoped(db: Session, context: TenantAccess, revision_id) -> bool:
    statement = _mark_revision_rejected_statement(revision_id).where(tenant.predicate(ImageRevision, context))
    statement = statement.returning(ImageRevision.id)
    return db.execute(statement).scalar_one_or_none() is not None


def save_ready_revision_scoped(db: Session, context: TenantAccess, revision_id, revised_path) -> bool:
    tenant.validate_storage_path(context, revised_path)
    statement = _save_ready_revision_statement(revision_id, revised_path).where(tenant.predicate(ImageRevision, context))
    return db.execute(statement).scalar_one_or_none() is not None


def reserve_image_generation_scoped(db: Session, context: TenantAccess, draft_id, generation_id, started_at) -> bool:
    statement = _reserve_image_generation_statement(draft_id, generation_id, started_at).where(tenant.predicate(Draft, context))
    return db.execute(statement).scalar_one_or_none() is not None


def mark_image_generation_failed_scoped(db: Session, context: TenantAccess, draft_id, generation_id) -> bool:
    statement = _mark_image_generation_failed_statement(draft_id, generation_id).where(tenant.predicate(Draft, context))
    statement = statement.returning(Draft.id)
    return db.execute(statement).scalar_one_or_none() is not None


def save_generated_image_scoped(db: Session, context: TenantAccess, draft_id, generation_id, storage_path) -> bool:
    tenant.validate_storage_path(context, storage_path)
    statement = _save_generated_image_statement(draft_id, generation_id, storage_path).where(tenant.predicate(Draft, context))
    return db.execute(statement).scalar_one_or_none() is not None


def reset_image_generation_scoped(db: Session, context: TenantAccess, draft_id, cutoff) -> bool:
    statement = _reset_image_generation_statement(draft_id, cutoff).where(tenant.predicate(Draft, context))
    return db.execute(statement).scalar_one_or_none() is not None


def add_revision_scoped(db: Session, context: TenantAccess, record: ImageRevision):
    if not isinstance(record, ImageRevision):
        raise TypeError("Expected ImageRevision")
    return tenant.insert_record(db, context, record)


def add_attempt_scoped(db: Session, context: TenantAccess, record: HeyGenGenerationAttempt):
    if not isinstance(record, HeyGenGenerationAttempt):
        raise TypeError("Expected HeyGenGenerationAttempt")
    return tenant.insert_record(db, context, record)


def update_revision_scoped(db: Session, context: TenantAccess, draft_id: str, revision_id: str, *,
                           expected_status: str, status: str) -> bool:
    if status not in {"generating", "ready", "accepted", "rejected", "failed"}:
        raise ValueError("Unsupported revision status")
    return db.execute(update(ImageRevision).where(
        tenant.predicate(ImageRevision, context), ImageRevision.id == revision_id,
        ImageRevision.draft_id == draft_id, ImageRevision.status == expected_status,
    ).values(status=status).returning(ImageRevision.id)).scalar_one_or_none() is not None


def update_draft_media_scoped(db: Session, context: TenantAccess, draft_id: str, *,
                              expected_video_status: str, values: dict) -> bool:
    # Used after the service has checked cross-media reservations/eligibility.
    allowed = {"video_status", "video_url", "video_generation_id", "media_type", "image_url"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported draft media fields")
    for field in ("video_url", "image_url"):
        if values.get(field) is not None:
            tenant.validate_storage_path(context, values[field])
    return db.execute(update(Draft).where(
        tenant.predicate(Draft, context), Draft.id == draft_id, Draft.deleted_at.is_(None),
        Draft.status == "pending", Draft.video_status == expected_video_status,
    ).values(**values).returning(Draft.id)).scalar_one_or_none() is not None
