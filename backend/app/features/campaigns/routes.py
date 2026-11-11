"""HTTP endpoints; keep paths, authorization and response contracts unchanged."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from . import service
from .schemas import CampaignCreate, CampaignUpdate

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns",
    dependencies=[Depends(verify_token)],
)


@router.get("")
def list_campaigns(business_id: str, db: Session = Depends(get_db)):
    try:
        return service.list_campaigns(business_id, db)
    except service.CampaignError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.post("", status_code=201)
def create_campaign(
    business_id: str, request: CampaignCreate, db: Session = Depends(get_db),
):
    try:
        return service.create_campaign(business_id, request, db)
    except service.CampaignError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/{campaign_id}")
def get_campaign(business_id: str, campaign_id: str, db: Session = Depends(get_db)):
    try:
        return service.get_campaign(business_id, campaign_id, db)
    except service.CampaignError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.patch("/{campaign_id}")
def update_campaign(
    business_id: str, campaign_id: str, request: CampaignUpdate,
    db: Session = Depends(get_db),
):
    try:
        return service.update_campaign(business_id, campaign_id, request, db)
    except service.CampaignError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.delete("/{campaign_id}")
def delete_campaign(business_id: str, campaign_id: str, db: Session = Depends(get_db)):
    try:
        return service.delete_campaign(business_id, campaign_id, db)
    except service.CampaignError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.patch("/{campaign_id}/drafts/{draft_id}")
def associate_draft(
    business_id: str, campaign_id: str, draft_id: str, db: Session = Depends(get_db),
):
    try:
        return service.change_association(db, business_id, campaign_id, draft_id, True)
    except service.CampaignError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.delete("/{campaign_id}/drafts/{draft_id}")
def disassociate_draft(
    business_id: str, campaign_id: str, draft_id: str, db: Session = Depends(get_db),
):
    try:
        return service.change_association(db, business_id, campaign_id, draft_id, False)
    except service.CampaignError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
