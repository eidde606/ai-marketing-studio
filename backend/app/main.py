from datetime import datetime, timedelta, timezone
import logging
import os
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.campaign_routes import router as campaign_router
from app.facebook_service import (
    get_page_info,
)
from app.features.businesses.routes import router as business_router
from app.features.facebook.routes import router as facebook_auth_router
from app.features.facebook.publishing_routes import (
    router as facebook_publishing_router,
)
from app.features.content.routes import router as content_router
from app.features.drafts.routes import router as draft_router
from app.features.drafts.routes import draft_http_exception
from app.features.drafts import service as draft_service
from app.features.analytics.routes import router as analytics_router
from app.features.tiktok import service as tiktok_oauth_service
from app.errors import ApplicationError
from app.http_errors import http_error
from app.features.instagram.routes import (
    InstagramCallbackAccessLogRedactionMiddleware,
    router as instagram_auth_router,
)
from app.features.media.routes import router as media_router
from app.features.media.routes import webhook_router as heygen_webhook_router
from app.features.media.generation_service import (
    has_active_generation,
    has_unstored_generation,
)
from app.auth import verify_token
from app.database import get_db
from app.models import Business, Draft, ImageRevision, SocialAccount
from app.image_service import (
    edit_marketing_image,
    generate_marketing_image,
)
from app.storage_service import (
    download_marketing_image,
    get_marketing_image_url,
    get_storage_client,
    upload_marketing_video,
)
from app.tiktok_service import (
    get_creator_info,
    get_tiktok_publish_status,
    publish_tiktok_photo,
    publish_tiktok_video,
    publish_tiktok_video_file,
)
from app.features.tiktok.routes import router as tiktok_auth_router
from app.token_service import decrypt_token, encrypt_token

app = FastAPI()
app.add_middleware(InstagramCallbackAccessLogRedactionMiddleware)

# Only Ángela's authorized Supabase account can access these endpoints.
protected = APIRouter(dependencies=[Depends(verify_token)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "https://nazbort-ai-marketing-studio.netlify.app",
        "https://nazbort-ai-studio.netlify.app",
        "https://studio.nazborttech.com",
    ],
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

logger = logging.getLogger(__name__)


class TikTokPublishRequest(BaseModel):
    account_id: str = Field(min_length=1)
    privacy_level: str = Field(min_length=1)
    disable_comment: bool = False
    disable_duet: bool = False
    disable_stitch: bool = False


class ImageRevisionRequest(BaseModel):
    instructions: str = Field(
        min_length=1,
        max_length=1000,
    )


# --------------------------------------------------
# Helpers
# --------------------------------------------------


async def get_valid_tiktok_token(
        account: SocialAccount,
        db: Session,
) -> str:
    try:
        return await tiktok_oauth_service.get_valid_access_token(
            account,
            db=db,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


# Compatibility wrapper for legacy handlers; remove when those handlers are extracted.
def require_draft(
        db: Session, draft_id: str, *, include_deleted: bool = False,
) -> Draft:
    try:
        return draft_service.require_draft(
            db, draft_id, include_deleted=include_deleted,
        )
    except draft_service.DraftError as exc:
        raise draft_http_exception(exc) from exc


# Compatibility wrapper for legacy handlers; remove when those handlers are extracted.
def require_pending_draft(db: Session, draft_id: str) -> Draft:
    try:
        return draft_service.require_pending_draft(db, draft_id)
    except draft_service.DraftError as exc:
        raise draft_http_exception(exc) from exc


def lock_draft_revisions(db: Session, draft_id: str) -> None:
    """
    PostgreSQL transaction-level advisory lock.

    Serializes revision creation, acceptance and rejection
    for the same draft across concurrent API requests.
    """

    db.execute(select(func.pg_advisory_xact_lock(func.hashtext(draft_id))))


def require_revision(
        db: Session,
        draft_id: str,
        revision_id: str,
) -> ImageRevision:
    revision = db.get(ImageRevision, revision_id)

    if revision is None or revision.draft_id != draft_id:
        raise HTTPException(
            status_code=404,
            detail="Image revision not found",
        )

    return revision


def revision_response(revision: ImageRevision) -> dict:
    """Return revision metadata and a temporary preview URL."""

    preview_url = None

    if revision.revised_image_path:
        preview_url = get_marketing_image_url(revision.revised_image_path)

    return {
        "id": revision.id,
        "draft_id": revision.draft_id,
        "instructions": revision.instructions,
        "status": revision.status,
        "created_at": revision.created_at,
        "image_url": preview_url,
    }


# --------------------------------------------------
# Public Endpoints
# --------------------------------------------------


@app.get("/health")
def health():
    return {"status": "healthy"}


# --------------------------------------------------
# Facebook Endpoints
# --------------------------------------------------


@protected.get("/facebook/page")
async def get_facebook_page():
    page_id = os.getenv("FACEBOOK_PAGE_ID")
    access_token = os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN")
    if not page_id or not access_token:
        raise HTTPException(status_code=503, detail="Facebook is not configured")

    try:
        return await get_page_info(page_id, access_token)
    except httpx.HTTPStatusError:
        raise HTTPException(status_code=502, detail="Unable to retrieve Facebook Page")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Facebook connection failed")


@protected.get("/drafts/{draft_id}/tiktok-creator-info")
async def get_draft_tiktok_creator_info(
        draft_id: str,
        account_id: str,
        db: Session = Depends(get_db),
):
    draft = require_draft(db, draft_id)

    account = db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == draft.business_id,
            SocialAccount.id == account_id,
            SocialAccount.platform == "tiktok",
            SocialAccount.connection_status == "connected",
        )
    )

    if account is None:
        raise HTTPException(
            status_code=409,
            detail="Connect TikTok first",
        )

    access_token = await get_valid_tiktok_token(account, db)

    try:
        return await get_creator_info(access_token)
    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve TikTok publishing settings",
        ) from None


