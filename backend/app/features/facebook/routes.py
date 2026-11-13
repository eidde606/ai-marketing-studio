"""Facebook OAuth and Page-selection HTTP endpoints."""
import os
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth import get_authenticated_principal, verify_token
from app.features.access.principal import AuthenticatedPrincipal
from app.database import get_db
from app.errors import ApplicationError
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


@router.get("/start")
def start_facebook_connection(
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
async def facebook_callback(
    state: str = Query(...),
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        selection_token = await service.complete_callback(
            state,
            code,
            error,
            db=db,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc
    return redirect_to_dashboard(selection_token)


@router.post("/select-page")
def select_facebook_page(
    request: FacebookPageSelection,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.select_page(
            request.selection_token,
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
            principal,
            db=db,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


def redirect_to_dashboard(selection_token: str) -> RedirectResponse:
    """Return a temporary selection token in the frontend URL fragment."""
    frontend_url = os.environ["FRONTEND_BASE_URL"].rstrip("/")
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

    return RedirectResponse(
        url=f"{frontend_url}/#facebook_handoff={selection_token}",
        status_code=303,
    )
