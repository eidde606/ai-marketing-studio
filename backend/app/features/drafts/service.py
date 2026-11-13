"""Draft and business rules, orchestration, and transaction boundaries."""
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy.orm import Session

from app.models import Draft
from app.transactions import Transactions
from . import repository
from .schemas import DraftCreate, DraftDestinationsUpdate, DraftUpdate


class DraftErrorKind(Enum):
    NOT_FOUND = "not_found"
    BUSINESS_NOT_FOUND = "business_not_found"
    NOT_PENDING = "not_pending"
    DELETE_IN_PROGRESS = "delete_in_progress"
    DUPLICATE_DESTINATIONS = "duplicate_destinations"
    TIKTOK_MEDIA_REQUIRED = "tiktok_media_required"
    SOCIAL_ACCOUNTS_NOT_CONNECTED = "social_accounts_not_connected"
    VIDEO_NOT_READY = "video_not_ready"


class DraftError(Exception):
    def __init__(self, kind: DraftErrorKind):
        super().__init__(kind.value)
        self.kind = kind


def require_draft(
    db: Session,
    draft_id: str,
    *,
    include_deleted: bool = False,
) -> Draft:
    draft = repository.get_draft(db, draft_id)
    if draft is None or (draft.deleted_at is not None and not include_deleted):
        raise DraftError(DraftErrorKind.NOT_FOUND)
    return draft


def require_pending_draft(db: Session, draft_id: str) -> Draft:
    repository.lock_draft(db, draft_id)
    draft = require_draft(db, draft_id)
    if draft.status != "pending":
        raise DraftError(DraftErrorKind.NOT_PENDING)
    return draft


def create_draft(request: DraftCreate, db: Session) -> Draft:
    if repository.get_business(db, request.business_id) is None:
        raise DraftError(DraftErrorKind.BUSINESS_NOT_FOUND)
    draft = Draft(
        **request.model_dump(),
        publish_destinations=(
            [request.platform]
            if request.platform in ("facebook", "tiktok")
            else ["facebook"]
        ),
    )
    repository.add_draft(db, draft)
    Transactions(db).commit()
    Transactions(db).refresh(draft)
    return draft


def list_drafts(
    business_id: str,
    include_deleted_published: bool,
    db: Session,
) -> list[Draft]:
    if repository.get_business(db, business_id) is None:
        raise DraftError(DraftErrorKind.BUSINESS_NOT_FOUND)
    return repository.list_drafts(
        db,
        business_id,
        include_deleted_published=include_deleted_published,
    )


def delete_draft(draft_id: str, db: Session) -> Draft:
    draft = require_draft(db, draft_id, include_deleted=True)
    if draft.deleted_at is not None:
        return draft

    deleted = repository.soft_delete_if_idle(
        db,
        draft_id,
        datetime.now(timezone.utc),
    )
    if deleted is None:
        Transactions(db).rollback()
        raise DraftError(DraftErrorKind.DELETE_IN_PROGRESS)
    Transactions(db).commit()
    Transactions(db).refresh(draft)
    return draft


def update_draft_destinations(
    draft_id: str,
    request: DraftDestinationsUpdate,
    db: Session,
) -> Draft:
    draft = require_pending_draft(db, draft_id)
    destinations = request.destinations

    if len(destinations) != len(set(destinations)):
        raise DraftError(DraftErrorKind.DUPLICATE_DESTINATIONS)

    if "tiktok" in destinations and not (
        (draft.media_type == "video" and draft.video_url) or draft.image_url
    ):
        raise DraftError(DraftErrorKind.TIKTOK_MEDIA_REQUIRED)

    connected = repository.connected_platforms(
        db,
        draft.business_id,
        destinations,
    )
    if set(destinations) != connected:
        raise DraftError(DraftErrorKind.SOCIAL_ACCOUNTS_NOT_CONNECTED)

    draft.publish_destinations = destinations
    Transactions(db).commit()
    Transactions(db).refresh(draft)
    return draft


def approve_draft(draft_id: str, db: Session) -> Draft:
    draft = require_pending_draft(db, draft_id)
    if draft.media_type == "video":
        if draft.video_status != "completed" or not draft.video_url:
            raise DraftError(DraftErrorKind.VIDEO_NOT_READY)
    draft.status = "approved"
    Transactions(db).commit()
    Transactions(db).refresh(draft)
    return draft


def update_draft(draft_id: str, request: DraftUpdate, db: Session) -> Draft:
    draft = require_pending_draft(db, draft_id)
    draft.title = request.title
    draft.caption = request.caption
    Transactions(db).commit()
    Transactions(db).refresh(draft)
    return draft


def reject_draft(draft_id: str, db: Session) -> Draft:
    draft = require_pending_draft(db, draft_id)
    draft.status = "rejected"
    Transactions(db).commit()
    Transactions(db).refresh(draft)
    return draft