@protected.post("/drafts/{draft_id}/publish-tiktok")
async def publish_draft_to_tiktok(
        draft_id: str,
        request: TikTokPublishRequest,
        db: Session = Depends(get_db),
):
    draft = require_draft(db, draft_id)

    if "tiktok" not in (draft.publish_destinations or []):
        raise HTTPException(
            status_code=409,
            detail="TikTok is not selected for this draft",
        )

    account = db.scalar(
        select(SocialAccount).where(
            SocialAccount.id == request.account_id,
            SocialAccount.business_id == draft.business_id,
            SocialAccount.platform == "tiktok",
            SocialAccount.connection_status == "connected",
        )
    )

    if account is None:
        raise HTTPException(
            status_code=409,
            detail="Connect TikTok first",
        )

    # Validate media before claiming the draft.
    if draft.media_type == "video":
        if draft.video_status != "completed" or not draft.video_url:
            raise HTTPException(
                status_code=409,
                detail="A completed video is required",
            )
        storage_path = draft.video_url

    elif draft.image_url:
        storage_path = draft.image_url

    else:
        raise HTTPException(
            status_code=409,
            detail="TikTok requires an image or video",
        )

    # Photo posting still requires a TikTok-verified public media URL.
    # Reject before claiming the draft so the user can retry after setup.
    if draft.media_type != "video":
        raise HTTPException(
            status_code=409,
            detail="TikTok photo publishing requires a verified media URL; not configured yet",
        )

    expected_prefix = f"businesses/{draft.business_id}/"

    if not storage_path.startswith(expected_prefix):
        raise HTTPException(
            status_code=400,
            detail="Invalid media storage path",
        )

    # Download and validate before claiming the draft.
    try:
        bucket = os.environ["SUPABASE_STORAGE_BUCKET"]
        video_bytes = get_storage_client().storage.from_(bucket).download(storage_path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Unable to download TikTok video") from exc

    if not isinstance(video_bytes, bytes) or video_bytes[4:8] != b"ftyp":
        raise HTTPException(status_code=400, detail="Invalid MP4 video")
    if not 5 * 1024 * 1024 <= len(video_bytes) <= 64 * 1024 * 1024:
        raise HTTPException(status_code=409, detail="Video must be 5–64 MiB for current TikTok uploader")

    # Check creator's allowed privacy settings before claiming publication.
    access_token = await get_valid_tiktok_token(account, db)
    try:
        creator = await get_creator_info(access_token)
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=502, detail="Unable to validate TikTok settings") from exc
    if request.privacy_level not in creator.get("privacy_level_options", []):
        raise HTTPException(status_code=422, detail="Privacy option not permitted by TikTok")

    # Only one request can claim this draft.
    claimed = db.execute(
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.deleted_at.is_(None),
            Draft.status == "approved",
            Draft.tiktok_publish_status == "not_published",
            Draft.tiktok_publish_id.is_(None),
        )
        .values(
            tiktok_publish_status="publishing",
            tiktok_account_id=account.id,
        )
        .returning(Draft.id)
    )

    if claimed.scalar_one_or_none() is None:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Draft is not eligible for TikTok publishing",
        )

    db.commit()

    try:
        result = await publish_tiktok_video_file(
            access_token=access_token,
            video_bytes=video_bytes,
            caption=draft.caption,
            privacy_level=request.privacy_level,
            disable_comment=request.disable_comment,
            disable_duet=request.disable_duet,
            disable_stitch=request.disable_stitch,
        )

        publish_id = result.get("publish_id")

        if not publish_id:
            raise ValueError("TikTok returned no publish ID")

        draft.tiktok_publish_id = publish_id
        draft.tiktok_publish_status = "needs_review"
        db.commit()

        return {
            "status": "processing",
            "tiktok_publish_id": publish_id,
        }

    except Exception as exc:
        db.rollback()
        draft = require_draft(db, draft_id)
        draft.tiktok_publish_status = "needs_review"
        db.commit()

        logger.exception(
            "TikTok publishing requires review for draft %s",
            draft_id,
        )

        raise HTTPException(
            status_code=502,
            detail="TikTok publishing outcome requires review",
        ) from exc


@protected.post("/drafts/{draft_id}/verify-tiktok")
async def verify_tiktok_publication(
        draft_id: str,
        db: Session = Depends(get_db),
):
    draft = require_draft(db, draft_id, include_deleted=True)

    if not draft.tiktok_publish_id:
        raise HTTPException(
            status_code=409,
            detail="No TikTok publication to verify",
        )

    account = db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == draft.business_id,
            SocialAccount.id == draft.tiktok_account_id,
            SocialAccount.platform == "tiktok",
            SocialAccount.connection_status == "connected",
        )
    )

    if account is None:
        raise HTTPException(
            status_code=409,
            detail="TikTok is not connected",
        )

    access_token = await get_valid_tiktok_token(account, db)

    try:
        result = await get_tiktok_publish_status(
            access_token=access_token,
            publish_id=draft.tiktok_publish_id,
        )
    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=502,
            detail="Unable to verify TikTok publication",
        ) from None

    status = result.get("status")

    if status == "PUBLISH_COMPLETE":
        draft.tiktok_publish_status = "published"
        draft.published_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "published"}

    if status == "FAILED":
        draft.tiktok_publish_status = "needs_review"
        db.commit()
        return {"status": "failed"}

    return {
        "status": "processing",
        "tiktok_status": status,
    }


