import base64
import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from app.frontend_origins import resolve_frontend_origin
from app.features.instagram import diagnostics, provider, repository
from app.features.instagram.provider import MetaAPIError, TokenExchangeError
from app.models import InstagramConnection, InstagramOAuthState
from app.token_service import encrypt_token
from app.transactions import Transactions

STATUS_MESSAGES = {
    "not_connected": "La página autorizada no tiene una cuenta profesional de Instagram vinculada.",
    "linked_not_api_authorized": "La cuenta está vinculada, pero falta el permiso para publicar. Reautoriza Instagram.",
    "connected_and_authorized": None,
    "reauthorization_required": "La autorización de Instagram expiró. Vuelve a conectar la cuenta.",
    "permission_error": "Meta no concedió todos los permisos necesarios. Revisa la configuración y vuelve a autorizar.",
    "discovery_error": "No se pudo verificar la cuenta de Instagram asociada a la página autorizada.",
}

logger = logging.getLogger(__name__)


def _log_oauth_diagnostics(result: dict) -> None:
    logger.info(
        "Instagram OAuth diagnostic: token_type=%s token_valid=%s "
        "app_id_match=%s debug_scopes=%s permissions=%s page_ids=%s "
        "page_tasks=%s page_result_count=%s authorized_page_id=%s "
        "authorized_page_match=%s page_list_complete=%s errors=%s",
        result["token_type"],
        result["token_valid"],
        result["app_id_match"],
        result["debug_scopes"],
        result["permissions"],
        result["page_ids"],
        result["page_tasks"],
        result["page_result_count"],
        result["authorized_page_id"],
        result["authorized_page_match"],
        result["page_list_complete"],
        result["errors"],
    )


class BusinessNotFoundError(Exception):
    """The requested business does not exist."""


class ConnectionStartConflictError(Exception):
    """The business exists, but its Instagram connection cannot be started."""


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


def start_connection(
    db: Session,
    business_id: str,
    principal: AuthenticatedPrincipal,
    *,
    frontend_origin: str | None = None,
) -> str:
    try:
        return _start_connection(
            db, business_id, principal, frontend_origin=frontend_origin,
        )
    except ApplicationError as exc:
        if exc.kind is ErrorKind.NOT_FOUND:
            raise BusinessNotFoundError(
                "No se encontró el negocio seleccionado.",
            ) from exc
        raise
    except ValueError as exc:
        try:
            access.require_permission(
                db, principal, business_id, Permission.MANAGE_CONNECTIONS,
            )
        except ApplicationError as authorization_error:
            if authorization_error.kind is ErrorKind.NOT_FOUND:
                raise BusinessNotFoundError(
                    "No se encontró el negocio seleccionado.",
                ) from authorization_error
            raise
        raise ConnectionStartConflictError(str(exc)) from exc


def _start_connection(
    db: Session,
    business_id: str,
    principal: AuthenticatedPrincipal,
    *,
    frontend_origin: str | None,
) -> str:
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS, lock=True,
    )
    pages = repository.get_connected_facebook_pages_scoped(db, context)
    if not pages:
        raise ValueError("Conecta primero una página de Facebook para este negocio.")
    if len(pages) > 1:
        raise ValueError(
            "Desconecta las páginas adicionales de Facebook de este negocio antes de conectar Instagram."
        )
    page = pages[0]

    state = _encode_oauth_state(
        resolve_frontend_origin(
            frontend_origin,
            os.getenv("FRONTEND_BASE_URL", ""),
        ),
    )
    try:
        authorization_url = provider.build_login_url(state)
    except RuntimeError as exc:
        raise ValueError(
            "La conexión de Instagram no está configurada en el servidor."
        ) from exc

    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS, lock=True,
    )
    repository.add_oauth_state_scoped(
        db,
        context,
        InstagramOAuthState(
            state_hash=hashlib.sha256(state.encode()).hexdigest(),
            business_id=business_id,
            user_id=principal.subject,
            facebook_page_id=page.platform_account_id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        ),
    )
    Transactions(db).commit()
    return authorization_url


def consume_callback_state(
    db: Session,
    state: str,
) -> tuple[InstagramOAuthState, AuthenticatedPrincipal, str | None] | None:
    now = datetime.now(timezone.utc)
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    identity = repository.oauth_state_identity(db, state_hash, now)
    if identity is None:
        return None
    business_id, initiator_id, facebook_page_id = identity
    principal = access.resolve_oauth_initiator(db, initiator_id)
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS,
    )
    row = repository.consume_oauth_state_scoped(
        db, context, state_hash, initiator_id, now,
    )
    Transactions(db).commit()
    if row is None:
        return None
    return (
        InstagramOAuthState(
            business_id=row.business_id,
            user_id=row.user_id,
            facebook_page_id=row.facebook_page_id,
            expires_at=now,
            state_hash=state_hash,
        ),
        principal,
        _decode_oauth_state_origin(state),
    )


def _encode_oauth_state(frontend_origin: str) -> str:
    encoded_origin = base64.urlsafe_b64encode(
        frontend_origin.encode("utf-8"),
    ).decode("ascii").rstrip("=")
    return f"v1.{encoded_origin}.{secrets.token_urlsafe(32)}"


def _decode_oauth_state_origin(state: str) -> str | None:
    parts = state.split(".", 2)
    if len(parts) != 3 or parts[0] != "v1" or not parts[2]:
        return None
    try:
        encoded_origin = parts[1] + "=" * (-len(parts[1]) % 4)
        origin = base64.b64decode(
            encoded_origin,
            altchars=b"-_",
            validate=True,
        ).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    return origin


def _save_status(
    db: Session,
    business_id: str,
    principal: AuthenticatedPrincipal,
    *,
    status: str,
    permissions: set[str] | None = None,
    page_id: str | None = None,
    account_id: str | None = None,
    username: str | None = None,
    token: str | None = None,
    expires_in: int | None = None,
) -> None:
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS, lock=True,
    )
    existing = repository.get_connection_scoped(db, context)
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
    values = {
        "instagram_account_id": account_id,
        "username": username,
        "facebook_page_id": page_id,
        "encrypted_access_token": encrypt_token(token) if token else None,
        "token_expires_at": token_expiry,
        "granted_permissions": sorted(permissions or set()),
        "status": status,
        "last_error": STATUS_MESSAGES[status],
    }
    # Keep the second lookup at its existing point, after token preparation.
    existing = repository.get_connection_scoped(db, context)
    if (
        existing is not None
        and existing.status == "connected_and_authorized"
        and status != "connected_and_authorized"
    ):
        return
    if existing is None:
        repository.add_connection_scoped(
            db, context, InstagramConnection(business_id=business_id, **values),
        )
    else:
        repository.update_connection_scoped(db, context, values)
    Transactions(db).commit()


async def complete_authorization(
    db: Session,
    authorization: InstagramOAuthState,
    code: str,
    *,
    principal: AuthenticatedPrincipal,
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
        _save_status(db, authorization.business_id, principal, status=status)
        return status
    except TokenExchangeError as exc:
        logger.warning(
            "Instagram token exchange failed (reason=%s)",
            exc.reason_code,
        )
        _save_status(db, authorization.business_id, principal, status="discovery_error")
        return "discovery_error"
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        _log_provider_failure("token exchange", exc)
        _save_status(db, authorization.business_id, principal, status="discovery_error")
        return "discovery_error"

    if diagnostics.requested_but_unsafe():
        logger.warning(
            "Instagram OAuth diagnostic refused (category=development_guard_failed)"
        )
    elif diagnostics.enabled_for_local_development():
        try:
            diagnostic_result = await diagnostics.collect_oauth_diagnostics(
                access_token,
                authorization.facebook_page_id,
            )
        except Exception:
            logger.warning(
                "Instagram OAuth diagnostic failed (category=internal_error)"
            )
        else:
            _log_oauth_diagnostics(diagnostic_result)

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
        _save_status(db, authorization.business_id, principal, status=status)
        return status
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        _log_provider_failure("permission lookup", exc)
        _save_status(db, authorization.business_id, principal, status="discovery_error")
        return "discovery_error"

    required_page_permissions = {"pages_show_list", "pages_read_engagement"}
    if not required_page_permissions.issubset(permissions):
        logger.warning("Instagram permission lookup omitted required Page grants")
        _save_status(
            db, authorization.business_id, principal, status="permission_error",
            permissions=permissions,
        )
        return "permission_error"
    if "instagram_basic" not in permissions:
        logger.warning("Instagram permission lookup omitted instagram_basic")
        _save_status(
            db, authorization.business_id, principal, status="permission_error",
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
            db, authorization.business_id, principal, status=status,
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return status
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        _log_provider_failure("Page listing", exc)
        _save_status(
            db, authorization.business_id, principal, status="discovery_error",
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
            db, authorization.business_id, principal, status="discovery_error",
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
            db, authorization.business_id, principal, status=status,
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return status
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        _log_provider_failure("account lookup", exc)
        _save_status(
            db, authorization.business_id, principal, status="discovery_error",
            permissions=permissions, page_id=authorization.facebook_page_id,
        )
        return "discovery_error"

    returned_page_id = page_details.get("id")
    if returned_page_id != authorization.facebook_page_id:
        logger.warning(
            "Instagram account lookup returned a different Page than authorized"
        )
        _save_status(
            db, authorization.business_id, principal, status="discovery_error",
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
                db, authorization.business_id, principal, status="discovery_error",
                permissions=permissions, page_id=authorization.facebook_page_id,
            )
            return "discovery_error"
        _save_status(
            db, authorization.business_id, principal, status="not_connected",
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
            db, authorization.business_id, principal, status="discovery_error",
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
        principal,
        status=status,
        permissions=permissions,
        page_id=authorization.facebook_page_id,
        account_id=account_id,
        username=username,
        token=access_token,
        expires_in=expires_in,
    )
    return status


def connection_response(
    db: Session,
    business_id: str,
    principal: AuthenticatedPrincipal,
) -> dict:
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS,
    )
    connection = repository.get_connection_scoped(db, context)
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

    page = repository.get_facebook_page_scoped(db, context)
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


def disconnect_connection(
    db: Session,
    business_id: str,
    principal: AuthenticatedPrincipal,
) -> dict[str, str]:
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_CONNECTIONS, lock=True,
    )
    existing = repository.get_connection_scoped(db, context)
    if existing is None:
        return {"status": "not_connected"}
    repository.update_connection_scoped(db, context, {
        "instagram_account_id": None,
        "username": None,
        "facebook_page_id": None,
        "encrypted_access_token": None,
        "token_expires_at": None,
        "granted_permissions": [],
        "status": "not_connected",
        "last_error": None,
    })
    Transactions(db).commit()
    return {"status": "not_connected"}
