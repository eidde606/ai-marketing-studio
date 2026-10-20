import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from app.facebook_oauth import (
    exchange_code_for_token,
    get_facebook_login_url,
    get_long_lived_user_token,
    get_managed_pages,
)
from app.models import Business, FacebookOAuthState
from app.token_service import encrypt_token

from pydantic import BaseModel
from sqlalchemy import select

from app.models import SocialAccount
from app.token_service import decrypt_token

import os
from urllib.parse import urlsplit

from fastapi.responses import RedirectResponse

router = APIRouter(prefix="/auth/facebook", tags=["Facebook OAuth"])


@router.get("/accounts")
def get_connected_facebook_accounts(
    business_id: str,
    user: dict = Depends(verify_token),
    db: Session = Depends(get_db),
):
    """Return connected Facebook Pages without exposing access tokens."""

    business = db.get(Business, business_id)

    if business is None:
        raise HTTPException(
            status_code=404,
            detail="Business not found",
        )

    accounts = db.scalars(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "facebook",
        )
    ).all()

    return {
        "accounts": [
            {
                "id": account.id,
                "platform": account.platform,
                "page_id": account.platform_account_id,
                "page_name": account.account_name,
                "connection_status": account.connection_status,
            }
            for account in accounts
        ]
    }


@router.get("/start")
def start_facebook_connection(
    business_id: str,
    user: dict = Depends(verify_token),
    db: Session = Depends(get_db),
):
    """Create a temporary authorization request for Facebook."""

    business = db.get(Business, business_id)

    if business is None:
        raise HTTPException(
            status_code=404,
            detail="Business not found",
        )

    # Generate a secure, unpredictable OAuth state.
    state = secrets.token_urlsafe(32)
    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()

    # Authorization expires after 10 minutes.
    oauth_state = FacebookOAuthState(
        state_hash=state_hash,
        business_id=business.id,
        user_id=user["sub"],
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )

    # Check OAuth configuration before saving the state.
    login_url = get_facebook_login_url(state)

    db.add(oauth_state)
    db.commit()

    return {
        "authorization_url": login_url,
    }


@router.get("/callback")
async def facebook_callback(
    state: str = Query(...),
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    """Validate Facebook authorization and prepare Page selection."""

    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)

    # Atomically consume the original OAuth state.
    result = db.execute(
        delete(FacebookOAuthState)
        .where(
            FacebookOAuthState.state_hash == state_hash,
            FacebookOAuthState.expires_at > now,
            FacebookOAuthState.selection_token_hash.is_(None),
        )
        .returning(
            FacebookOAuthState.business_id,
            FacebookOAuthState.user_id,
        )
    )

    authorization = result.first()
    db.commit()

    if authorization is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid, expired, or previously used authorization",
        )

    business_id, user_id = authorization

    if error:
        raise HTTPException(
            status_code=400,
            detail="Facebook authorization was declined",
        )

    if not code:
        raise HTTPException(
            status_code=400,
            detail="Facebook did not return an authorization code",
        )

    try:
        short_token = await exchange_code_for_token(code)
        long_token = await get_long_lived_user_token(short_token)
        pages = await get_managed_pages(long_token)

    except (httpx.HTTPError, KeyError, ValueError):
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve Facebook Pages",
        ) from None

    if not pages:
        raise HTTPException(
            status_code=400,
            detail="No Facebook Pages available for this account",
        )

    # Encrypt the Facebook Page information.
    encrypted_pages = encrypt_token(json.dumps(pages))

    # Generate a short-lived selection token.
    selection_token = secrets.token_urlsafe(32)

    selection_hash = hashlib.sha256(selection_token.encode("utf-8")).hexdigest()

    # Store the pending selection for five minutes.
    pending_selection = FacebookOAuthState(
        state_hash=hashlib.sha256(secrets.token_bytes(32)).hexdigest(),
        business_id=business_id,
        user_id=user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        encrypted_pages=encrypted_pages,
        selection_token_hash=selection_hash,
    )

    db.add(pending_selection)
    db.commit()

    # Redirect back to AI Marketing Studio.
    return redirect_to_dashboard(selection_token)


class FacebookPageSelection(BaseModel):
    selection_token: str
    page_id: str


