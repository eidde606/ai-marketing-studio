"""Facebook OAuth and connected-Page application workflows."""
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.models import FacebookOAuthState, SocialAccount
from app.token_service import decrypt_token, encrypt_token
from app.transactions import Transactions
from . import provider, repository


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
    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
    login_url = provider.get_facebook_login_url(state)
    repository.add_oauth_state(
        db,
        FacebookOAuthState(
            state_hash=state_hash,
            business_id=business.id,
            user_id=user_id,
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
    authorization = repository.consume_oauth_state(
        db,
        state_hash,
        datetime.now(timezone.utc),
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
    repository.add_pending_selection(
        db,
        FacebookOAuthState(
            state_hash=hashlib.sha256(secrets.token_bytes(32)).hexdigest(),
            business_id=authorization[0],
            user_id=authorization[1],
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            encrypted_pages=encrypted_pages,
            selection_token_hash=selection_hash,
        ),
    )
    Transactions(db).commit()
    return selection_token


def handoff_pages(
    token: str,
    user_id: str,
    *,
    db: Session,
) -> dict:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    pending = repository.get_pending_handoff(
        db,
        token_hash,
        user_id,
        datetime.now(timezone.utc),
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
    user_id: str,
    *,
    db: Session,
) -> dict[str, str]:
    now = datetime.now(timezone.utc)
    selection_hash = hashlib.sha256(
        selection_token.encode("utf-8"),
    ).hexdigest()
    pending = repository.lock_pending_selection(
        db,
        selection_hash,
        user_id,
        now,
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

    account = repository.get_page_account(
        db,
        pending.business_id,
        selected_page["id"],
    )
    if account is None:
        account = SocialAccount(
            business_id=pending.business_id,
            platform="facebook",
            platform_account_id=selected_page["id"],
            account_name=selected_page["name"],
            encrypted_access_token=encrypt_token(page_token),
            connection_status="connected",
        )
        repository.add_social_account(db, account)
    else:
        account.account_name = selected_page["name"]
        account.encrypted_access_token = encrypt_token(page_token)
        account.connection_status = "connected"

    result = {
        "status": "connected",
        "business_id": pending.business_id,
        "page_id": selected_page["id"],
        "page_name": selected_page["name"],
    }
    repository.delete_pending_selection(db, pending)
    Transactions(db).commit()
    return result


def list_accounts(business_id: str, *, db: Session) -> dict:
    if repository.get_business(db, business_id) is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")

    accounts = repository.list_page_accounts(db, business_id)
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
