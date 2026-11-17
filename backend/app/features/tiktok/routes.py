"""TikTok OAuth HTTP endpoints."""
import os

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from urllib.parse import urlsplit
from sqlalchemy.orm import Session

from app.auth import get_authenticated_principal
from app.database import get_db
from app.errors import ApplicationError, ErrorKind
from app.features.access.principal import AuthenticatedPrincipal
from app.http_errors import http_error
from . import service

router = APIRouter(
    prefix="/api/integrations/tiktok",
    tags=["TikTok OAuth"],
)


@router.get("/start")
def start_tiktok_connection(
    business_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        authorization_url = service.start_connection(
            business_id,
            principal,
            db=db,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc
    return {"authorization_url": authorization_url}


@router.get("/callback")
async def tiktok_callback(
    state: str,
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        await service.complete_authorization(
            state,
            code,
            error,
            db=db,
        )
    except ApplicationError as exc:
        result = (
            "invalid_state"
            if "Invalid, expired, or previously used" in exc.detail
            else "authorization_declined"
            if exc.kind.value == "invalid_input"
            else "provider_error"
        )
    else:
        result = "connected"

    try:
        return _redirect_to_frontend(result)
    except RuntimeError as exc:
        raise http_error(
            ApplicationError(
                ErrorKind.UNAVAILABLE,
                "TikTok callback redirect is not configured",
            )
        ) from exc


@router.get("/accounts")
def get_tiktok_accounts(
    business_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.list_accounts(business_id, db=db, principal=principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.delete("/accounts/{account_id}")
def disconnect_tiktok_account(
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


def _redirect_to_frontend(result: str) -> RedirectResponse:
    frontend_url = os.getenv(
        "TIKTOK_FRONTEND_REDIRECT_URL",
        os.getenv("FRONTEND_BASE_URL", ""),
    ).rstrip("/")
    parsed = urlsplit(frontend_url)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or (
            parsed.scheme == "http"
            and parsed.hostname not in ("localhost", "127.0.0.1")
        )
    ):
        raise RuntimeError("Invalid frontend URL configuration")
    return RedirectResponse(
        url=f"{frontend_url}/#tiktok_result={result}",
        status_code=303,
    )
