"""Authorized manual upload, image generation and revision workflows."""
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal, TenantAccess
from app.features.drafts import repository as drafts
from app.models import Draft, ImageRevision
from app.storage_service import (
    download_marketing_image,
    get_marketing_image_url,
    upload_marketing_video,
)
from app.transactions import Transactions
from . import generation_service, repository
from .image_provider import edit_marketing_image, generate_marketing_image

logger = logging.getLogger(__name__)
MAX_MANUAL_VIDEO_SIZE = 100 * 1024 * 1024


def _failure(kind: ErrorKind, detail: str) -> ApplicationError:
    return ApplicationError(kind, detail)


def _draft(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
    permission: Permission,
    *,
    include_deleted: bool = False,
) -> tuple[TenantAccess, Draft]:
    context = access.require_draft_permission(db, principal, draft_id, permission)
    draft = drafts.get_draft_scoped(
        db, context, draft_id, include_deleted=include_deleted,
    )
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    return context, draft


def _pending_draft(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
    permission: Permission,
) -> tuple[TenantAccess, Draft]:
    context, draft = _draft(db, principal, draft_id, permission)
    if draft.status != "pending":
        raise _failure(ErrorKind.CONFLICT, "Only pending drafts can be edited")
    return context, draft


def _revision(
    db: Session,
    context: TenantAccess,
    draft_id: str,
    revision_id: str,
) -> ImageRevision:
    revision = repository.get_revision_scoped(db, context, draft_id, revision_id)
    if revision is None:
        raise _failure(ErrorKind.NOT_FOUND, "Image revision not found")
    return revision


def _has_video_operation(db: Session, context: TenantAccess, draft_id: str) -> bool:
    return (
        repository.has_active_attempt_scoped(db, context, draft_id)
        or repository.has_unstored_attempt_scoped(db, context, draft_id)
    )


def prepare_manual_video_upload(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
) -> Draft:
    context, draft = _pending_draft(
        db, principal, draft_id, Permission.UPLOAD_MEDIA,
    )
    if (
        draft.video_status in ("generating", "completed", "uploading")
        or _has_video_operation(db, context, draft.id)
    ):
        raise _failure(
            ErrorKind.CONFLICT,
            "This draft already has a video or an active video operation",
        )
    return draft


def save_manual_video_upload(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft: Draft,
    video_bytes: bytes,
) -> dict[str, str]:
    context = access.require_draft_permission(
        db, principal, draft.id, Permission.UPLOAD_MEDIA,
    )
    current = drafts.get_draft_scoped(db, context, draft.id)
    if current is None or current.business_id != draft.business_id:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    if (
        current.status != "pending"
        or current.video_status in ("generating", "completed", "uploading")
        or _has_video_operation(db, context, current.id)
    ):
        raise _failure(ErrorKind.CONFLICT, "This draft already has a video or an active video operation")
    try:
        storage_path = upload_marketing_video(
            video_bytes=video_bytes,
            business_id=context.business_id,
        )
    except ValueError as exc:
        raise _failure(ErrorKind.INVALID_INPUT, str(exc)) from exc

    context = access.require_draft_permission(
        db, principal, draft.id, Permission.UPLOAD_MEDIA,
    )
    if not repository.update_draft_media_scoped(
        db,
        context,
        draft.id,
        expected_video_status=current.video_status,
        values={
            "media_type": "video",
            "video_url": storage_path,
            "video_status": "completed",
            "video_generation_id": None,
        },
    ):
        Transactions(db).rollback()
        raise _failure(ErrorKind.CONFLICT, "The draft changed during video upload")
    Transactions(db).commit()
    return {
        "draft_id": draft.id,
        "media_type": "video",
        "video_status": "completed",
    }


def video_preview(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
) -> dict[str, str]:
    context, draft = _draft(
        db, principal, draft_id, Permission.READ, include_deleted=True,
    )
    if (
        draft.media_type != "video"
        or draft.video_status != "completed"
        or not draft.video_url
    ):
        raise _failure(
            ErrorKind.NOT_FOUND,
            "No completed video available for this draft",
        )
    try:
        signed_url = get_marketing_image_url(
            draft.video_url, expires_in=900, context=context,
        )
    except ValueError as exc:
        raise _failure(ErrorKind.INVALID_INPUT, "Invalid video storage path") from exc
    return {"draft_id": draft.id, "video_url": signed_url}


