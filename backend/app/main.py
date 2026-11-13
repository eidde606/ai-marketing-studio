from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.features.campaigns.routes import router as campaign_router
from app.features.analytics.routes import router as analytics_router
from app.features.businesses.routes import router as business_router
from app.features.content.routes import router as content_router
from app.features.drafts.routes import router as draft_router
from app.features.facebook.routes import (
    page_router as facebook_page_router,
    router as facebook_auth_router,
)
from app.features.facebook.publishing_routes import router as facebook_publishing_router
from app.features.instagram.routes import (
    InstagramCallbackAccessLogRedactionMiddleware,
    router as instagram_auth_router,
)
from app.features.media.routes import router as media_router
from app.features.media.routes import webhook_router as heygen_webhook_router
from app.features.tiktok.publishing_routes import router as tiktok_publishing_router
from app.features.tiktok.routes import router as tiktok_auth_router

app = FastAPI()
app.add_middleware(InstagramCallbackAccessLogRedactionMiddleware)

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
# Public Endpoints
# --------------------------------------------------


@app.get("/health")
def health():
    return {"status": "healthy"}


# --------------------------------------------------
# Register Protected Endpoints
# --------------------------------------------------

app.include_router(draft_router)
app.include_router(business_router)
app.include_router(campaign_router)
app.include_router(media_router)
app.include_router(heygen_webhook_router)
app.include_router(facebook_auth_router)
app.include_router(facebook_page_router)
app.include_router(facebook_publishing_router)
app.include_router(instagram_auth_router)
app.include_router(analytics_router)

app.include_router(tiktok_auth_router)
app.include_router(tiktok_publishing_router)

app.include_router(content_router)
