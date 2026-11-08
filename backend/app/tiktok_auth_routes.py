
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from app.models import Business, SocialAccount, TikTokOAuthState
from app.tiktok_oauth import (
    exchange_code_for_token,
    get_tiktok_login_url,
    get_tiktok_user,
)
from app.token_service import encrypt_token

router = APIRouter(
    prefix="/api/integrations/tiktok",
    tags=["TikTok OAuth"],
)


@router.get("/start")
def start_tiktok_connection(
    business_id: str,
    user: dict = Depends(verify_token),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)

    if business is None:
        raise HTTPException(404, "Business not found")

    state = secrets.token_urlsafe(32)
    state_hash = hashlib.sha256(state.encode()).hexdigest()

    login_url = get_tiktok_login_url(state)

    db.add(
        TikTokOAuthState(
            state_hash=state_hash,
            business_id=business.id,
            user_id=user["sub"],
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=10),
        )
    )
    db.commit()

    return {"authorization_url": login_url}


@router.get("/callback")
async def tiktok_callback(
    state: str,
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    state_hash = hashlib.sha256(state.encode()).hexdigest()

    result = db.execute(
        delete(TikTokOAuthState)
        .where(
            TikTokOAuthState.state_hash == state_hash,
            TikTokOAuthState.expires_at > datetime.now(timezone.utc),
        )
        .returning(TikTokOAuthState.business_id)
    )

    business_id = result.scalar_one_or_none()
    db.commit()

    if business_id is None:
        raise HTTPException(
            400, "Invalid, expired, or previously used TikTok authorization"
        )

    if error or not code:
        raise HTTPException(400, "TikTok authorization was not completed")

    try:
        tokens = await exchange_code_for_token(code)
        profile = await get_tiktok_user(tokens["access_token"])

        open_id = profile["open_id"]
        display_name = profile.get("display_name") or "TikTok account"
        refresh_token = tokens["refresh_token"]
        expires_in = int(tokens["expires_in"])

    except (httpx.HTTPError, KeyError, ValueError, TypeError):
        raise HTTPException(
            502, "Unable to connect the TikTok account"
        ) from None

    account = db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "tiktok",
            SocialAccount.platform_account_id == open_id,
        )
    )

    if account is None:
        account = SocialAccount(
            business_id=business_id,
            platform="tiktok",
            platform_account_id=open_id,
            account_name=display_name,
            encrypted_access_token=encrypt_token(
                tokens["access_token"]
            ),
        )
        db.add(account)

    account.account_name = display_name
    account.encrypted_access_token = encrypt_token(
        tokens["access_token"]
    )
    account.encrypted_refresh_token = encrypt_token(refresh_token)
    account.token_expires_at = (
        datetime.now(timezone.utc)
        + timedelta(seconds=expires_in)
    )
    account.connection_status = "connected"

    db.commit()

    frontend_url = os.environ["TIKTOK_FRONTEND_REDIRECT_URL"].rstrip("/")

    if not frontend_url.startswith("https://"):
        raise RuntimeError("Frontend URL must use HTTPS")

    return RedirectResponse(
        url=f"{frontend_url}/#tiktok_connected=1",
        status_code=303,
    )


@router.get("/accounts")
def get_tiktok_accounts(
    business_id: str,
    user: dict = Depends(verify_token),
    db: Session = Depends(get_db),
):
    if db.get(Business, business_id) is None:
        raise HTTPException(404, "Business not found")

    accounts = db.scalars(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "tiktok",
        )
    ).all()

    return {
        "accounts": [
            {
                "id": account.id,
                "account_name": account.account_name,
                "connection_status": account.connection_status,
            }
            for account in accounts
        ]
    }
