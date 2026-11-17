import os
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from starlette.types import ASGIApp, Receive, Scope, Send

from app.auth import get_authenticated_principal, verify_token
from app.database import get_db
from app.errors import ApplicationError, ErrorKind
from app.features.access.principal import AuthenticatedPrincipal
from app.frontend_origins import resolve_frontend_origin
from app.http_errors import http_error
from app.features.instagram import service
from app.features.instagram.schemas import InstagramConnectionResponse

router = APIRouter(prefix="/auth/instagram", tags=["Instagram OAuth"])


class InstagramCallbackAccessLogRedactionMiddleware:
    """Redact callback query parameters only while Uvicorn emits its access log."""

    CALLBACK_PATHS = {
        "/auth/facebook/callback",
        "/auth/instagram/callback",
        "/api/integrations/tiktok/callback",
    }

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if (
            scope["type"] != "http"
            or scope.get("path") not in self.CALLBACK_PATHS
        ):
            await self.app(scope, receive, send)
            return

        query_string = scope.get("query_string", b"")
        route_scope = dict(scope)
        route_scope["query_string"] = query_string
        scope["query_string"] = b""
        try:
            await self.app(route_scope, receive, send)
        finally:
            scope["query_string"] = query_string


@router.get("/start")
def start_instagram_connection(
    business_id: str,
    request: Request,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        frontend_origin = resolve_frontend_origin(
            request.headers.get("origin"),
            os.environ.get("FRONTEND_BASE_URL", ""),
        )
    except ValueError as exc:
        kind = (
            ErrorKind.UNAVAILABLE
            if str(exc) == "Invalid frontend URL configuration"
            else ErrorKind.INVALID_INPUT
        )
        raise http_error(
            ApplicationError(kind, "Instagram connection origin is not allowed"),
        ) from exc

    try:
        return {
            "authorization_url": service.start_connection(
                db, business_id, principal, frontend_origin=frontend_origin,
            )
        }
    except ApplicationError as exc:
        raise http_error(exc) from exc
    except service.BusinessNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.ConnectionStartConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/callback")
async def instagram_callback(
    state: str = Query(..., min_length=1),
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        callback = service.consume_callback_state(db, state)
    except ApplicationError as exc:
        raise http_error(exc) from exc
    if callback is None:
        return _safe_redirect("invalid_state")
    authorization, principal, frontend_origin = callback
    if error or not code:
        return _safe_redirect("authorization_declined", frontend_origin)

    try:
        status = await service.complete_authorization(
            db, authorization, code, principal=principal,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc
    return _safe_redirect(status, frontend_origin)


@router.get("/accounts", response_model=InstagramConnectionResponse)
def get_instagram_connection(
    business_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.connection_response(db, business_id, principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.delete("/accounts")
def disconnect_instagram(
    business_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.disconnect_connection(db, business_id, principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


def _redirect(
    result: str,
    frontend_origin: str | None = None,
) -> RedirectResponse:
    frontend_url = os.environ.get("FRONTEND_BASE_URL", "").rstrip("/")
    parsed = urlsplit(frontend_url)
    try:
        redirect_origin = resolve_frontend_origin(frontend_origin, frontend_url)
    except ValueError as exc:
        raise RuntimeError("Invalid frontend URL configuration") from exc
    frontend_path = parsed.path.rstrip("/")
    return RedirectResponse(
        url=(
            f"{redirect_origin}{frontend_path}/"
            f"#instagram_result={quote(result, safe='')}"
        ),
        status_code=303,
    )


def _safe_redirect(
    result: str,
    frontend_origin: str | None = None,
) -> RedirectResponse:
    try:
        return _redirect(result, frontend_origin)
    except RuntimeError as exc:
        raise http_error(
            ApplicationError(
                kind=ErrorKind.UNAVAILABLE,
                detail="Instagram callback redirect is not configured",
            )
        ) from exc
