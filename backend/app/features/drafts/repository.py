"""SQLAlchemy operations for drafts; transaction ownership stays in the service."""
from datetime import datetime

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.models import Business, Draft, ImageRevision, SocialAccount


from app.features.access.principal import TenantAccess
from app.persistence import tenant


def get_business(db: Session, business_id: str) -> Business | None:
    return db.get(Business, business_id)


def get_draft(db: Session, draft_id: str) -> Draft | None:
    return db.get(Draft, draft_id)


def list_drafts(
    db: Session,
    business_id: str,
    *,
    include_deleted_published: bool,
) -> list[Draft]:
    visibility = Draft.deleted_at.is_(None)
    if include_deleted_published:
        visibility = or_(
            visibility,
            Draft.facebook_publish_status == "published",
            Draft.tiktok_publish_status == "published",
            Draft.published_at.is_not(None),
        )
    return db.scalars(
        select(Draft).where(Draft.business_id == business_id, visibility)
    ).all()


def add_draft(db: Session, draft: Draft) -> None:
    db.add(draft)


def lock_draft(db: Session, draft_id: str) -> None:
    db.execute(select(Draft).where(Draft.id == draft_id).with_for_update())


def soft_delete_if_idle(
    db: Session,
    draft_id: str,
    deleted_at: datetime,
) -> str | None:
    return db.execute(
        _soft_delete_if_idle_statement(draft_id, deleted_at)
    ).scalar_one_or_none()


def connected_platforms(
    db: Session,
    business_id: str,
    platforms: list[str],
) -> set[str]:
    return set(
        db.scalars(
            select(SocialAccount.platform).where(
                SocialAccount.business_id == business_id,
                SocialAccount.platform.in_(platforms),
                SocialAccount.connection_status == "connected",
            )
        ).all()
    )


def _soft_delete_if_idle_statement(draft_id, deleted_at):
    return (
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.deleted_at.is_(None),
            Draft.facebook_publish_status != "publishing",
            Draft.tiktok_publish_status != "publishing",
            Draft.image_status != "generating",
            Draft.video_status.not_in(["generating", "uploading"]),
            ~select(ImageRevision.id).where(
                ImageRevision.draft_id == draft_id,
                ImageRevision.status == "generating",
            ).exists(),
        )
        .values(deleted_at=deleted_at)
        .returning(Draft.id)
    )


# Slice 3 APIs: context must come from access.service, never from a request ID.


def get_draft_scoped(db: Session, context: TenantAccess, draft_id: str, *, include_deleted=False):
    statement = tenant.selection(Draft, context).where(Draft.id == draft_id)
    if not include_deleted:
        statement = statement.where(Draft.deleted_at.is_(None))
    return db.scalar(statement)


def lock_draft_scoped(db: Session, context: TenantAccess, draft_id: str):
    return db.scalar(tenant.selection(Draft, context).where(
        Draft.id == draft_id, Draft.deleted_at.is_(None),
    ).with_for_update().execution_options(populate_existing=True))


def list_drafts_scoped(db: Session, context: TenantAccess, *, include_deleted_published=False,
                       limit=100, offset=0):
    visibility = Draft.deleted_at.is_(None)
    if include_deleted_published:
        visibility = or_(visibility, Draft.facebook_publish_status == "published",
                         Draft.tiktok_publish_status == "published", Draft.published_at.is_not(None))
    return db.scalars(tenant.page(tenant.selection(Draft, context).where(visibility)
        .order_by(Draft.created_at.desc(), Draft.id.desc()), limit=limit, offset=offset)).all()


def update_draft_scoped(db: Session, context: TenantAccess, draft_id: str, *,
                        expected_status: str, values: dict) -> bool:
    # Associations and tenant reassignment must never pass through a generic patch.
    allowed = {"title", "caption", "status", "publish_destinations", "video_script", "image_prompt"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported draft update fields")
    return db.execute(update(Draft).where(
        tenant.predicate(Draft, context), Draft.id == draft_id,
        Draft.deleted_at.is_(None), Draft.status == expected_status,
    ).values(**values).returning(Draft.id)).scalar_one_or_none() is not None


def soft_delete_if_idle_scoped(db: Session, context: TenantAccess, draft_id: str, deleted_at: datetime):
    return db.execute(_soft_delete_if_idle_statement(draft_id, deleted_at)
                      .where(tenant.predicate(Draft, context))).scalar_one_or_none()


def add_draft_scoped(db: Session, context: TenantAccess, record: Draft):
    if not isinstance(record, Draft):
        raise TypeError("Expected Draft")
    return tenant.insert_record(db, context, record)
