"""TikTok OAuth HTTP endpoints."""
import os

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth import get_authenticated_principal
from app.database import get_db
from app.errors import ApplicationError
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
        raise http_error(exc) from exc

    frontend_url = os.environ["TIKTOK_FRONTEND_REDIRECT_URL"].rstrip("/")
    if not frontend_url.startswith("https://"):
        raise RuntimeError("Frontend URL must use HTTPS")

    return RedirectResponse(
        url=f"{frontend_url}/#tiktok_connected=1",
        status_code=303,
    )


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
