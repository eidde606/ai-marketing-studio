from datetime import datetime, timedelta, timezone
from typing import Literal
import os
import httpx
from app.facebook_service import get_page_info, publish_text_post, publish_image_post, publish_video_post
from uuid import uuid4
from app.facebook_service import get_post_insights, get_post_reach

from app.facebook_service import get_video_status as get_facebook_video_status

from app.models import Conversation, ConversationMessage
from app.sofia_service import chat_with_sofia

from fastapi import APIRouter, Depends, FastAPI, HTTPException, UploadFile, File
from app.facebook_auth_routes import router as facebook_auth_router
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
import logging

from app.auth import verify_token
from app.database import get_db
from app.models import Business, Draft, ImageRevision, SocialAccount
from app.token_service import decrypt_token
from app.ai_service import generate_marketing_content
from app.heygen_service import get_available_avatar_looks
from app.heygen_service import generate_video, get_video_status, get_available_voices
from app.image_service import (
    generate_marketing_image,
    edit_marketing_image,
)
from app.storage_service import (
    get_marketing_image_url,
    download_marketing_image,
    upload_marketing_video,
    get_storage_client,
)

from app.tiktok_auth_routes import router as tiktok_auth_router

from app.tiktok_service import (
    get_creator_info,
    publish_tiktok_video,
    publish_tiktok_video_file,
    publish_tiktok_photo,
    get_tiktok_publish_status,
)
from app.tiktok_oauth import refresh_tiktok_token
from app.token_service import encrypt_token

app = FastAPI()

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
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

logger = logging.getLogger(__name__)


# --------------------------------------------------
# Request Models
# --------------------------------------------------


class HeyGenVideoRequest(BaseModel):
    avatar_id: str = Field(min_length=1)
    voice_id: str = Field(min_length=1)
    script: str = Field(min_length=1, max_length=5000)


class SofiaChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None


class DraftCreate(BaseModel):
    business_id: str
    title: str
    caption: str
    platform: str
    media_type: Literal["text", "image", "video"] = "text"


class TikTokPublishRequest(BaseModel):
    account_id: str = Field(min_length=1)
    privacy_level: str = Field(min_length=1)
    disable_comment: bool = False
    disable_duet: bool = False
    disable_stitch: bool = False


class DraftDestinationsUpdate(BaseModel):
    destinations: list[Literal["facebook", "tiktok"]] = Field(
        min_length=1,
        max_length=2,
    )


class DraftUpdate(BaseModel):
    title: str
    caption: str


class BusinessCreate(BaseModel):
    name: str
    description: str | None = None
    target_audience: str | None = None
    brand_voice: str | None = None
    industry: str | None = None
    products_services: str | None = None
    service_area: str | None = None
    website_url: str | None = None
    marketing_goals: str | None = None
    preferred_platforms: str | None = None
    posting_frequency: str | None = None


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
    now = datetime.now(timezone.utc)

    expires_at = account.token_expires_at

    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if expires_at > now + timedelta(minutes=5):
            return decrypt_token(account.encrypted_access_token)

    if not account.encrypted_refresh_token:
        raise HTTPException(
            status_code=409,
            detail="Reconnect your TikTok account",
        )

    try:
        tokens = await refresh_tiktok_token(
            decrypt_token(account.encrypted_refresh_token)
        )
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(
            status_code=409,
            detail="TikTok authorization expired. Reconnect TikTok.",
        ) from None

    account.encrypted_access_token = encrypt_token(tokens["access_token"])
    account.encrypted_refresh_token = encrypt_token(tokens["refresh_token"])
    account.token_expires_at = now + timedelta(
        seconds=int(tokens["expires_in"])
    )

    db.commit()

    return tokens["access_token"]


def require_draft(db: Session, draft_id: str) -> Draft:
    draft = db.get(Draft, draft_id)

    if draft is None:
        raise HTTPException(
            status_code=404,
            detail="Draft not found",
        )

    return draft


def require_pending_draft(db: Session, draft_id: str) -> Draft:
    draft = require_draft(db, draft_id)

    if draft.status != "pending":
        raise HTTPException(
            status_code=409,
            detail="Only pending drafts can be edited",
        )

    return draft


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