def generate_image(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
) -> dict[str, str]:
    context = access.require_draft_permission(
        db, principal, draft_id, Permission.GENERATE_MEDIA, lock=True,
    )
    draft = repository.lock_draft_scoped(db, context, draft_id)
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    if draft.status != "pending":
        raise _failure(ErrorKind.CONFLICT, "Only pending drafts can be edited")
    if (
        draft.video_url
        or draft.video_status in ("pending", "generating", "uploading", "needs_review", "completed")
        or _has_video_operation(db, context, draft.id)
    ):
        raise _failure(ErrorKind.CONFLICT, "A video or video operation already exists")

    generation_id = str(uuid4())
    if not repository.reserve_image_generation_scoped(
        db, context, draft_id, generation_id, datetime.now(timezone.utc),
    ):
        Transactions(db).rollback()
        _draft(db, principal, draft_id, Permission.GENERATE_MEDIA)
        raise _failure(
            ErrorKind.CONFLICT,
            "Image generation is unavailable for this draft. "
            "It may already be generating or completed.",
        )
    Transactions(db).commit()

    image_prompt = draft.image_prompt
    business_id = draft.business_id
    try:
        storage_path = generate_marketing_image(
            image_prompt=image_prompt,
            business_id=business_id,
        )
    except Exception as exc:
        logger.warning(
            "Image generation failed: error_type=%s",
            type(exc).__name__,
        )
        Transactions(db).rollback()
        repository.mark_image_generation_failed_scoped(
            db, context, draft_id, generation_id,
        )
        Transactions(db).commit()
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Image generation failed. Please try again later.",
        ) from exc

    try:
        context = access.require_draft_permission(
            db, principal, draft_id, Permission.GENERATE_MEDIA,
        )
    except ApplicationError:
        Transactions(db).rollback()
        repository.mark_image_generation_failed_scoped(
            db, context, draft_id, generation_id,
        )
        Transactions(db).commit()
        raise
    if not repository.save_generated_image_scoped(
        db, context, draft_id, generation_id, storage_path,
    ):
        Transactions(db).rollback()
        raise _failure(
            ErrorKind.CONFLICT,
            "This image generation attempt is no longer active.",
        )
    Transactions(db).commit()

    try:
        preview_url = get_marketing_image_url(storage_path, context=context)
    except Exception as exc:
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Image saved, but its preview URL could not be created. "
            "Retry preview later.",
        ) from exc
    return {
        "draft_id": draft_id,
        "image_status": "completed",
        "image_url": preview_url,
    }


def image_preview(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
) -> dict[str, str]:
    context, draft = _draft(
        db, principal, draft_id, Permission.READ, include_deleted=True,
    )
    if not draft.image_url:
        raise _failure(ErrorKind.NOT_FOUND, "This draft does not have an image")
    return {
        "draft_id": draft.id,
        "image_status": draft.image_status,
        "image_url": get_marketing_image_url(draft.image_url, context=context),
    }


def reset_image(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
) -> dict[str, str]:
    context, _draft_record = _pending_draft(
        db, principal, draft_id, Permission.GENERATE_MEDIA,
    )
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    if not repository.reset_image_generation_scoped(db, context, draft_id, cutoff):
        Transactions(db).rollback()
        _draft(db, principal, draft_id, Permission.GENERATE_MEDIA)
        raise _failure(
            ErrorKind.CONFLICT,
            "Image generation cannot be reset yet. "
            "It may still be running or already completed.",
        )
    Transactions(db).commit()
    return {
        "draft_id": draft_id,
        "image_status": "failed",
        "message": "Generation marked as failed. A new attempt can be requested manually.",
    }


def _revision_response(
    revision: ImageRevision,
    context: TenantAccess,
) -> dict:
    preview_url = (
        get_marketing_image_url(revision.revised_image_path, context=context)
        if revision.revised_image_path
        else None
    )
    return {
        "id": revision.id,
        "draft_id": revision.draft_id,
        "instructions": revision.instructions,
        "status": revision.status,
        "created_at": revision.created_at,
        "image_url": preview_url,
    }