@router.post("/select-page")
def select_facebook_page(
    request: FacebookPageSelection,
    user: dict = Depends(verify_token),
    db: Session = Depends(get_db),
):
    """Save the selected Facebook Page securely."""

    now = datetime.now(timezone.utc)

    selection_hash = hashlib.sha256(request.selection_token.encode("utf-8")).hexdigest()

    # Lock the pending selection so it cannot be used twice.
    pending = db.execute(
        select(FacebookOAuthState)
        .where(
            FacebookOAuthState.selection_token_hash == selection_hash,
            FacebookOAuthState.expires_at > now,
            FacebookOAuthState.user_id == user["sub"],
        )
        .with_for_update()
    ).scalar_one_or_none()

    if pending is None or not pending.encrypted_pages:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired Page selection",
        )

    pages = json.loads(decrypt_token(pending.encrypted_pages))

    selected_page = next(
        (page for page in pages if page["id"] == request.page_id),
        None,
    )

    if selected_page is None:
        raise HTTPException(
            status_code=400,
            detail="Selected Facebook Page is not available",
        )

    page_token = selected_page.get("access_token")

    if not page_token:
        raise HTTPException(
            status_code=400,
            detail="Facebook did not provide a Page access token",
        )

    # Check whether this Facebook Page is already connected.
    account = db.execute(
        select(SocialAccount).where(
            SocialAccount.platform == "facebook",
            SocialAccount.platform_account_id == selected_page["id"],
        )
    ).scalar_one_or_none()

    if account is None:
        account = SocialAccount(
            business_id=pending.business_id,
            platform="facebook",
            platform_account_id=selected_page["id"],
            account_name=selected_page["name"],
            encrypted_access_token=encrypt_token(page_token),
            connection_status="connected",
        )
        db.add(account)
    else:
        # A Facebook Page cannot belong to two businesses.
        if account.business_id != pending.business_id:
            raise HTTPException(
                status_code=409,
                detail="This Facebook Page is already connected to another business",
            )

    # Reconnect the Page to the same business.
    account.account_name = selected_page["name"]
    account.encrypted_access_token = encrypt_token(page_token)
    account.connection_status = "connected"

    business_id = pending.business_id
    page_name = selected_page["name"]

    # Consume the selection token.
    db.delete(pending)
    db.commit()

    return {
        "status": "connected",
        "business_id": business_id,
        "page_id": selected_page["id"],
        "page_name": page_name,
    }


def redirect_to_dashboard(selection_token: str) -> RedirectResponse:
    """Return the browser to the dashboard with a temporary handoff code."""

    frontend_url = os.environ["FRONTEND_BASE_URL"].rstrip("/")

    parsed_url = urlsplit(frontend_url)

    if (
        parsed_url.scheme not in ("http", "https")
        or not parsed_url.netloc
        or parsed_url.username
        or parsed_url.password
        or parsed_url.query
        or parsed_url.fragment
    ):
        raise RuntimeError("Invalid frontend URL configuration")

    if parsed_url.scheme == "http" and parsed_url.hostname not in (
        "localhost",
        "127.0.0.1",
    ):
        raise RuntimeError("Production frontend must use HTTPS")

    return RedirectResponse(
        url=f"{frontend_url}/#facebook_handoff={selection_token}",
        status_code=303,
    )


class FacebookHandoffRequest(BaseModel):
    handoff_token: str


@router.post("/handoff")
def exchange_facebook_handoff(
    request: FacebookHandoffRequest,
    user: dict = Depends(verify_token),
    db: Session = Depends(get_db),
):
    """Retrieve available Pages using a temporary handoff token."""

    token_hash = hashlib.sha256(request.handoff_token.encode("utf-8")).hexdigest()

    pending = db.execute(
        select(FacebookOAuthState).where(
            FacebookOAuthState.selection_token_hash == token_hash,
            FacebookOAuthState.user_id == user["sub"],
            FacebookOAuthState.expires_at > datetime.now(timezone.utc),
        )
    ).scalar_one_or_none()

    if pending is None or not pending.encrypted_pages:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired Facebook handoff",
        )

    pages = json.loads(decrypt_token(pending.encrypted_pages))

    return {
        "business_id": pending.business_id,
        "pages": [
            {
                "id": page["id"],
                "name": page["name"],
            }
            for page in pages
        ],
    }