@protected.post("/drafts/{draft_id}/publish-facebook")
async def publish_draft_to_facebook(
        draft_id: str,
        db: Session = Depends(get_db),
):
    draft = db.get(Draft, draft_id)

    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")

    account = db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == draft.business_id,
            SocialAccount.platform == "facebook",
            SocialAccount.connection_status == "connected",
        )
    )

    if account is None:
        raise HTTPException(
            status_code=409,
            detail="Connect a Facebook Page to this business first",
        )

    page_id = account.platform_account_id
    access_token = decrypt_token(account.encrypted_access_token)

    claimed = db.execute(
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.status == "approved",
            Draft.facebook_publish_status == "not_published",
            Draft.facebook_post_id.is_(None),
        )
        .values(facebook_publish_status="publishing")
        .returning(Draft.id)
    )
    if claimed.scalar_one_or_none() is None:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Draft is not eligible for Facebook publishing"
        )
    db.commit()

    draft = db.get(Draft, draft_id)

    # ----------------------------------------
    # Facebook VIDEO publishing
    # ----------------------------------------
    if draft.media_type == "video":
        if draft.video_status != "completed" or not draft.video_url:
            draft.facebook_publish_status = "not_published"
            db.commit()
            raise HTTPException(
                status_code=409,
                detail="A completed MP4 is required",
            )

        expected_prefix = f"businesses/{draft.business_id}/"

        if (
                not draft.video_url.startswith(expected_prefix)
                or not draft.video_url.endswith(".mp4")
        ):
            draft.facebook_publish_status = "not_published"
            db.commit()
            raise HTTPException(
                status_code=400,
                detail="Invalid video storage path",
            )

        try:
            signed_url = get_marketing_image_url(
                draft.video_url,
                expires_in=3600,
            )

            response = await publish_video_post(
                page_id=page_id,
                access_token=access_token,
                message=draft.caption,
                video_url=signed_url,
            )

            video_id = response.get("id")

            if not video_id:
                raise ValueError("Facebook returned no video ID")

            draft.facebook_post_id = str(video_id)
            draft.facebook_publish_status = "needs_review"
            db.commit()

            return {
                "status": "processing",
                "facebook_post_id": str(video_id),
            }

        except httpx.HTTPStatusError as exc:
            db.rollback()
            draft = db.get(Draft, draft_id)

            rejected = (
                    400 <= exc.response.status_code < 500
                    and exc.response.status_code != 429
            )

            draft.facebook_publish_status = (
                "not_published" if rejected else "needs_review"
            )
            db.commit()

            raise HTTPException(
                status_code=502,
                detail=(
                    "Facebook rejected the video request"
                    if rejected
                    else "Facebook video submission requires review"
                ),
            ) from exc

        except Exception as exc:
            db.rollback()
            draft = db.get(Draft, draft_id)
            draft.facebook_publish_status = "needs_review"
            db.commit()

            logger.exception(
                "Facebook video publishing outcome uncertain for draft %s",
                draft_id,
            )

            raise HTTPException(
                status_code=502,
                detail="Check Facebook before retrying the video",
            ) from exc

    # ----------------------------------------
    # Existing IMAGE / TEXT publishing
    # ----------------------------------------

    try:
        image_bytes = (
            download_marketing_image(draft.image_url, draft.business_id)
            if draft.image_url
            else None
        )
        if image_bytes is not None:
            # Validate format before sending any request to Facebook.
            if not (
                    image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
                    or image_bytes.startswith(b"\xff\xd8\xff")
                    or (image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP")
            ):
                raise ValueError("Unsupported image data")
    except Exception:
        db.rollback()
        draft = db.get(Draft, draft_id)
        draft.facebook_publish_status = "not_published"
        db.commit()
        raise HTTPException(
            status_code=502, detail="Unable to prepare the marketing image"
        )

    try:
        if image_bytes is not None:
            response = await publish_image_post(
                page_id=page_id,
                access_token=access_token,
                message=draft.caption,
                image_bytes=image_bytes,
            )
            post_id = response.get("post_id") or response.get("id")
        else:
            response = await publish_text_post(
                page_id=page_id,
                access_token=access_token,
                message=draft.caption,
            )
            post_id = response.get("id")

        if not post_id:
            raise ValueError("Facebook returned no publication ID")
        draft.facebook_post_id = str(post_id)
        draft.facebook_publish_status = "published"
        draft.published_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "published", "facebook_post_id": str(post_id)}

    except httpx.HTTPStatusError as exc:
        db.rollback()
        draft = db.get(Draft, draft_id)
        # Explicit Facebook client rejection: request did not publish.
        # Rate limits and 5xx are treated conservatively as uncertain.
        rejected = (
                400 <= exc.response.status_code < 500 and exc.response.status_code != 429
        )
        draft.facebook_publish_status = "not_published" if rejected else "needs_review"
        db.commit()
        if rejected:
            raise HTTPException(
                status_code=502,
                detail="Facebook rejected the request. Check Page token, permissions and image format.",
            )
        raise HTTPException(
            status_code=502, detail="Facebook publishing outcome requires review"
        )
    except Exception:
        db.rollback()
        draft = db.get(Draft, draft_id)
        draft.facebook_publish_status = "needs_review"
        db.commit()
        raise HTTPException(
            status_code=502, detail="Facebook publishing outcome requires review"
        )


@protected.post("/drafts/{draft_id}/verify-facebook-video")
async def verify_facebook_video(
        draft_id: str,
        db: Session = Depends(get_db),
):
    draft = db.get(Draft, draft_id)

    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")

    if draft.media_type != "video" or not draft.facebook_post_id:
        raise HTTPException(
            status_code=409,
            detail="No submitted Facebook video to verify",
        )

    if draft.facebook_publish_status == "published":
        return {
            "status": "published",
            "facebook_post_id": draft.facebook_post_id,
        }

    if draft.facebook_publish_status != "needs_review":
        raise HTTPException(
            status_code=409,
            detail="Video is not awaiting verification",
        )

    account = db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == draft.business_id,
            SocialAccount.platform == "facebook",
            SocialAccount.connection_status == "connected",
        )
    )

    if account is None:
        raise HTTPException(
            status_code=409,
            detail="Facebook Page is not connected",
        )

    access_token = decrypt_token(account.encrypted_access_token)

    try:
        result = await get_facebook_video_status(
            video_id=draft.facebook_post_id,
            access_token=access_token,
        )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Unable to verify Facebook video status",
        )

    status = result.get("status", {})
    video_status = status.get("video_status", "") if isinstance(status, dict) else ""

    if video_status == "ready":
        draft.facebook_publish_status = "published"
        draft.published_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "status": "published",
            "facebook_post_id": draft.facebook_post_id,
        }

    return {
        "status": "processing",
        "facebook_post_id": draft.facebook_post_id,
    }


class FacebookRecoveryRequest(BaseModel):
    confirmed_not_published: bool


@protected.post("/drafts/{draft_id}/reset-facebook-publishing")
def reset_facebook_publishing(
        draft_id: str,
        request: FacebookRecoveryRequest,
        db: Session = Depends(get_db),
):
    """Only after manually confirming the post is absent on Facebook."""
    if not request.confirmed_not_published:
        raise HTTPException(
            status_code=400, detail="Confirm the post is absent on Facebook"
        )
    result = db.execute(
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.status == "approved",
            Draft.facebook_publish_status == "needs_review",
            Draft.facebook_post_id.is_(None),
        )
        .values(facebook_publish_status="not_published")
        .returning(Draft.id)
    )
    if result.scalar_one_or_none() is None:
        db.rollback()
        raise HTTPException(status_code=409, detail="Draft cannot be reset")
    db.commit()
    return {"status": "not_published"}


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
    draft = require_draft(db, draft_id)

    if not draft.tiktok_publish_id:
        raise HTTPException(
            status_code=409,
            detail="No TikTok publication to verify",
        )

    account = db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == draft.business_id,
            SocialAccount.id == draft.tiktok_publish_id,
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


# --------------------------------------------------
# Draft Endpoints
# --------------------------------------------------


@protected.post("/drafts", status_code=201)
def create_draft(
        request: DraftCreate,
        db: Session = Depends(get_db),
):
    business = db.get(Business, request.business_id)

    if business is None:
        raise HTTPException(
            status_code=404,
            detail="Business not found",
        )

    draft = Draft(
        **request.model_dump(),
        publish_destinations=(
            [request.platform]
            if request.platform in ("facebook", "tiktok")
            else ["facebook"]
        ),
    )

    db.add(draft)
    db.commit()
    db.refresh(draft)

    return draft


@protected.get("/drafts")
def list_drafts(
        business_id: str,
        db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)

    if business is None:
        raise HTTPException(
            status_code=404,
            detail="Business not found",
        )

    return db.scalars(select(Draft).where(Draft.business_id == business_id)).all()


