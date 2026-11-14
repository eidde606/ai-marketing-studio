"""Draft and business rules, orchestration, and transaction boundaries."""
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy.orm import Session
from app.errors import ApplicationError, ErrorKind
from app.features.accounts import service as accounts

from app.models import Draft
from app.features.access.principal import AuthenticatedPrincipal
from app.features.access.permissions import Permission
from app.features.access.service import require_permission, require_draft_permission
from app.transactions import Transactions, rollback_on_failure
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


# Legacy helpers retained only for media.workflows_service until its integration.
# Migrated HTTP workflows below MUST NOT call these helpers.
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


def _authorized_draft(db, principal, draft_id, permission, *, include_deleted=False):
    context = require_draft_permission(db, principal, draft_id, permission)
    draft = repository.lock_draft_scoped(db, context, draft_id, include_deleted=include_deleted)
    # READ COMMITTED: membership/role may have changed while the row lock waited.
    context = require_draft_permission(db, principal, draft_id, permission)
    if draft is None:
        raise DraftError(DraftErrorKind.NOT_FOUND)
    if not include_deleted and draft.status != "pending":
        raise DraftError(DraftErrorKind.NOT_PENDING)
    return context, draft


def _save(db, principal, context, draft_id, values, permission):
    if not repository.update_draft_scoped(db, context, draft_id, expected_status="pending", values=values):
        Transactions(db).rollback()
        raise DraftError(DraftErrorKind.NOT_PENDING)
    require_draft_permission(db, principal, draft_id, permission)
    Transactions(db).commit()
    context = require_draft_permission(db, principal, draft_id, Permission.READ)
    return repository.get_draft_scoped(db, context, draft_id)


@rollback_on_failure
def create_draft(request: DraftCreate, db: Session, *, principal: AuthenticatedPrincipal) -> Draft:
    context = require_permission(db, principal, request.business_id, Permission.EDIT_CONTENT)
    destination = request.platform.strip().lower()
    if destination not in {"facebook", "tiktok", "instagram"}:
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Unsupported creative platform")
    values = request.model_dump()
    values["marketing_content_language"] = request.marketing_content_language or accounts.business_preferences(
        db, principal, request.business_id,
    )["marketing_content_language"]
    draft = Draft(**values, publish_destinations=[destination] if destination != "instagram" else [])
    draft_id = repository.add_draft_scoped(db, context, draft)
    if draft_id is None:
        raise DraftError(DraftErrorKind.BUSINESS_NOT_FOUND)
    require_permission(db, principal, request.business_id, Permission.EDIT_CONTENT)
    Transactions(db).commit()
    context = require_permission(db, principal, request.business_id, Permission.READ)
    return repository.get_draft_scoped(db, context, draft_id)


def list_drafts(business_id: str, include_deleted_published: bool, db: Session, *,
                principal: AuthenticatedPrincipal) -> list[Draft]:
    context = require_permission(db, principal, business_id, Permission.READ)
    # Preserve the existing complete-list HTTP contract, using bounded SQL pages.
    result = []
    while True:
        page = repository.list_drafts_scoped(db, context, include_deleted_published=include_deleted_published,
                                            limit=100, offset=len(result))
        result.extend(page)
        if len(page) < 100:
            return result


@rollback_on_failure
def delete_draft(draft_id: str, db: Session, *, principal: AuthenticatedPrincipal) -> Draft:
    context, draft = _authorized_draft(db, principal, draft_id, Permission.EDIT_CONTENT, include_deleted=True)
    if draft.deleted_at is not None:
        return draft
    permission = Permission.EDIT_CONTENT if draft.status == "pending" else Permission.APPROVE_CONTENT
    context = require_draft_permission(db, principal, draft_id, permission)
    if repository.soft_delete_if_idle_scoped(db, context, draft_id, datetime.now(timezone.utc)) is None:
        Transactions(db).rollback()
        raise DraftError(DraftErrorKind.DELETE_IN_PROGRESS)
    require_draft_permission(db, principal, draft_id, permission)
    Transactions(db).commit()
    context = require_draft_permission(db, principal, draft_id, Permission.READ)
    return repository.get_draft_scoped(db, context, draft_id, include_deleted=True)


@rollback_on_failure
def update_draft_destinations(draft_id: str, request: DraftDestinationsUpdate, db: Session, *,
                              principal: AuthenticatedPrincipal) -> Draft:
    context, draft = _authorized_draft(db, principal, draft_id, Permission.EDIT_CONTENT)
    destinations = request.destinations
    if len(destinations) != len(set(destinations)):
        raise DraftError(DraftErrorKind.DUPLICATE_DESTINATIONS)
    if "tiktok" in destinations and not ((draft.media_type == "video" and draft.video_url) or draft.image_url):
        raise DraftError(DraftErrorKind.TIKTOK_MEDIA_REQUIRED)
    if set(destinations) != repository.connected_platforms_scoped(db, context, destinations):
        raise DraftError(DraftErrorKind.SOCIAL_ACCOUNTS_NOT_CONNECTED)
    return _save(db, principal, context, draft_id, {"publish_destinations": destinations}, Permission.EDIT_CONTENT)


@rollback_on_failure
def approve_draft(draft_id: str, db: Session, *, principal: AuthenticatedPrincipal) -> Draft:
    context, draft = _authorized_draft(db, principal, draft_id, Permission.APPROVE_CONTENT)
    if (draft.image_status in {"generating", "needs_review"}
            or draft.video_status in {"generating", "uploading", "needs_review"}
            or repository.has_active_revision_scoped(db, context, draft_id)):
        raise ApplicationError(ErrorKind.CONFLICT, "Resolve pending media operations before approval")
    if (any(destination not in {"facebook", "tiktok"} for destination in draft.publish_destinations)
            or len(draft.publish_destinations) != len(set(draft.publish_destinations))):
        raise ApplicationError(ErrorKind.CONFLICT, "Choose supported publishing destinations before approval")
    if draft.media_type == "video" and (draft.video_status != "completed" or not draft.video_url):
        raise DraftError(DraftErrorKind.VIDEO_NOT_READY)
    return _save(db, principal, context, draft_id, {"status": "approved"}, Permission.APPROVE_CONTENT)


@rollback_on_failure
def update_draft(draft_id: str, request: DraftUpdate, db: Session, *, principal: AuthenticatedPrincipal) -> Draft:
    context, _ = _authorized_draft(db, principal, draft_id, Permission.EDIT_CONTENT)
    return _save(db, principal, context, draft_id, {"title": request.title, "caption": request.caption}, Permission.EDIT_CONTENT)


@rollback_on_failure
def reject_draft(draft_id: str, db: Session, *, principal: AuthenticatedPrincipal) -> Draft:
    context, _ = _authorized_draft(db, principal, draft_id, Permission.APPROVE_CONTENT)
    return _save(db, principal, context, draft_id, {"status": "rejected"}, Permission.APPROVE_CONTENT)
