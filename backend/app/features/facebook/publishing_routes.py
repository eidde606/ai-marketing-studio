"""Authenticated Facebook draft publication and verification endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from app.errors import ApplicationError, ErrorKind
from app.http_errors import http_error
from . import publishing_service
from .schemas import FacebookRecoveryRequest

router = APIRouter(dependencies=[Depends(verify_token)])


@router.post("/drafts/{draft_id}/publish-facebook")
async def publish_draft_to_facebook(
    draft_id: str,
    db: Session = Depends(get_db),
):
    try:
        return await publishing_service.publish_draft(draft_id, db=db)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/drafts/{draft_id}/verify-facebook-video")
async def verify_facebook_video(
    draft_id: str,
    db: Session = Depends(get_db),
):
    try:
        return await publishing_service.verify_video(draft_id, db=db)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/drafts/{draft_id}/reset-facebook-publishing")
def reset_facebook_publishing(
    draft_id: str,
    request: FacebookRecoveryRequest,
    db: Session = Depends(get_db),
):
    if not request.confirmed_not_published:
        raise http_error(
            ApplicationError(
                ErrorKind.INVALID_INPUT,
                "Confirm the post is absent on Facebook",
            )
        )
    try:
        return publishing_service.reset_publication(draft_id, db=db)
    except ApplicationError as exc:
        raise http_error(exc) from exc