@protected.patch("/drafts/{draft_id}/destinations")
def update_draft_destinations(
        draft_id: str,
        request: DraftDestinationsUpdate,
        db: Session = Depends(get_db),
):
    draft = require_pending_draft(db, draft_id)

    destinations = request.destinations

    if len(destinations) != len(set(destinations)):
        raise HTTPException(
            status_code=422,
            detail="Duplicate destinations are not allowed",
        )

    if "tiktok" in destinations and not (
            draft.media_type == "video" and draft.video_url
            or draft.image_url
    ):
        raise HTTPException(
            status_code=409,
            detail="TikTok requires an image or video",
        )

    connected = set(
        db.scalars(
            select(SocialAccount.platform).where(
                SocialAccount.business_id == draft.business_id,
                SocialAccount.platform.in_(destinations),
                SocialAccount.connection_status == "connected",
            )
        ).all()
    )

    if set(destinations) != connected:
        raise HTTPException(
            status_code=409,
            detail="Connect the selected social accounts first",
        )

    draft.publish_destinations = destinations

    db.commit()
    db.refresh(draft)

    return draft


@protected.patch("/drafts/{draft_id}/approve")
def approve_draft(
        draft_id: str,
        db: Session = Depends(get_db),
):
    draft = require_pending_draft(db, draft_id)

    if draft.media_type == "video":
        if draft.video_status != "completed" or not draft.video_url:
            raise HTTPException(
                status_code=409,
                detail="Video must be completed before approval",
            )

    draft.status = "approved"

    db.commit()
    db.refresh(draft)

    return draft


@protected.patch("/drafts/{draft_id}")
def update_draft(
        draft_id: str,
        request: DraftUpdate,
        db: Session = Depends(get_db),
):
    draft = require_pending_draft(db, draft_id)

    draft.title = request.title
    draft.caption = request.caption

    db.commit()
    db.refresh(draft)

    return draft


@protected.patch("/drafts/{draft_id}/reject")
def reject_draft(
        draft_id: str,
        db: Session = Depends(get_db),
):
    draft = require_pending_draft(db, draft_id)

    draft.status = "rejected"

    db.commit()
    db.refresh(draft)

    return draft


# --------------------------------------------------
# AI Content Generation
# --------------------------------------------------


@protected.post(
    "/businesses/{business_id}/generate-content",
    status_code=201,
)
def generate_content(
        business_id: str,
        db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)

    if business is None:
        raise HTTPException(
            status_code=404,
            detail="Business not found",
        )

    # Retrieve the last 10 drafts for this business.
    recent_drafts = db.scalars(
        select(Draft)
        .where(Draft.business_id == business.id)
        .order_by(Draft.created_at.desc())
        .limit(10)
    ).all()

    # Give Sofía a concise history of recent content.
    recent_posts = [
        {
            "title": draft.title,
            "caption": draft.caption,
            "platform": draft.platform,
        }
        for draft in recent_drafts
    ]

    # Generate new content using the business profile
    # and previous drafts to encourage topic variety.
    generated = generate_marketing_content(
        business,
        recent_posts=recent_posts,
    )

    draft = Draft(
        video_script=generated["video_script"],
        business_id=business.id,
        title=generated["title"],
        caption=generated["caption"],
        platform=generated["platform"],
        publish_destinations=(
            [generated["platform"]]
            if generated["platform"] in ("facebook", "tiktok")
            else ["facebook"]
        ),
        image_prompt=generated["image_prompt"],
        status="pending",
        source="ai",
    )

    db.add(draft)
    db.commit()
    db.refresh(draft)

    return draft


@protected.post("/heygen/videos")
def create_heygen_video(request: HeyGenVideoRequest):
    return generate_video(
        avatar_id=request.avatar_id,
        voice_id=request.voice_id,
        script=request.script,
    )


@protected.post("/drafts/{draft_id}/upload-video")
def upload_draft_video(
        draft_id: str,
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
):
    draft = require_pending_draft(db, draft_id)

    if draft.video_status in ("generating", "completed", "uploading"):
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