@protected.post("/drafts/{draft_id}/upload-video")
def upload_draft_video(
        draft_id: str,
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
):
    draft = require_pending_draft(db, draft_id)

    if (
        draft.video_status in ("generating", "completed", "uploading")
        or has_active_generation(db, draft.id)
        or has_unstored_generation(db, draft.id)
    ):
        raise HTTPException(
            status_code=409,
            detail="This draft already has a video or an active video operation",
        )

    if file.content_type != "video/mp4":
        raise HTTPException(
            status_code=415,
            detail="Only MP4 videos are supported",
        )

    max_size = 100 * 1024 * 1024

    video_bytes = file.file.read(max_size + 1)

    if len(video_bytes) > max_size:
        raise HTTPException(
            status_code=413,
            detail="Video exceeds the 100 MB limit",
        )

    try:
        storage_path = upload_marketing_video(
            video_bytes=video_bytes,
            business_id=draft.business_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    draft.media_type = "video"
    draft.video_url = storage_path
    draft.video_status = "completed"
    draft.video_generation_id = None

    db.commit()
    db.refresh(draft)

    return {
        "draft_id": draft.id,
        "media_type": draft.media_type,
        "video_status": draft.video_status,
    }


@protected.get("/drafts/{draft_id}/video-preview")
def get_draft_video_preview(
        draft_id: str,
        db: Session = Depends(get_db),
):
    draft = require_draft(db, draft_id, include_deleted=True)

    if (
            draft.media_type != "video"
            or draft.video_status != "completed"
            or not draft.video_url
    ):
        raise HTTPException(
            status_code=404,
            detail="No completed video available for this draft",
        )

    expected_prefix = f"businesses/{draft.business_id}/"

    if (
            not draft.video_url.startswith(expected_prefix)
            or not draft.video_url.endswith(".mp4")
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid video storage path",
        )

    signed_url = get_marketing_image_url(
        draft.video_url,
        expires_in=900,
    )

    return {
        "draft_id": draft.id,
        "video_url": signed_url,
    }



# --------------------------------------------------
# AI Image Generation
# --------------------------------------------------


@protected.post("/drafts/{draft_id}/generate-image")
def generate_draft_image(
        draft_id: str,
        db: Session = Depends(get_db),
):
    # Serialize with HeyGen's draft-row reservation. A predicate on the image
    # UPDATE alone cannot safely check a concurrently inserted video attempt.
    draft = require_pending_draft(db, draft_id)
    if (
        draft.video_url
        or draft.video_status in ("pending", "generating", "uploading", "needs_review", "completed")
        or has_active_generation(db, draft.id)
        or has_unstored_generation(db, draft.id)
    ):
        raise HTTPException(status_code=409, detail="A video or video operation already exists")

    generation_id = str(uuid4())

    reservation = db.execute(
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
            image_started_at=datetime.now(timezone.utc),
            image_generation_id=generation_id,
        )
        .returning(Draft.id)
    ).first()

    if reservation is None:
        db.rollback()

        require_draft(db, draft_id)

        raise HTTPException(
            status_code=409,
            detail=(
                "Image generation is unavailable for this draft. "
                "It may already be generating or completed."
            ),
        )

    db.commit()

    draft = require_draft(db, draft_id)

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
        db.rollback()

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

        db.commit()

        raise HTTPException(
            status_code=502,
            detail="Image generation failed. Please try again later.",
        ) from exc

    db.expire_all()

    saved = db.execute(
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
    ).first()

    if saved is None:
        db.rollback()

        raise HTTPException(
            status_code=409,
            detail="This image generation attempt is no longer active.",
        )

    db.commit()

    try:
        signed_url = get_marketing_image_url(storage_path)

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Image saved, but its preview URL could not "
                "be created. Retry preview later."
            ),
        ) from exc

    return {
        "draft_id": draft_id,
        "image_status": "completed",
        "image_url": signed_url,
    }


# --------------------------------------------------
# Original Image Preview
# --------------------------------------------------


@protected.get("/drafts/{draft_id}/image")
def get_draft_image(
        draft_id: str,
        db: Session = Depends(get_db),
):
    draft = require_draft(db, draft_id, include_deleted=True)

    if not draft.image_url:
        raise HTTPException(
            status_code=404,
            detail="This draft does not have an image",
        )

    signed_url = get_marketing_image_url(
        draft.image_url,
        expires_in=3600,
    )

    return {
        "draft_id": draft.id,
        "image_status": draft.image_status,
        "image_url": signed_url,
    }


# --------------------------------------------------
# Recover Interrupted Original Image Generation
# --------------------------------------------------


@protected.post("/drafts/{draft_id}/reset-image")
def reset_stuck_image(
        draft_id: str,
        db: Session = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)

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
    ).first()

    if result is None:
        db.rollback()

        require_draft(db, draft_id)

        raise HTTPException(
            status_code=409,
            detail=(
                "Image generation cannot be reset yet. "
                "It may still be running or already completed."
            ),
        )

    db.commit()

    return {
        "draft_id": draft_id,
        "image_status": "failed",
        "message": (
            "Generation marked as failed. " "A new attempt can be requested manually."
        ),
    }


# --------------------------------------------------
# AI Image Revisions
# --------------------------------------------------


