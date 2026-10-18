from datetime import datetime, timedelta, timezone
import os
import httpx
from app.facebook_service import get_page_info, publish_text_post, publish_image_post
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from app.models import Business, Draft, ImageRevision
from app.ai_service import generate_marketing_content
from app.image_service import (
    generate_marketing_image,
    edit_marketing_image,
)
from app.storage_service import (
    get_marketing_image_url,
    download_marketing_image,
)

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
    ],
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


# --------------------------------------------------
# Request Models
# --------------------------------------------------


class DraftCreate(BaseModel):
    business_id: str
    title: str
    caption: str
    platform: str


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
        raise HTTPException(
            status_code=503,
            detail="Facebook is not configured",
        )

    try:
        return await get_page_info(page_id, access_token)

    except httpx.HTTPStatusError:
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve Facebook Page",
        )

    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Facebook connection failed",
        )


@protected.post("/drafts/{draft_id}/publish-facebook")
async def publish_draft_to_facebook(
    draft_id: str,
    db: Session = Depends(get_db),
):
    page_id = os.getenv("FACEBOOK_PAGE_ID")
    access_token = os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN")
    if not page_id or not access_token:
        raise HTTPException(status_code=503, detail="Facebook is not configured")

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
        raise HTTPException(status_code=409, detail="Draft is not eligible for Facebook publishing")
    db.commit()

    draft = db.get(Draft, draft_id)
    try:
        image_bytes = (
            download_marketing_image(draft.image_url, draft.business_id)
            if draft.image_url else None
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
        raise HTTPException(status_code=502, detail="Unable to prepare the marketing image")

    try:
        if image_bytes is not None:
            response = await publish_image_post(
                page_id=page_id, access_token=access_token,
                message=draft.caption, image_bytes=image_bytes,
            )
            post_id = response.get("post_id") or response.get("id")
        else:
            response = await publish_text_post(
                page_id=page_id, access_token=access_token, message=draft.caption,
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
        rejected = 400 <= exc.response.status_code < 500 and exc.response.status_code != 429
        draft.facebook_publish_status = "not_published" if rejected else "needs_review"
        db.commit()
        if rejected:
            raise HTTPException(
                status_code=502,
                detail="Facebook rejected the request. Check Page token, permissions and image format.",
            )
        raise HTTPException(status_code=502, detail="Facebook publishing outcome requires review")
    except Exception:
        db.rollback()
        draft = db.get(Draft, draft_id)
        draft.facebook_publish_status = "needs_review"
        db.commit()
        raise HTTPException(status_code=502, detail="Facebook publishing outcome requires review")


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
        raise HTTPException(status_code=400, detail="Confirm the post is absent on Facebook")
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

    draft = Draft(**request.model_dump())

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


@protected.patch("/drafts/{draft_id}/approve")
def approve_draft(
    draft_id: str,
    db: Session = Depends(get_db),
):
    draft = require_pending_draft(db, draft_id)

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


# --------------------------------------------------
# Register Protected Endpoints
# --------------------------------------------------

app.include_router(protected)
