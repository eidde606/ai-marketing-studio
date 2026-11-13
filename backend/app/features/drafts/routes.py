"""Authenticated draft lifecycle endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from . import service
from .schemas import DraftCreate, DraftDestinationsUpdate, DraftUpdate

router = APIRouter(dependencies=[Depends(verify_token)])

_ERROR_RESPONSES = {
    service.DraftErrorKind.NOT_FOUND: (404, "Draft not found"),
    service.DraftErrorKind.BUSINESS_NOT_FOUND: (404, "Business not found"),
    service.DraftErrorKind.NOT_PENDING: (409, "Only pending drafts can be edited"),
    service.DraftErrorKind.DELETE_IN_PROGRESS: (
        409,
        "Espera a que termine la operación en curso antes de eliminar.",
    ),
    service.DraftErrorKind.DUPLICATE_DESTINATIONS: (
        422,
        "Duplicate destinations are not allowed",
    ),
    service.DraftErrorKind.TIKTOK_MEDIA_REQUIRED: (
        409,
        "TikTok requires an image or video",
    ),
    service.DraftErrorKind.SOCIAL_ACCOUNTS_NOT_CONNECTED: (
        409,
        "Connect the selected social accounts first",
    ),
    service.DraftErrorKind.VIDEO_NOT_READY: (
        409,
        "Video must be completed before approval",
    ),
}


def draft_http_exception(error: service.DraftError) -> HTTPException:
    status_code, detail = _ERROR_RESPONSES[error.kind]
    return HTTPException(status_code=status_code, detail=detail)


@router.post("/drafts", status_code=201)
def create_draft(request: DraftCreate, db: Session = Depends(get_db)):
    try:
        return service.create_draft(request, db)
    except service.DraftError as exc:
        raise draft_http_exception(exc) from exc


@router.get("/drafts")
def list_drafts(
    business_id: str,
    include_deleted_published: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return service.list_drafts(business_id, include_deleted_published, db)
    except service.DraftError as exc:
        raise draft_http_exception(exc) from exc


@router.delete("/drafts/{draft_id}")
def delete_draft(draft_id: str, db: Session = Depends(get_db)):
    try:
        return service.delete_draft(draft_id, db)
    except service.DraftError as exc:
        raise draft_http_exception(exc) from exc


@router.patch("/drafts/{draft_id}/destinations")
def update_draft_destinations(
    draft_id: str,
    request: DraftDestinationsUpdate,
    db: Session = Depends(get_db),
):
    try:
        return service.update_draft_destinations(draft_id, request, db)
    except service.DraftError as exc:
        raise draft_http_exception(exc) from exc


@router.patch("/drafts/{draft_id}/approve")
def approve_draft(draft_id: str, db: Session = Depends(get_db)):
    try:
        return service.approve_draft(draft_id, db)
    except service.DraftError as exc:
        raise draft_http_exception(exc) from exc


@router.patch("/drafts/{draft_id}")
def update_draft(
    draft_id: str,
    request: DraftUpdate,
    db: Session = Depends(get_db),
):
    try:
        return service.update_draft(draft_id, request, db)
    except service.DraftError as exc:
        raise draft_http_exception(exc) from exc


@router.patch("/drafts/{draft_id}/reject")
def reject_draft(draft_id: str, db: Session = Depends(get_db)):
    try:
        return service.reject_draft(draft_id, db)
    except service.DraftError as exc:
        raise draft_http_exception(exc) from exc
