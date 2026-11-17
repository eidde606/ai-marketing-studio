from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.frontend_origins import ALLOWED_FRONTEND_ORIGINS
from app.features.campaigns.routes import router as campaign_router
from app.features.accounts.routes import router as account_router
from app.features.onboarding.routes import router as onboarding_router
from app.features.memberships.routes import router as membership_router
from app.features.analytics.routes import router as analytics_router
from app.features.billing.routes import router as billing_router
from app.features.businesses.routes import router as business_router
from app.features.content.routes import router as content_router
from app.features.contact.routes import router as contact_router
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
from app.features.instagram.publishing_routes import (
    router as instagram_publishing_router,
)
from app.features.media.routes import router as media_router
from app.features.media.routes import webhook_router as heygen_webhook_router
from app.features.tiktok.publishing_routes import router as tiktok_publishing_router
from app.features.tiktok.routes import router as tiktok_auth_router

app = FastAPI()
app.add_middleware(InstagramCallbackAccessLogRedactionMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_FRONTEND_ORIGINS),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["X-Error-Code"],
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
app.include_router(account_router)
app.include_router(onboarding_router)
app.include_router(membership_router)
app.include_router(business_router)
app.include_router(campaign_router)
app.include_router(media_router)
app.include_router(heygen_webhook_router)
app.include_router(facebook_auth_router)
app.include_router(facebook_page_router)
app.include_router(facebook_publishing_router)
app.include_router(instagram_auth_router)
app.include_router(instagram_publishing_router)
app.include_router(analytics_router)
app.include_router(billing_router)

app.include_router(tiktok_auth_router)
app.include_router(tiktok_publishing_router)

app.include_router(content_router)
app.include_router(contact_router)