@protected.post(
    "/drafts/{draft_id}/image-revisions",
    status_code=201,
)
def create_image_revision(
        draft_id: str,
        request: ImageRevisionRequest,
        db: Session = Depends(get_db),
):
    """
    Create a proposed edited image.

    The original draft image remains unchanged.
    This operation calls the paid OpenAI image API.
    """

    instructions = request.instructions.strip()

    if not instructions:
        raise HTTPException(
            status_code=422,
            detail="Editing instructions cannot be empty",
        )

    lock_draft_revisions(db, draft_id)

    draft = require_pending_draft(db, draft_id)

    if (
            draft.image_status != "completed"
            or not draft.image_url
            or not draft.business_id
    ):
        raise HTTPException(
            status_code=409,
            detail="Generate the original image before editing it",
        )

    active_revision = db.scalar(
        select(ImageRevision)
        .where(
            ImageRevision.draft_id == draft_id,
            ImageRevision.status.in_(["generating", "ready"]),
        )
        .limit(1)
    )

    if active_revision is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                "This draft already has an active image revision. "
                "Review or reject it before requesting another."
            ),
        )

    revision = ImageRevision(
        draft_id=draft.id,
        original_image_path=draft.image_url,
        instructions=instructions,
        status="generating",
    )

    db.add(revision)
    db.commit()
    db.refresh(revision)

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
        db.rollback()

        db.execute(
            update(ImageRevision)
            .where(
                ImageRevision.id == revision_id,
                ImageRevision.status == "generating",
            )
            .values(status="failed")
        )

        db.commit()

        raise HTTPException(
            status_code=502,
            detail=("Image editing failed. " "The original image was not changed."),
        ) from exc

    lock_draft_revisions(db, draft_id)

    db.expire_all()
    draft = require_draft(db, draft_id)

    if draft.status != "pending" or draft.image_url != original_path:
        db.execute(
            update(ImageRevision)
            .where(
                ImageRevision.id == revision_id,
                ImageRevision.status == "generating",
            )
            .values(status="rejected")
        )

        db.commit()

        raise HTTPException(
            status_code=409,
            detail=(
                "The original image or draft changed during editing. "
                "The proposed revision was not applied."
            ),
        )

    saved = db.execute(
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
    ).first()

    if saved is None:
        db.rollback()

        raise HTTPException(
            status_code=409,
            detail="This revision is no longer active",
        )

    db.commit()

    revision = require_revision(
        db,
        draft_id,
        revision_id,
    )

    return revision_response(revision)


@protected.get("/drafts/{draft_id}/image-revisions")
def list_image_revisions(
        draft_id: str,
        db: Session = Depends(get_db),
):
    require_draft(db, draft_id)

    revisions = db.scalars(
        select(ImageRevision)
        .where(ImageRevision.draft_id == draft_id)
        .order_by(ImageRevision.created_at.desc())
    ).all()

    return [revision_response(revision) for revision in revisions]


@protected.post("/drafts/{draft_id}/image-revisions/{revision_id}/accept")
def accept_image_revision(
        draft_id: str,
        revision_id: str,
        db: Session = Depends(get_db),
):
    """
    Accept the proposed image.

    The draft now points to the revised image.
    The original storage object is not deleted.
    """

    lock_draft_revisions(db, draft_id)

    draft = require_pending_draft(db, draft_id)

    revision = require_revision(
        db,
        draft_id,
        revision_id,
    )

    if revision.status != "ready" or not revision.revised_image_path:
        raise HTTPException(
            status_code=409,
            detail="Only ready revisions can be accepted",
        )

    if draft.image_url != revision.original_image_path:
        raise HTTPException(
            status_code=409,
            detail=("The draft image has changed since this " "revision was created."),
        )

    draft.image_url = revision.revised_image_path
    revision.status = "accepted"

    db.commit()

    return {
        "draft_id": draft_id,
        "revision_id": revision_id,
        "status": "accepted",
        "image_url": get_marketing_image_url(revision.revised_image_path),
    }


@protected.post("/drafts/{draft_id}/image-revisions/{revision_id}/reject")
def reject_image_revision(
        draft_id: str,
        revision_id: str,
        db: Session = Depends(get_db),
):
    """
    Reject a proposed image.

    The original image remains unchanged.
    """

    lock_draft_revisions(db, draft_id)

    require_pending_draft(db, draft_id)

    revision = require_revision(
        db,
        draft_id,
        revision_id,
    )

    if revision.status != "ready":
        raise HTTPException(
            status_code=409,
            detail="Only ready revisions can be rejected",
        )

    revision.status = "rejected"

    db.commit()

    return {
        "draft_id": draft_id,
        "revision_id": revision_id,
        "status": "rejected",
        "message": "Original image preserved",
    }


# --------------------------------------------------
# Register Protected Endpoints
# --------------------------------------------------

app.include_router(protected)
app.include_router(draft_router)
app.include_router(business_router)
app.include_router(campaign_router)
app.include_router(media_router)
app.include_router(heygen_webhook_router)
app.include_router(facebook_auth_router)
app.include_router(facebook_publishing_router)
app.include_router(instagram_auth_router)
app.include_router(analytics_router)

app.include_router(tiktok_auth_router)

app.include_router(content_router)
