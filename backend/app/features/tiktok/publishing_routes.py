"""Authenticated TikTok publishing and verification endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from app.errors import ApplicationError
from app.http_errors import http_error
from . import publishing_service
from .schemas import TikTokPublishRequest

router = APIRouter(dependencies=[Depends(verify_token)])


@router.get("/drafts/{draft_id}/tiktok-creator-info")
async def get_draft_tiktok_creator_info(
    draft_id: str,
    account_id: str,
    db: Session = Depends(get_db),
):
    try:
        return await publishing_service.get_creator_settings(
            draft_id,
            account_id,
            db=db,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/drafts/{draft_id}/publish-tiktok")
async def publish_draft_to_tiktok(
    draft_id: str,
    request: TikTokPublishRequest,
    db: Session = Depends(get_db),
):
    try:
        return await publishing_service.publish_video(
            draft_id,
            request,
            db=db,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/drafts/{draft_id}/verify-tiktok")
async def verify_tiktok_publication(
    draft_id: str,
    db: Session = Depends(get_db),
):
    try:
        return await publishing_service.verify_publication(draft_id, db=db)
    except ApplicationError as exc:
        raise http_error(exc) from exc