@protected.post("/drafts/{draft_id}/generate-video")
def generate_draft_video(
        draft_id: str,
        request: HeyGenVideoRequest,
        db: Session = Depends(get_db),
):
    # Prevent concurrent generation requests for this Draft.
    lock_draft_revisions(db, draft_id)

    draft = require_pending_draft(db, draft_id)

    if draft.video_status in ("pending", "generating", "completed"):
        raise HTTPException(
            status_code=409,
            detail="Video generation already started or completed",
        )

    # Reserve the Draft before calling HeyGen.
    draft.media_type = "video"
    draft.video_status = "generating"
    draft.video_generation_id = None
    db.commit()

    try:
        job = generate_video(
            avatar_id=request.avatar_id,
            voice_id=request.voice_id,
            script=request.script,
        )

        video_id = job.get("video_id")

        if not video_id:
            raise ValueError("HeyGen did not return a video ID")

        draft.video_generation_id = video_id
        db.commit()

        return {
            "draft_id": draft.id,
            "video_id": video_id,
            "status": "generating",
        }

    except Exception:
        db.rollback()
        draft.video_status = "needs_review"
        db.commit()
        logger.exception(
            "Unable to start HeyGen video generation for draft %s",
            draft_id,
        )
        raise HTTPException(
            status_code=502,
            detail="Unable to start video generation; review before retrying",
        )


@protected.get("/drafts/{draft_id}/video-preview")
def get_draft_video_preview(
        draft_id: str,
        db: Session = Depends(get_db),
):
    draft = require_draft(db, draft_id)

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


@protected.get("/heygen/videos/{video_id}")
def check_heygen_video(video_id: str):
    return get_video_status(video_id)


@protected.get("/heygen/voices")
def list_heygen_voices():
    return get_available_voices()


@protected.get("/businesses/{business_id}/sofia/conversations")
def list_sofia_conversations(
        business_id: str,
        db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)

    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")

    conversations = db.scalars(
        select(Conversation)
        .where(Conversation.business_id == business.id)
        .order_by(
            Conversation.created_at.desc(),
            Conversation.id.desc(),
        )
    ).all()

    results = []

    for conversation in conversations:
        first_message = db.scalar(
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == conversation.id,
                ConversationMessage.role == "user",
            )
            .order_by(
                ConversationMessage.created_at.asc(),
                ConversationMessage.id.asc(),
            )
            .limit(1)
        )

        title = (
            first_message.content.strip()[:60]
            if first_message
            else "Nueva campaña"
        )

        results.append({
            "id": conversation.id,
            "created_at": conversation.created_at,
            "title": title,
        })

    return results


@protected.get(
    "/businesses/{business_id}/sofia/conversations/{conversation_id}"
)
def get_sofia_conversation(
        business_id: str,
        conversation_id: str,
        db: Session = Depends(get_db),
):
    conversation = db.scalar(
        select(Conversation)
        .join(Business, Conversation.business_id == Business.id)
        .where(
            Conversation.id == conversation_id,
            Business.id == business_id,
        )
    )

    if conversation is None:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found for this business",
        )

    messages = db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation.id)
        .order_by(
            ConversationMessage.created_at.asc(),
            ConversationMessage.id.asc(),
        )
    ).all()

    return {
        "conversation_id": conversation.id,
        "messages": [
            {"role": message.role, "content": message.content}
            for message in messages
        ],
    }


@protected.get("/businesses/{business_id}/sofia/conversation/latest")
def get_latest_sofia_conversation(
        business_id: str,
        db: Session = Depends(get_db),
):
    """Retrieve the latest Sofía conversation for a business."""

    business = db.get(Business, business_id)

    if business is None:
        raise HTTPException(
            status_code=404,
            detail="Business not found",
        )

    conversation = db.scalar(
        select(Conversation)
        .where(Conversation.business_id == business.id)
        .order_by(
            Conversation.created_at.desc(),
            Conversation.id.desc(),
        )
        .limit(1)
    )

    if conversation is None:
        return None

    messages = db.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == conversation.id
        )
        .order_by(
            ConversationMessage.created_at.asc(),
            ConversationMessage.id.asc(),
        )
    ).all()

    return {
        "conversation_id": conversation.id,
        "messages": [
            {
                "role": message.role,
                "content": message.content,
            }
            for message in messages
        ],
    }


