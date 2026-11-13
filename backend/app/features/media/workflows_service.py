"""Manual video upload, image generation and revision workflows."""
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.drafts import service as draft_service
from app.features.drafts.service import DraftError, DraftErrorKind
from app.image_service import edit_marketing_image, generate_marketing_image
from app.models import Draft, ImageRevision
from app.storage_service import (
    download_marketing_image,
    get_marketing_image_url,
    upload_marketing_video,
)
from app.transactions import Transactions
from . import generation_service, repository

logger = logging.getLogger(__name__)
MAX_MANUAL_VIDEO_SIZE = 100 * 1024 * 1024


def _failure(kind: ErrorKind, detail: str) -> ApplicationError:
    return ApplicationError(kind, detail)


def _draft(db: Session, draft_id: str, *, include_deleted: bool = False) -> Draft:
    try:
        return draft_service.require_draft(
            db,
            draft_id,
            include_deleted=include_deleted,
        )
    except DraftError as exc:
        if exc.kind is DraftErrorKind.NOT_FOUND:
            raise _failure(ErrorKind.NOT_FOUND, "Draft not found") from exc
        raise


def _pending_draft(db: Session, draft_id: str) -> Draft:
    try:
        return draft_service.require_pending_draft(db, draft_id)
    except DraftError as exc:
        if exc.kind is DraftErrorKind.NOT_FOUND:
            raise _failure(ErrorKind.NOT_FOUND, "Draft not found") from exc
        if exc.kind is DraftErrorKind.NOT_PENDING:
            raise _failure(
                ErrorKind.CONFLICT,
                "Only pending drafts can be edited",
            ) from exc
        raise


def _revision(db: Session, draft_id: str, revision_id: str) -> ImageRevision:
    revision = repository.get_revision(db, draft_id, revision_id)
    if revision is None:
        raise _failure(ErrorKind.NOT_FOUND, "Image revision not found")
    return revision


def prepare_manual_video_upload(db: Session, draft_id: str) -> Draft:
    draft = _pending_draft(db, draft_id)
    if (
        draft.video_status in ("generating", "completed", "uploading")
        or generation_service.has_active_generation(db, draft.id)
        or generation_service.has_unstored_generation(db, draft.id)
    ):
        raise _failure(
            ErrorKind.CONFLICT,
            "This draft already has a video or an active video operation",
        )
    return draft


def save_manual_video_upload(
    db: Session,
    draft: Draft,
    video_bytes: bytes,
) -> dict[str, str]:
    try:
        storage_path = upload_marketing_video(
            video_bytes=video_bytes,
            business_id=draft.business_id,
        )
    except ValueError as exc:
        raise _failure(ErrorKind.INVALID_INPUT, str(exc)) from exc

    draft.media_type = "video"
    draft.video_url = storage_path
    draft.video_status = "completed"
    draft.video_generation_id = None
    transactions = Transactions(db)
    transactions.commit()
    transactions.refresh(draft)
    return {
        "draft_id": draft.id,
        "media_type": draft.media_type,
        "video_status": draft.video_status,
    }


def video_preview(db: Session, draft_id: str) -> dict[str, str]:
    draft = _draft(db, draft_id, include_deleted=True)
    if (
        draft.media_type != "video"
        or draft.video_status != "completed"
        or not draft.video_url
    ):
        raise _failure(
            ErrorKind.NOT_FOUND,
            "No completed video available for this draft",
        )
    expected_prefix = f"businesses/{draft.business_id}/"
    if not draft.video_url.startswith(expected_prefix) or not draft.video_url.endswith(".mp4"):
        raise _failure(ErrorKind.INVALID_INPUT, "Invalid video storage path")
    return {
        "draft_id": draft.id,
        "video_url": get_marketing_image_url(draft.video_url, expires_in=900),
    }


def generate_image(db: Session, draft_id: str) -> dict[str, str]:
    draft = _pending_draft(db, draft_id)
    if (
        draft.video_url
        or draft.video_status in (
            "pending",
            "generating",
            "uploading",
            "needs_review",
            "completed",
        )
        or generation_service.has_active_generation(db, draft.id)
        or generation_service.has_unstored_generation(db, draft.id)
    ):
        raise _failure(
            ErrorKind.CONFLICT,
            "A video or video operation already exists",
        )

    generation_id = str(uuid4())
    if not repository.reserve_image_generation(
        db,
        draft_id,
        generation_id,
        datetime.now(timezone.utc),
    ):
        Transactions(db).rollback()
        _draft(db, draft_id)
        raise _failure(
            ErrorKind.CONFLICT,
            "Image generation is unavailable for this draft. "
            "It may already be generating or completed.",
        )
    Transactions(db).commit()

    draft = _draft(db, draft_id)
    image_prompt = draft.image_prompt
    business_id = draft.business_id
    try:
        storage_path = generate_marketing_image(
            image_prompt=image_prompt,
            business_id=business_id,
        )
    except Exception as exc:
        logger.exception(
            "Image generation failed for draft %s: error_type=%s",
            draft_id,
            type(exc).__name__,
        )
        transactions = Transactions(db)
        transactions.rollback()
        repository.mark_image_generation_failed(db, draft_id, generation_id)
        transactions.commit()
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Image generation failed. Please try again later.",
        ) from exc

    transactions = Transactions(db)
    transactions.expire_all()
    if not repository.save_generated_image(
        db,
        draft_id,
        generation_id,
        storage_path,
    ):
        transactions.rollback()
        raise _failure(
            ErrorKind.CONFLICT,
            "This image generation attempt is no longer active.",
        )
    transactions.commit()

    try:
        preview_url = get_marketing_image_url(storage_path)
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


