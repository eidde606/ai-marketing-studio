"""SQLAlchemy operations for drafts; transaction ownership stays in the service."""
from datetime import datetime

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.models import Business, Draft, ImageRevision, SocialAccount


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
