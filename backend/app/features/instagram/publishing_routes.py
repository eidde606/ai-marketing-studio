"""Authenticated Instagram image publication endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_authenticated_principal, verify_token
from app.database import get_db
from app.errors import ApplicationError
from app.features.access.principal import AuthenticatedPrincipal
from app.http_errors import http_error
from . import publishing_service

router = APIRouter(dependencies=[Depends(verify_token)])


@router.post("/drafts/{draft_id}/publish-instagram")
async def publish_draft_to_instagram(
    draft_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return await publishing_service.publish_image(
            draft_id,
            db=db,
            principal=principal,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc
