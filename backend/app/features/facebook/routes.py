"""Facebook OAuth and Page-selection HTTP endpoints."""
import os
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth import get_authenticated_principal, verify_token
from app.features.access.principal import AuthenticatedPrincipal
from app.database import get_db
from app.errors import ApplicationError, ErrorKind
from app.http_errors import http_error
from . import service
from .schemas import FacebookHandoffRequest, FacebookPageSelection

router = APIRouter(prefix="/auth/facebook", tags=["Facebook OAuth"])
page_router = APIRouter()


@page_router.get("/facebook/page", dependencies=[Depends(verify_token)])
async def get_facebook_page():
    try:
        return await service.page_info()
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/accounts")
def get_connected_facebook_accounts(
    business_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.list_accounts(business_id, db=db, principal=principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.delete("/accounts/{account_id}")
def disconnect_facebook_account(
    account_id: str,
    business_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.disconnect_account(
            account_id,
            business_id,
            db=db,
            principal=principal,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/start")
def start_facebook_connection(
    business_id: str,
    request: Request,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        frontend_origin = _frontend_origin_from_request(request.headers.get("origin"))
        authorization_url = service.start_connection(
            business_id,
            principal,
            db=db,
            frontend_origin=frontend_origin,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc
    return {"authorization_url": authorization_url}


@router.get("/callback")
async def facebook_callback(
    state: str = Query(...),
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    redirect_context = service.callback_frontend_origin(state, db=db)
    try:
        selection_token = await service.complete_callback(
            state,
            code,
            error,
            db=db,
        )
    except ApplicationError as exc:
        if "Invalid, expired, or previously used" in exc.detail:
            result = "invalid_state"
        elif "No Facebook Pages" in exc.detail:
            result = "no_pages"
        elif exc.kind.value == "invalid_input":
            result = "authorization_declined"
        else:
            result = "provider_error"
        return _safe_callback_redirect(
            result=result,
            frontend_origin=redirect_context[1] if redirect_context else None,
        )
    return _safe_callback_redirect(
        selection_token=selection_token,
        business_id=redirect_context[0] if redirect_context else None,
        frontend_origin=redirect_context[1] if redirect_context else None,
    )


@router.post("/select-page")
def select_facebook_page(
    request: FacebookPageSelection,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.select_page(
            request.selection_token,
            request.business_id,
            request.page_id,
            principal,
            db=db,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/handoff")
def exchange_facebook_handoff(
    request: FacebookHandoffRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.handoff_pages(
            request.handoff_token,
            request.business_id,
            principal,
            db=db,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


def redirect_to_dashboard(
    selection_token: str | None = None,
    *,
    business_id: str | None = None,
    frontend_origin: str | None = None,
    result: str | None = None,
) -> RedirectResponse:
    """Return a temporary selection token or safe result code in the URL fragment."""
    frontend_url = os.getenv("FRONTEND_BASE_URL", "").rstrip("/")
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

    redirect_origin = _frontend_origin_from_value(frontend_origin, parsed_url)
    target_url = f"{redirect_origin}/"
    if parsed_url.path:
        target_url += parsed_url.path.strip("/") + "/"
    if selection_token is not None and business_id is not None:
        fragment = f"facebook_handoff={selection_token}&business_id={business_id}"
    else:
        fragment = f"facebook_result={result}"
    return RedirectResponse(
        url=f"{target_url}#{fragment}",
        status_code=303,
    )


def _safe_callback_redirect(
    selection_token: str | None = None,
    *,
    business_id: str | None = None,
    frontend_origin: str | None = None,
    result: str | None = None,
) -> RedirectResponse:
    try:
        return redirect_to_dashboard(
            selection_token,
            business_id=business_id,
            frontend_origin=frontend_origin,
            result=result,
        )
    except RuntimeError as exc:
        raise http_error(
            ApplicationError(
                kind=ErrorKind.UNAVAILABLE,
                detail="Facebook callback redirect is not configured",
            )
        ) from exc


def _frontend_origin_from_request(origin: str | None) -> str:
    frontend_url = os.getenv("FRONTEND_BASE_URL", "").rstrip("/")
    configured = urlsplit(frontend_url)
    if (
        configured.scheme not in ("http", "https")
        or not configured.netloc
        or configured.username
        or configured.password
        or configured.query
        or configured.fragment
    ):
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Facebook callback redirect is not configured",
        )
    configured_origin = f"{configured.scheme}://{configured.netloc}"
    if not origin:
        return configured_origin

    requested = urlsplit(origin)
    if (
        requested.scheme not in ("http", "https")
        or not requested.netloc
        or requested.username
        or requested.password
        or requested.path
        or requested.query
        or requested.fragment
    ):
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Facebook connection origin is not allowed",
        )
    requested_origin = f"{requested.scheme}://{requested.netloc}"
    configured_host = configured.hostname
    requested_host = requested.hostname
    local_alias = (
        configured.scheme == requested.scheme == "http"
        and configured_host in ("localhost", "127.0.0.1")
        and requested_host in ("localhost", "127.0.0.1")
        and configured.port == requested.port
    )
    if requested_origin != configured_origin and not local_alias:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Facebook connection origin is not allowed",
        )
    return requested_origin


def _frontend_origin_from_value(origin: str | None, configured_url) -> str:
    configured_origin = f"{configured_url.scheme}://{configured_url.netloc}"
    if not origin:
        return configured_origin
    parsed = urlsplit(origin)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("Invalid Facebook callback frontend origin")
    configured_host = configured_url.hostname
    local_alias = (
        configured_url.scheme == parsed.scheme == "http"
        and configured_host in ("localhost", "127.0.0.1")
        and parsed.hostname in ("localhost", "127.0.0.1")
        and configured_url.port == parsed.port
    )
    if origin != configured_origin and not local_alias:
        raise RuntimeError("Invalid Facebook callback frontend origin")
    return origin
