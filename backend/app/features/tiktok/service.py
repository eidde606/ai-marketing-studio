"""TikTok OAuth and connected-account workflows."""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from app.models import SocialAccount, TikTokOAuthState
from app.token_service import decrypt_token, encrypt_token
from app.transactions import Transactions
from . import provider, repository

logger = logging.getLogger(__name__)


def start_connection(
    business_id: str,
    principal: AuthenticatedPrincipal,
    *,
    db: Session,
) -> str:
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS, lock=True,
    )

    state = secrets.token_urlsafe(32)
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    login_url = provider.get_tiktok_login_url(state)
    repository.add_oauth_state_scoped(
        db,
        context,
        TikTokOAuthState(
            state_hash=state_hash,
            business_id=business_id,
            user_id=principal.subject,
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
    now = datetime.now(timezone.utc)
    identity = repository.oauth_state_identity(db, state_hash, now)
    if identity is None:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Invalid, expired, or previously used TikTok authorization",
        )
    business_id, initiator_id = identity
    principal = access.resolve_oauth_initiator(db, initiator_id)
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS,
    )
    consumed = repository.consume_oauth_state_scoped(
        db, context, state_hash, initiator_id, now,
    )
    Transactions(db).commit()

    if business_id is None or consumed is None:
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

    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS, lock=True,
    )
    account = repository.get_platform_account_scoped(db, context, open_id)
    values = {
        "account_name": display_name,
        "encrypted_access_token": encrypt_token(tokens["access_token"]),
        "encrypted_refresh_token": encrypt_token(refresh_token),
        "token_expires_at": datetime.now(timezone.utc) + timedelta(seconds=expires_in),
        "connection_status": "connected",
    }
    if account is None:
        repository.add_account_scoped(db, context, SocialAccount(
            business_id=business_id,
            platform="tiktok",
            platform_account_id=open_id,
            **values,
        ))
    else:
        repository.update_account_scoped(db, context, account.id, values)
    Transactions(db).commit()


def list_accounts(
    business_id: str,
    *,
    db: Session,
    principal: AuthenticatedPrincipal,
) -> dict[str, list[dict[str, str]]]:
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS,
    )
    accounts = []
    while True:
        page = repository.list_accounts_scoped(
            db, context, limit=100, offset=len(accounts),
        )
        accounts.extend(page)
        if len(page) < 100:
            break
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
    account_id: str,
    *,
    business_id: str,
    principal: AuthenticatedPrincipal,
    db: Session,
) -> str:
    context = access.require_permission(
        db, principal, business_id, Permission.PUBLISH,
    )
    account = repository.get_account_scoped(db, context, account_id)
    if account is None or account.connection_status != "connected":
        raise ApplicationError(ErrorKind.CONFLICT, "Reconnect your TikTok account")
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

    refresh_credential = account.encrypted_refresh_token
    try:
        tokens = await provider.refresh_tiktok_token(
            decrypt_token(refresh_credential),
        )
    except (httpx.HTTPError, ValueError, KeyError):
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "TikTok authorization expired. Reconnect TikTok.",
        ) from None

    new_access_token = encrypt_token(tokens["access_token"])
    new_refresh_token = encrypt_token(tokens["refresh_token"])
    expires_at = now + timedelta(seconds=int(tokens["expires_in"]))
    try:
        context = access.require_permission(
            db, principal, business_id, Permission.PUBLISH, lock=True,
        )
    except ApplicationError:
        Transactions(db).rollback()
        repository.save_refreshed_credentials_after_exchange_scoped(
            db, context, account_id,
            encrypted_access_token=new_access_token,
            encrypted_refresh_token=new_refresh_token,
            token_expires_at=expires_at,
            expected_refresh_token=refresh_credential,
        )
        Transactions(db).commit()
        raise

    saved = repository.save_refreshed_credentials_scoped(
        db, context, account_id,
        encrypted_access_token=new_access_token,
        encrypted_refresh_token=new_refresh_token,
        token_expires_at=expires_at,
        expected_refresh_token=refresh_credential,
    )
    if not saved:
        Transactions(db).rollback()
        context = access.require_permission(
            db, principal, business_id, Permission.PUBLISH,
        )
        account = repository.get_account_scoped(db, context, account_id)
        if account is None or account.connection_status != "connected":
            raise ApplicationError(ErrorKind.CONFLICT, "Reconnect your TikTok account")
        current_expiry = account.token_expires_at
        if current_expiry is not None and current_expiry.tzinfo is None:
            current_expiry = current_expiry.replace(tzinfo=timezone.utc)
        if current_expiry is not None and current_expiry > datetime.now(timezone.utc):
            return decrypt_token(account.encrypted_access_token)
        raise ApplicationError(ErrorKind.CONFLICT, "TikTok authorization expired. Reconnect TikTok.")
    Transactions(db).commit()
    return tokens["access_token"]
