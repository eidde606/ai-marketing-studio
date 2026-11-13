"""Facebook OAuth and connected-Page application workflows."""
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from app.models import FacebookOAuthState, SocialAccount
from app.token_service import decrypt_token, encrypt_token
from app.transactions import Transactions
from . import provider, repository


async def page_info() -> dict:
    page_id = os.getenv("FACEBOOK_PAGE_ID")
    access_token = os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN")
    if not page_id or not access_token:
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Facebook is not configured",
        )

    try:
        return await provider.get_page_info(page_id, access_token)
    except httpx.HTTPStatusError as exc:
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Unable to retrieve Facebook Page",
        ) from exc
    except httpx.RequestError as exc:
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Facebook connection failed",
        ) from exc


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
    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
    login_url = provider.get_facebook_login_url(state)
    repository.add_oauth_state_scoped(
        db,
        context,
        FacebookOAuthState(
            state_hash=state_hash,
            business_id=business_id,
            user_id=principal.subject,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        ),
    )
    Transactions(db).commit()
    return login_url


async def complete_callback(
    state: str,
    code: str | None,
    error: str | None,
    *,
    db: Session,
) -> str:
    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    identity = repository.oauth_state_identity(db, state_hash, now)
    if identity is None:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Invalid, expired, or previously used authorization",
        )
    business_id, initiator_id = identity
    principal = access.resolve_oauth_initiator(db, initiator_id)
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS,
    )
    authorization = repository.consume_oauth_state_scoped(
        db, context, state_hash, initiator_id, now,
    )
    Transactions(db).commit()

    if authorization is None:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Invalid, expired, or previously used authorization",
        )

    if error:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Facebook authorization was declined",
        )
    if not code:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Facebook did not return an authorization code",
        )

    try:
        short_token = await provider.exchange_code_for_token(code)
        long_token = await provider.get_long_lived_user_token(short_token)
        pages = await provider.get_managed_pages(long_token)
    except (httpx.HTTPError, KeyError, ValueError):
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Unable to retrieve Facebook Pages",
        ) from None

    if not pages:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "No Facebook Pages available for this account",
        )

    encrypted_pages = encrypt_token(json.dumps(pages))
    selection_token = secrets.token_urlsafe(32)
    selection_hash = hashlib.sha256(
        selection_token.encode("utf-8"),
    ).hexdigest()
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS, lock=True,
    )
    repository.add_oauth_state_scoped(
        db,
        context,
        FacebookOAuthState(
            state_hash=hashlib.sha256(secrets.token_bytes(32)).hexdigest(),
            business_id=business_id,
            user_id=initiator_id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            encrypted_pages=encrypted_pages,
            selection_token_hash=selection_hash,
        ),
    )
    Transactions(db).commit()
    return selection_token


def handoff_pages(
    token: str,
    principal: AuthenticatedPrincipal,
    *,
    db: Session,
) -> dict:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    business_id = repository.pending_selection_business(
        db, token_hash, principal.subject, now,
    )
    if business_id is None:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Invalid or expired Facebook handoff",
        )
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS,
    )
    pending = repository.get_pending_selection_scoped(
        db, context, token_hash, principal.subject, now,
    )
    if pending is None or not pending.encrypted_pages:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Invalid or expired Facebook handoff",
        )

    pages = json.loads(decrypt_token(pending.encrypted_pages))
    return {
        "business_id": pending.business_id,
        "pages": [
            {"id": page["id"], "name": page["name"]}
            for page in pages
        ],
    }


def select_page(
    selection_token: str,
    page_id: str,
    principal: AuthenticatedPrincipal,
    *,
    db: Session,
) -> dict[str, str]:
    now = datetime.now(timezone.utc)
    selection_hash = hashlib.sha256(
        selection_token.encode("utf-8"),
    ).hexdigest()
    business_id = repository.pending_selection_business(
        db, selection_hash, principal.subject, now,
    )
    if business_id is None:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Invalid or expired Page selection",
        )
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS, lock=True,
    )
    pending = repository.get_pending_selection_scoped(
        db, context, selection_hash, principal.subject, now, lock=True,
    )
    if pending is None or not pending.encrypted_pages:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Invalid or expired Page selection",
        )

    pages = json.loads(decrypt_token(pending.encrypted_pages))
    selected_page = next(
        (page for page in pages if page["id"] == page_id),
        None,
    )
    if selected_page is None:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Selected Facebook Page is not available",
        )

    page_token = selected_page.get("access_token")
    if not page_token:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Facebook did not provide a Page access token",
        )

    account = repository.get_page_account_scoped(db, context, selected_page["id"])
    if account is None:
        repository.add_account_scoped(db, context, SocialAccount(
            business_id=business_id,
            platform="facebook",
            platform_account_id=selected_page["id"],
            account_name=selected_page["name"],
            encrypted_access_token=encrypt_token(page_token),
            connection_status="connected",
        ))
    else:
        repository.update_account_scoped(db, context, account.id, {
            "account_name": selected_page["name"],
            "encrypted_access_token": encrypt_token(page_token),
            "connection_status": "connected",
        })

    result = {
        "status": "connected",
        "business_id": business_id,
        "page_id": selected_page["id"],
        "page_name": selected_page["name"],
    }
    repository.delete_pending_selection_scoped(
        db, context, selection_hash, principal.subject,
    )
    Transactions(db).commit()
    return result


def list_accounts(
    business_id: str,
    *,
    db: Session,
    principal: AuthenticatedPrincipal,
) -> dict:
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
                "platform": account.platform,
                "page_id": account.platform_account_id,
                "page_name": account.account_name,
                "connection_status": account.connection_status,
            }
            for account in accounts
        ]
    }