def create_image_revision(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
    instructions: str,
) -> dict:
    instructions = instructions.strip()
    if not instructions:
        raise _failure(
            ErrorKind.UNPROCESSABLE_ENTITY,
            "Editing instructions cannot be empty",
        )

    context, draft = _pending_draft(
        db, principal, draft_id, Permission.GENERATE_MEDIA,
    )
    if not repository.lock_draft_revisions_scoped(db, context, draft_id):
        Transactions(db).rollback()
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    context, draft = _pending_draft(
        db, principal, draft_id, Permission.GENERATE_MEDIA,
    )
    if (
        draft.image_status != "completed"
        or not draft.image_url
        or not draft.business_id
    ):
        raise _failure(
            ErrorKind.CONFLICT,
            "Generate the original image before editing it",
        )
    if repository.active_revision_scoped(db, context, draft_id) is not None:
        raise _failure(
            ErrorKind.CONFLICT,
            "This draft already has an active image revision. "
            "Review or reject it before requesting another.",
        )

    revision = ImageRevision(
        draft_id=draft.id,
        original_image_path=draft.image_url,
        instructions=instructions,
        status="generating",
    )
    revision_id = repository.add_revision_scoped(db, context, revision)
    if revision_id is None:
        Transactions(db).rollback()
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    Transactions(db).commit()
    original_path = revision.original_image_path
    business_id = context.business_id
    try:
        original_bytes = download_marketing_image(
            storage_path=original_path,
            business_id=business_id,
        )
        revised_path = edit_marketing_image(
            original_image_bytes=original_bytes,
            edit_instructions=instructions,
            business_id=business_id,
        )
    except Exception as exc:
        Transactions(db).rollback()
        repository.mark_revision_failed_scoped(db, context, revision_id)
        Transactions(db).commit()
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Image editing failed. The original image was not changed.",
        ) from exc

    try:
        context = access.require_draft_permission(
            db, principal, draft_id, Permission.GENERATE_MEDIA,
        )
    except ApplicationError:
        Transactions(db).rollback()
        repository.mark_revision_failed_scoped(db, context, revision_id)
        Transactions(db).commit()
        raise
    if not repository.lock_draft_revisions_scoped(db, context, draft_id):
        Transactions(db).rollback()
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    draft = drafts.get_draft_scoped(db, context, draft_id)
    if draft is None:
        repository.mark_revision_rejected_scoped(db, context, revision_id)
        Transactions(db).commit()
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    if draft.status != "pending" or draft.image_url != original_path:
        repository.mark_revision_rejected_scoped(db, context, revision_id)
        Transactions(db).commit()
        raise _failure(
            ErrorKind.CONFLICT,
            "The original image or draft changed during editing. "
            "The proposed revision was not applied.",
        )
    if not repository.save_ready_revision_scoped(
        db, context, revision_id, revised_path,
    ):
        Transactions(db).rollback()
        raise _failure(ErrorKind.CONFLICT, "This revision is no longer active")
    Transactions(db).commit()
    return _revision_response(
        _revision(db, context, draft_id, revision_id), context,
    )


def list_image_revisions(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
) -> list[dict]:
    context, _draft_record = _draft(db, principal, draft_id, Permission.READ)
    return [
        _revision_response(revision, context)
        for revision in repository.list_revisions_scoped(db, context, draft_id)
    ]


def accept_image_revision(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
    revision_id: str,
) -> dict:
    context, draft = _pending_draft(
        db, principal, draft_id, Permission.GENERATE_MEDIA,
    )
    if not repository.lock_draft_revisions_scoped(db, context, draft_id):
        Transactions(db).rollback()
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    context, draft = _pending_draft(
        db, principal, draft_id, Permission.GENERATE_MEDIA,
    )
    revision = _revision(db, context, draft_id, revision_id)
    if revision.status != "ready" or not revision.revised_image_path:
        raise _failure(ErrorKind.CONFLICT, "Only ready revisions can be accepted")
    if draft.image_url != revision.original_image_path:
        raise _failure(
            ErrorKind.CONFLICT,
            "The draft image has changed since this revision was created.",
        )
    if not repository.accept_image_revision_scoped(
        db,
        context,
        draft_id,
        revision_id,
        expected_image_path=revision.original_image_path,
        revised_image_path=revision.revised_image_path,
    ):
        Transactions(db).rollback()
        raise _failure(ErrorKind.CONFLICT, "This revision is no longer active")
    Transactions(db).commit()
    return {
        "draft_id": draft_id,
        "revision_id": revision_id,
        "status": "accepted",
        "image_url": get_marketing_image_url(
            revision.revised_image_path, context=context,
        ),
    }


def reject_image_revision(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
    revision_id: str,
) -> dict[str, str]:
    context, _draft_record = _pending_draft(
        db, principal, draft_id, Permission.GENERATE_MEDIA,
    )
    if not repository.lock_draft_revisions_scoped(db, context, draft_id):
        Transactions(db).rollback()
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    context, _draft_record = _pending_draft(
        db, principal, draft_id, Permission.GENERATE_MEDIA,
    )
    revision = _revision(db, context, draft_id, revision_id)
    if revision.status != "ready":
        raise _failure(ErrorKind.CONFLICT, "Only ready revisions can be rejected")
    if not repository.update_revision_scoped(
        db,
        context,
        draft_id,
        revision_id,
        expected_status="ready",
        status="rejected",
    ):
        Transactions(db).rollback()
        raise _failure(ErrorKind.CONFLICT, "This revision is no longer active")
    Transactions(db).commit()
    return {
        "draft_id": draft_id,
        "revision_id": revision_id,
        "status": "rejected",
        "message": "Original image preserved",
    }
