"""Authenticated Facebook analytics endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_authenticated_principal
from app.database import get_db
from app.errors import ApplicationError
from app.features.access.principal import AuthenticatedPrincipal
from app.http_errors import http_error
from . import service

router = APIRouter()


@router.get("/drafts/{draft_id}/analytics/facebook")
async def get_facebook_draft_analytics(
    draft_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return await service.facebook_post_analytics(
            draft_id, db=db, principal=principal,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/drafts/{draft_id}/analytics/facebook/reach")
async def get_facebook_draft_reach(
    draft_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return await service.facebook_post_reach(
            draft_id, db=db, principal=principal,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc
