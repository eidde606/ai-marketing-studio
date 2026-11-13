import os

import httpx
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.campaign_routes import router as campaign_router
from app.facebook_service import get_page_info
from app.features.analytics.routes import router as analytics_router
from app.features.businesses.routes import router as business_router
from app.features.content.routes import router as content_router
from app.features.drafts import service as draft_service
from app.features.drafts.routes import draft_http_exception
from app.features.drafts.routes import router as draft_router
from app.features.facebook.routes import router as facebook_auth_router
from app.features.facebook.publishing_routes import router as facebook_publishing_router
from app.features.instagram.routes import (
    InstagramCallbackAccessLogRedactionMiddleware,
    router as instagram_auth_router,
)
from app.features.media.routes import router as media_router
from app.features.media.routes import webhook_router as heygen_webhook_router
from app.features.tiktok.publishing_routes import router as tiktok_publishing_router
from app.features.tiktok.routes import router as tiktok_auth_router
from app.auth import verify_token
from app.models import Draft

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

# --------------------------------------------------
# Helpers
# --------------------------------------------------


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
app.include_router(tiktok_publishing_router)

app.include_router(content_router)
