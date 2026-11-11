import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from app.features.instagram import provider, repository
from app.features.instagram.provider import MetaAPIError, TokenExchangeError
from app.models import InstagramOAuthState
from app.token_service import encrypt_token

STATUS_MESSAGES = {
    "not_connected": "La página autorizada no tiene una cuenta profesional de Instagram vinculada.",
    "linked_not_api_authorized": "La cuenta está vinculada, pero falta el permiso para publicar. Reautoriza Instagram.",
    "connected_and_authorized": None,
    "reauthorization_required": "La autorización de Instagram expiró. Vuelve a conectar la cuenta.",
    "permission_error": "Meta no concedió todos los permisos necesarios. Revisa la configuración y vuelve a autorizar.",
    "discovery_error": "No se pudo verificar la cuenta de Instagram asociada a la página autorizada.",
}

logger = logging.getLogger(__name__)


def _log_provider_failure(stage: str, error: Exception) -> None:
    if isinstance(error, MetaAPIError):
        logger.warning(
            "Instagram %s failed (Meta status=%s, code=%s)",
            stage,
            error.status_code,
            error.error_code,
        )
    else:
        logger.warning(
            "Instagram %s failed (%s)",
            stage,
            type(error).__name__,
        )


def start_connection(db: Session, business_id: str, user_id: str) -> str:
    business = repository.get_business(db, business_id)
    if business is None:
        raise ValueError("No se encontró el negocio seleccionado.")
    page = repository.get_facebook_page(db, business_id)
    if page is None:
        raise ValueError("Conecta primero una página de Facebook para este negocio.")

    state = secrets.token_urlsafe(32)
    try:
        authorization_url = provider.build_login_url(state)
    except RuntimeError as exc:
        raise ValueError(
            "La conexión de Instagram no está configurada en el servidor."
        ) from exc

    repository.create_oauth_state(
        db,
        state_hash=hashlib.sha256(state.encode()).hexdigest(),
        business_id=business_id,
        user_id=user_id,
        facebook_page_id=page.platform_account_id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    return authorization_url


def consume_callback_state(db: Session, state: str) -> InstagramOAuthState | None:
    return repository.consume_oauth_state(
        db, hashlib.sha256(state.encode()).hexdigest(),
    )


def _save_status(
    db: Session,
    business_id: str,
    *,
    status: str,
    permissions: set[str] | None = None,
    page_id: str | None = None,
    account_id: str | None = None,
    username: str | None = None,
    token: str | None = None,
    expires_in: int | None = None,
) -> None:
    existing = repository.get_connection(db, business_id)
    if (
        existing is not None
        and existing.status == "connected_and_authorized"
        and status != "connected_and_authorized"
    ):
        return
    token_expiry = (
        datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        if expires_in is not None
        else None
    )
    repository.save_connection(
        db,
        business_id,
        {
            "instagram_account_id": account_id,
            "username": username,
            "facebook_page_id": page_id,
            "encrypted_access_token": encrypt_token(token) if token else None,
            "token_expires_at": token_expiry,
            "granted_permissions": sorted(permissions or set()),
            "status": status,
            "last_error": STATUS_MESSAGES[status],
        },
    )


async def complete_authorization(
    db: Session,
    authorization: InstagramOAuthState,
    code: str,
) -> str:
    try:
        access_token, expires_in = await provider.exchange_code_for_long_lived_token(
            code,
        )
    except MetaAPIError as exc:
        _log_provider_failure("token exchange", exc)
        status = (
            "reauthorization_required"
            if exc.error_code == 190
            else "permission_error"
            if exc.error_code in (10, 200)
            else "discovery_error"
        )
        _save_status(db, authorization.business_id, status=status)
        return status
    except TokenExchangeError as exc:
        logger.warning(
            "Instagram token exchange failed (reason=%s)",
            exc.reason_code,
        )
        _save_status(db, authorization.business_id, status="discovery_error")
        return "discovery_error"
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        _log_provider_failure("token exchange", exc)
        _save_status(db, authorization.business_id, status="discovery_error")
        return "discovery_error"

    try:
        permissions = await provider.get_granted_permissions(access_token)
    except MetaAPIError as exc:
        _log_provider_failure("permission lookup", exc)
        status = (
            "reauthorization_required"
            if exc.error_code == 190
            else "permission_error"
            if exc.error_code in (10, 200)
            else "discovery_error"
        )
        _save_status(db, authorization.business_id, status=status)
        return status
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        _log_provider_failure("permission lookup", exc)
        _save_status(db, authorization.business_id, status="discovery_error")
        return "discovery_error"

    required_page_permissions = {"pages_show_list", "pages_read_engagement"}
    if not required_page_permissions.issubset(permissions):
        logger.warning("Instagram permission lookup omitted required Page grants")
        _save_status(
            db, authorization.business_id, status="permission_error",
            permissions=permissions,
        )
        return "permission_error"
    if "instagram_basic" not in permissions:
        logger.warning("Instagram permission lookup omitted instagram_basic")
        _save_status(
            db, authorization.business_id, status="permission_error",
            permissions=permissions,
        )
        return "permission_error"

    try:
        pages = await provider.get_managed_pages(access_token)
    except MetaAPIError as exc:
        _log_provider_failure("Page listing", exc)
        status = (
            "reauthorization_required"
            if exc.error_code == 190
            else "permission_error"
            if exc.error_code in (10, 200)
            else "discovery_error"
        )
        _save_status(
            db, authorization.business_id, status=status,
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return status
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        _log_provider_failure("Page listing", exc)
        _save_status(
            db, authorization.business_id, status="discovery_error",
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return "discovery_error"

    page = next(
        (
            item for item in pages
            if item.get("id") == authorization.facebook_page_id
        ),
        None,
    )
    if page is None:
        logger.warning(
            "Instagram Page listing did not include the authorized business Page"
        )
        _save_status(
            db, authorization.business_id, status="discovery_error",
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return "discovery_error"

    try:
        page_details = await provider.get_page_instagram_account(
            access_token,
            authorization.facebook_page_id,
        )
    except MetaAPIError as exc:
        _log_provider_failure("account lookup", exc)
        status = (
            "reauthorization_required"
            if exc.error_code == 190
            else "permission_error"
            if exc.error_code in (10, 200)
            else "discovery_error"
        )
        _save_status(
            db, authorization.business_id, status=status,
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return status
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        _log_provider_failure("account lookup", exc)
        _save_status(
            db, authorization.business_id, status="discovery_error",
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return "discovery_error"

    returned_page_id = page_details.get("id")
    if returned_page_id != authorization.facebook_page_id:
        logger.warning(
            "Instagram account lookup returned a different Page than authorized"
        )
        _save_status(
            db, authorization.business_id, status="discovery_error",
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return "discovery_error"

    instagram = page_details.get("instagram_business_account")
    if not isinstance(instagram, dict):
        if instagram is not None:
            logger.warning(
                "Instagram account lookup returned an invalid account structure"
            )
            _save_status(
                db, authorization.business_id, status="discovery_error",
                permissions=permissions, page_id=authorization.facebook_page_id,
            )
            return "discovery_error"
        _save_status(
            db, authorization.business_id, status="not_connected",
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return "not_connected"

    account_id = instagram.get("id")
    username = instagram.get("username")
    if not isinstance(account_id, str) or not account_id:
        logger.warning(
            "Instagram account lookup returned an invalid account ID"
        )
        _save_status(
            db, authorization.business_id, status="discovery_error",
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return "discovery_error"
    if not isinstance(username, str) or not username:
        username = None

    status = (
        "connected_and_authorized"
        if "instagram_content_publish" in permissions
        else "linked_not_api_authorized"
    )
    _save_status(
        db,
        authorization.business_id,
        status=status,
        permissions=permissions,
        page_id=authorization.facebook_page_id,
        account_id=account_id,
        username=username,
        token=access_token,
        expires_in=expires_in,
    )
    return status


def connection_response(db: Session, business_id: str) -> dict:
    connection = repository.get_connection(db, business_id)
    if connection is None:
        return {
            "status": "not_connected",
            "username": None,
            "facebook_page_id": None,
            "facebook_page_name": None,
            "granted_permissions": [],
            "missing_permissions": list(provider.REQUIRED_PERMISSIONS),
            "message": None,
        }

    status = connection.status
    expires_at = connection.token_expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if (
        expires_at is not None
        and expires_at <= datetime.now(timezone.utc)
        and status in ("connected_and_authorized", "linked_not_api_authorized")
    ):
        status = "reauthorization_required"

    page = repository.get_facebook_page(db, business_id)
    if (
        connection.facebook_page_id is not None
        and (
            page is None
            or page.platform_account_id != connection.facebook_page_id
        )
    ):
        status = "discovery_error"
    granted = connection.granted_permissions or []
    return {
        "status": status,
        "username": connection.username,
        "facebook_page_id": connection.facebook_page_id,
        "facebook_page_name": page.account_name if page else None,
        "granted_permissions": granted,
        "missing_permissions": [
            permission for permission in provider.REQUIRED_PERMISSIONS
            if permission not in granted
        ],
        "message": (
            STATUS_MESSAGES[status]
            if status in STATUS_MESSAGES
            else STATUS_MESSAGES["reauthorization_required"]
        ),
    }