@protected.post("/businesses/{business_id}/sofia/chat")
def sofia_chat(
        business_id: str,
        request: SofiaChatRequest,
        db: Session = Depends(get_db),
):
    """Start or continue a conversation with Sofía."""

    business = db.get(Business, business_id)

    if business is None:
        raise HTTPException(
            status_code=404,
            detail="Business not found",
        )

    # Continue an existing conversation or start a new one.
    if request.conversation_id:
        conversation = db.scalar(
            select(Conversation).where(
                Conversation.id == request.conversation_id,
                Conversation.business_id == business.id,
            )
        )

        if conversation is None:
            raise HTTPException(
                status_code=404,
                detail="Conversation not found for this business",
            )
    else:
        conversation = Conversation(business_id=business.id)
        db.add(conversation)
        db.flush()

    # Save the owner's message.
    user_message = ConversationMessage(
        conversation_id=conversation.id,
        role="user",
        content=request.message.strip(),
    )

    db.add(user_message)
    db.flush()

    # Retrieve the conversation history in order.
    messages = db.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == conversation.id
        )
        .order_by(
            ConversationMessage.created_at.asc(),
            ConversationMessage.id.asc(),
        )
    ).all()

    # Ask Sofía to respond using the business profile and history.
    try:
        reply = chat_with_sofia(business, messages)
    except Exception:
        db.rollback()
        logger.exception("Sofía chat generation failed")
        raise HTTPException(
            status_code=502,
            detail="Sofía could not respond. Please try again.",
        )

    # Save Sofía's reply.
    assistant_message = ConversationMessage(
        conversation_id=conversation.id,
        role="assistant",
        content=reply,
    )

    db.add(assistant_message)
    db.commit()

    return {
        "conversation_id": conversation.id,
        "reply": reply,
    }


@protected.post(
    "/businesses/{business_id}/sofia/conversations/{conversation_id}/generate-draft"
)
def generate_sofia_conversation_draft(
        business_id: str,
        conversation_id: str,
        db: Session = Depends(get_db),
):
    """Generate a pending draft using Sofía's conversation and Leo."""

    business = db.get(Business, business_id)

    if business is None:
        raise HTTPException(
            status_code=404,
            detail="Business not found",
        )

    conversation = db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.business_id == business.id,
        )
    )

    if conversation is None:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found for this business",
        )

    messages = db.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == conversation.id
        )
        .order_by(
            ConversationMessage.created_at.asc(),
            ConversationMessage.id.asc(),
        )
    ).all()

    user_messages = [
        message.content
        for message in messages
        if message.role == "user"
    ]

    if not user_messages:
        raise HTTPException(
            status_code=400,
            detail="The conversation has no campaign instructions",
        )

    # Use the owner's conversation to guide Sofía and Leo.
    campaign_instructions = "\n".join(user_messages[-10:])

    recent_drafts = db.scalars(
        select(Draft)
        .where(Draft.business_id == business.id)
        .order_by(Draft.created_at.desc())
        .limit(10)
    ).all()

    recent_posts = [
        {
            "title": draft.title,
            "caption": draft.caption,
            "platform": draft.platform,
        }
        for draft in recent_drafts
    ]

    try:
        generated = generate_marketing_content(
            business,
            recent_posts=recent_posts,
            campaign_instructions=campaign_instructions,
        )
    except Exception:
        logger.exception("Conversational draft generation failed")
        raise HTTPException(
            status_code=502,
            detail="Sofía and Leo could not generate the draft",
        )

    draft = Draft(
        video_script=generated["video_script"],
        business_id=business.id,
        title=generated["title"],
        caption=generated["caption"],
        platform=generated["platform"],
        image_prompt=generated["image_prompt"],
        status="pending",
        source="ai",
    )

    db.add(draft)
    db.commit()
    db.refresh(draft)

    return draft


# --------------------------------------------------
# Business Endpoints
# --------------------------------------------------


@protected.post("/businesses", status_code=201)
def create_business(
        request: BusinessCreate,
        db: Session = Depends(get_db),
):
    business = Business(**request.model_dump())

    db.add(business)
    db.commit()
    db.refresh(business)

    return business


@protected.get("/businesses")
def list_businesses(
        db: Session = Depends(get_db),
):
    return db.scalars(select(Business)).all()


# --------------------------------------------------
# AI Image Generation
# --------------------------------------------------