def image_preview(db: Session, draft_id: str) -> dict[str, str]:
    draft = _draft(db, draft_id, include_deleted=True)
    if not draft.image_url:
        raise _failure(ErrorKind.NOT_FOUND, "This draft does not have an image")
    return {
        "draft_id": draft.id,
        "image_status": draft.image_status,
        "image_url": get_marketing_image_url(draft.image_url, expires_in=3600),
    }


def reset_image(db: Session, draft_id: str) -> dict[str, str]:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    if not repository.reset_image_generation(db, draft_id, cutoff):
        Transactions(db).rollback()
        _draft(db, draft_id)
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


def _revision_response(revision: ImageRevision) -> dict:
    preview_url = (
        get_marketing_image_url(revision.revised_image_path)
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
    draft_id: str,
    instructions: str,
) -> dict:
    instructions = instructions.strip()
    if not instructions:
        raise _failure(
            ErrorKind.UNPROCESSABLE_ENTITY,
            "Editing instructions cannot be empty",
        )

    repository.lock_draft_revisions(db, draft_id)
    draft = _pending_draft(db, draft_id)
    if (
        draft.image_status != "completed"
        or not draft.image_url
        or not draft.business_id
    ):
        raise _failure(
            ErrorKind.CONFLICT,
            "Generate the original image before editing it",
        )
    if repository.active_revision(db, draft_id) is not None:
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
    repository.add_revision(db, revision)
    transactions = Transactions(db)
    transactions.commit()
    transactions.refresh(revision)

    revision_id = revision.id
    original_path = revision.original_image_path
    business_id = draft.business_id
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
        transactions.rollback()
        repository.mark_revision_failed(db, revision_id)
        transactions.commit()
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Image editing failed. The original image was not changed.",
        ) from exc

    repository.lock_draft_revisions(db, draft_id)
    transactions.expire_all()
    draft = _draft(db, draft_id)
    if draft.status != "pending" or draft.image_url != original_path:
        repository.mark_revision_rejected(db, revision_id)
        transactions.commit()
        raise _failure(
            ErrorKind.CONFLICT,
            "The original image or draft changed during editing. "
            "The proposed revision was not applied.",
        )
    if not repository.save_ready_revision(db, revision_id, revised_path):
        transactions.rollback()
        raise _failure(ErrorKind.CONFLICT, "This revision is no longer active")
    transactions.commit()
    return _revision_response(_revision(db, draft_id, revision_id))


def list_image_revisions(db: Session, draft_id: str) -> list[dict]:
    _draft(db, draft_id)
    return [
        _revision_response(revision)
        for revision in repository.list_revisions(db, draft_id)
    ]


def accept_image_revision(
    db: Session,
    draft_id: str,
    revision_id: str,
) -> dict:
    repository.lock_draft_revisions(db, draft_id)
    draft = _pending_draft(db, draft_id)
    revision = _revision(db, draft_id, revision_id)
    if revision.status != "ready" or not revision.revised_image_path:
        raise _failure(ErrorKind.CONFLICT, "Only ready revisions can be accepted")
    if draft.image_url != revision.original_image_path:
        raise _failure(
            ErrorKind.CONFLICT,
            "The draft image has changed since this revision was created.",
        )

    draft.image_url = revision.revised_image_path
    revision.status = "accepted"
    Transactions(db).commit()
    return {
        "draft_id": draft_id,
        "revision_id": revision_id,
        "status": "accepted",
        "image_url": get_marketing_image_url(revision.revised_image_path),
    }


def reject_image_revision(
    db: Session,
    draft_id: str,
    revision_id: str,
) -> dict[str, str]:
    repository.lock_draft_revisions(db, draft_id)
    _pending_draft(db, draft_id)
    revision = _revision(db, draft_id, revision_id)
    if revision.status != "ready":
        raise _failure(ErrorKind.CONFLICT, "Only ready revisions can be rejected")
    revision.status = "rejected"
    Transactions(db).commit()
    return {
        "draft_id": draft_id,
        "revision_id": revision_id,
        "status": "rejected",
        "message": "Original image preserved",
    }
