import os
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.auth import get_authenticated_principal, verify_token
from app.database import get_db
from app.errors import ApplicationError
from app.features.access.principal import AuthenticatedPrincipal
from app.http_errors import http_error
from app.features.instagram import service
from app.features.instagram.schemas import InstagramConnectionResponse

router = APIRouter(prefix="/auth/instagram", tags=["Instagram OAuth"])


class InstagramCallbackAccessLogRedactionMiddleware:
    """Redact callback query parameters only while Uvicorn emits its access log."""

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
            or scope.get("path") != "/auth/instagram/callback"
        ):
            await self.app(scope, receive, send)
            return

        async def send_without_query(message: Message) -> None:
            if message["type"] == "http.response.start":
                query_string = scope.get("query_string", b"")
                scope["query_string"] = b""
                try:
                    await send(message)
                finally:
                    scope["query_string"] = query_string
                return
            await send(message)

        await self.app(scope, receive, send_without_query)


@router.get("/start")
def start_instagram_connection(
    business_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return {
            "authorization_url": service.start_connection(
                db, business_id, principal,
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
        return _redirect("invalid_state")
    authorization, principal = callback
    if error or not code:
        return _redirect("authorization_declined")

    try:
        status = await service.complete_authorization(
            db, authorization, code, principal=principal,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc
    return _redirect(status)


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


def _redirect(result: str) -> RedirectResponse:
    frontend_url = os.environ.get("FRONTEND_BASE_URL", "").rstrip("/")
    parsed = urlsplit(frontend_url)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or (parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1"))
    ):
        raise RuntimeError("Invalid frontend URL configuration")
    return RedirectResponse(
        url=f"{frontend_url}/#instagram_result={quote(result, safe='')}",
        status_code=303,
    )