@protected.post("/drafts/{draft_id}/generate-image")
def generate_draft_image(
        draft_id: str,
        db: Session = Depends(get_db),
):
    generation_id = str(uuid4())

    reservation = db.execute(
        update(Draft)
        .where(
            Draft.id == draft_id,
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
    draft = require_draft(db, draft_id)

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


@protected.get("/drafts/{draft_id}/analytics/facebook")
async def get_facebook_draft_analytics(
        draft_id: str,
        db: Session = Depends(get_db),
):
    # Find the draft.
    draft = db.get(Draft, draft_id)

    if draft is None:
        raise HTTPException(
            status_code=404,
            detail="Draft not found",
        )

    # Only published drafts have Facebook analytics.
    if draft.facebook_publish_status != "published" or not draft.facebook_post_id:
        raise HTTPException(
            status_code=409,
            detail="Draft has not been published to Facebook",
        )

    # Find the connected Facebook account for this business.
    account = db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == draft.business_id,
            SocialAccount.platform == "facebook",
            SocialAccount.connection_status == "connected",
        )
    )

    if account is None:
        raise HTTPException(
            status_code=409,
            detail="Connect a Facebook Page to this business first",
        )

    access_token = decrypt_token(account.encrypted_access_token)

    # Request engagement information from Facebook.
    try:
        data = await get_post_insights(
            post_id=draft.facebook_post_id,
            access_token=access_token,
            media_type=draft.media_type,
        )

    except httpx.HTTPStatusError as exc:
        try:
            error_data = exc.response.json().get("error", {})
            if not isinstance(error_data, dict):
                error_data = {}
        except ValueError:
            error_data = {}

        logger.warning(
            "Facebook analytics error: status=%s, code=%s, message=%s",
            exc.response.status_code,
            error_data.get("code"),
            error_data.get("message"),
        )

        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve Facebook analytics",
        ) from exc

    except httpx.RequestError as exc:
        logger.warning(
            "Facebook analytics connection error: %s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail="Facebook analytics service is unavailable",
        ) from exc

    def metric_count(name: str):
        metric = data.get(name)
        if not isinstance(metric, dict):
            return None
        summary = metric.get("summary")
        if not isinstance(summary, dict):
            return None
        return summary.get("total_count")

    shares = data.get("shares")
    share_count = shares.get("count") if isinstance(shares, dict) else None

    return {
        "draft_id": draft.id,
        "platform": "facebook",
        "post_id": draft.facebook_post_id,
        "reactions": metric_count("reactions"),
        "comments": metric_count("comments"),
        "shares": share_count,
        "permalink_url": data.get("permalink_url"),
    }


@protected.get("/drafts/{draft_id}/analytics/facebook/reach")
async def test_facebook_reach(
        draft_id: str,
        db: Session = Depends(get_db),
):
    draft = db.get(Draft, draft_id)

    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")

    if draft.facebook_publish_status != "published" or not draft.facebook_post_id:
        raise HTTPException(status_code=409, detail="Draft is not published")

    account = db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == draft.business_id,
            SocialAccount.platform == "facebook",
            SocialAccount.connection_status == "connected",
        )
    )

    if account is None:
        raise HTTPException(status_code=409, detail="Facebook not connected")

    access_token = decrypt_token(account.encrypted_access_token)

    try:
        data = await get_post_reach(draft.facebook_post_id, access_token)

        unique_media_viewers = next(
            (
                metric["values"][0]["value"]
                for metric in data.get("data", [])
                if metric.get("name") == "post_total_media_view_unique"
                   and metric.get("period") == "lifetime"
                   and metric.get("values")
            ),
            None,
        )

        return {"unique_media_viewers": unique_media_viewers}
    except httpx.HTTPStatusError as exc:
        error_data = exc.response.json()

        facebook_error = error_data.get("error", {})

        logger.warning(
            "Facebook reach error: code=%s, message=%s",
            facebook_error.get("code"),
            facebook_error.get("message"),
        )

        raise HTTPException(
            status_code=502,
            detail="Facebook did not return reach data",
        ) from exc


@protected.get("/heygen/avatars")
def list_heygen_avatars():
    try:
        return get_available_avatar_looks()

    except httpx.HTTPStatusError:
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve HeyGen avatars",
        )

    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="HeyGen connection failed",
        )


# --------------------------------------------------
# Register Protected Endpoints
# --------------------------------------------------

app.include_router(protected)
app.include_router(facebook_auth_router)

app.include_router(tiktok_auth_router)
