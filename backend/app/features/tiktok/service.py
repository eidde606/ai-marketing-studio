"""TikTok OAuth and connected-account workflows."""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.models import SocialAccount, TikTokOAuthState
from app.token_service import decrypt_token, encrypt_token
from app.transactions import Transactions
from . import provider, repository

logger = logging.getLogger(__name__)


def start_connection(
    business_id: str,
    user_id: str,
    *,
    db: Session,
) -> str:
    business = repository.get_business(db, business_id)
    if business is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")

    state = secrets.token_urlsafe(32)
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    login_url = provider.get_tiktok_login_url(state)
    repository.add_oauth_state(
        db,
        TikTokOAuthState(
            state_hash=state_hash,
            business_id=business.id,
            user_id=user_id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        ),
    )
    Transactions(db).commit()
    return login_url


async def complete_authorization(
    state: str,
    code: str | None,
    error: str | None,
    *,
    db: Session,
) -> None:
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    business_id = repository.consume_oauth_state(
        db,
        state_hash,
        datetime.now(timezone.utc),
    )
    Transactions(db).commit()

    if business_id is None:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Invalid, expired, or previously used TikTok authorization",
        )

    if error or not code:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "TikTok authorization was not completed",
        )

    try:
        tokens = await provider.exchange_code_for_token(code)
        profile = await provider.get_tiktok_user(tokens["access_token"])
        open_id = profile["open_id"]
        display_name = profile.get("display_name") or "TikTok account"
        refresh_token = tokens["refresh_token"]
        expires_in = int(tokens["expires_in"])
    except (httpx.HTTPError, KeyError, ValueError, TypeError):
        logger.warning("TikTok account authorization failed")
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Unable to connect the TikTok account",
        ) from None

    account = repository.get_account(db, business_id, open_id)
    if account is None:
        account = SocialAccount(
            business_id=business_id,
            platform="tiktok",
            platform_account_id=open_id,
            account_name=display_name,
            encrypted_access_token=encrypt_token(tokens["access_token"]),
        )
        repository.add_account(db, account)

    account.account_name = display_name
    account.encrypted_access_token = encrypt_token(tokens["access_token"])
    account.encrypted_refresh_token = encrypt_token(refresh_token)
    account.token_expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=expires_in,
    )
    account.connection_status = "connected"
    Transactions(db).commit()


def list_accounts(business_id: str, *, db: Session) -> dict[str, list[dict[str, str]]]:
    if repository.get_business(db, business_id) is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")

    accounts = repository.list_accounts(db, business_id)
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


async def get_valid_access_token(
    account: SocialAccount,
    *,
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
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "Reconnect your TikTok account",
        )

    try:
        tokens = await provider.refresh_tiktok_token(
            decrypt_token(account.encrypted_refresh_token),
        )
    except (httpx.HTTPError, ValueError, KeyError):
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "TikTok authorization expired. Reconnect TikTok.",
        ) from None

    repository.save_refreshed_credentials(
        account,
        encrypted_access_token=encrypt_token(tokens["access_token"]),
        encrypted_refresh_token=encrypt_token(tokens["refresh_token"]),
        token_expires_at=now + timedelta(seconds=int(tokens["expires_in"])),
    )
    Transactions(db).commit()
    return tokens["access_token"]
