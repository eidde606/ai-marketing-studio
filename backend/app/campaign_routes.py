"""Business-scoped campaign management; publishing remains in the draft workflow."""
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import verify_token
from app.database import get_db
from app.models import Business, Campaign, Draft

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns",
    dependencies=[Depends(verify_token)],
)
CampaignStatus = Literal["draft", "active", "paused", "completed", "archived"]


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    objective: str = Field(min_length=1, max_length=2000)
    status: CampaignStatus = "draft"
    start_date: date | None = None
    end_date: date | None = None

    @field_validator("name", "objective", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class CampaignUpdate(CampaignCreate):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    objective: str | None = Field(default=None, min_length=1, max_length=2000)
    status: CampaignStatus | None = None

    @field_validator("name", "objective", "status")
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError("Este campo no puede ser nulo.")
        return value


def require_business(db: Session, business_id: str) -> None:
    if db.get(Business, business_id) is None:
        raise HTTPException(404, "Negocio no encontrado.")


def require_campaign(db: Session, business_id: str, campaign_id: str) -> Campaign:
    campaign = db.scalar(select(Campaign).where(
        Campaign.id == campaign_id, Campaign.business_id == business_id,
    ))
    if campaign is None:
        raise HTTPException(404, "Campaña no encontrada para este negocio.")
    return campaign


def validate_dates(start_date: date | None, end_date: date | None) -> None:
    if start_date and end_date and end_date < start_date:
        raise HTTPException(422, "La fecha final no puede ser anterior a la inicial.")


def is_published(draft: Draft) -> bool:
    # A successful platform status AND its publication ID are required.
    # Approval, timestamps, downloads and copied captions are not evidence.
    return bool(
        (draft.facebook_publish_status == "published" and draft.facebook_post_id)
        or (draft.tiktok_publish_status == "published" and draft.tiktok_publish_id)
    )


def campaign_response(campaign: Campaign) -> dict:
    contents = []
    for draft in campaign.drafts:
        if draft.business_id != campaign.business_id:
            continue
        published = is_published(draft)
        if draft.deleted_at is not None and not published:
            continue
        contents.append({
            "id": draft.id, "title": draft.title, "status": draft.status,
            "platform": draft.platform, "published": published,
            "deleted_at": draft.deleted_at,
        })
    contents.sort(key=lambda item: (item["title"].casefold(), item["id"]))
    total = len(contents)
    published_count = sum(item["published"] for item in contents)
    return {
        "id": campaign.id, "business_id": campaign.business_id,
        "name": campaign.name, "objective": campaign.objective,
        "status": campaign.status, "start_date": campaign.start_date,
        "end_date": campaign.end_date, "created_at": campaign.created_at,
        "updated_at": campaign.updated_at,
        "total_count": total, "published_count": published_count,
        "pending_count": total - published_count,
        "rejected_count": sum(item["status"] == "rejected" for item in contents),
        "progress": round(100 * published_count / total, 1) if total else 0,
        "drafts": contents,
    }


@router.get("")
def list_campaigns(business_id: str, db: Session = Depends(get_db)):
    require_business(db, business_id)
    campaigns = db.scalars(select(Campaign).where(
        Campaign.business_id == business_id,
    ).options(selectinload(Campaign.drafts)).order_by(Campaign.created_at.desc(), Campaign.id)).all()
    return [campaign_response(campaign) for campaign in campaigns]


@router.post("", status_code=201)
def create_campaign(business_id: str, request: CampaignCreate, db: Session = Depends(get_db)):
    require_business(db, business_id)
    validate_dates(request.start_date, request.end_date)
    campaign = Campaign(business_id=business_id, **request.model_dump())
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign_response(campaign)


@router.get("/{campaign_id}")
def get_campaign(business_id: str, campaign_id: str, db: Session = Depends(get_db)):
    return campaign_response(require_campaign(db, business_id, campaign_id))


@router.patch("/{campaign_id}")
def update_campaign(business_id: str, campaign_id: str, request: CampaignUpdate, db: Session = Depends(get_db)):
    campaign = require_campaign(db, business_id, campaign_id)
    changes = request.model_dump(exclude_unset=True)
    validate_dates(changes.get("start_date", campaign.start_date), changes.get("end_date", campaign.end_date))
    for key, value in changes.items():
        setattr(campaign, key, value)
    db.commit()
    db.refresh(campaign)
    return campaign_response(campaign)


def change_association(db: Session, business_id: str, campaign_id: str, draft_id: str, attach: bool):
    campaign = require_campaign(db, business_id, campaign_id)
    # Serialize association changes with existing draft edits and soft deletion.
    draft = db.scalar(select(Draft).where(
        Draft.id == draft_id, Draft.business_id == business_id,
    ).with_for_update())
    if draft is None or (attach and draft.deleted_at is not None):
        raise HTTPException(404, "Contenido no encontrado para este negocio.")
    if attach and draft.campaign_id not in (None, campaign.id):
        raise HTTPException(409, "Desvincula el contenido de su campaña actual antes de asociarlo.")
    if not attach and draft.campaign_id != campaign.id:
        raise HTTPException(404, "El contenido no pertenece a esta campaña.")
    draft.campaign_id = campaign.id if attach else None
    campaign.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(campaign)
    return campaign_response(campaign)


@router.patch("/{campaign_id}/drafts/{draft_id}")
def associate_draft(business_id: str, campaign_id: str, draft_id: str, db: Session = Depends(get_db)):
    return change_association(db, business_id, campaign_id, draft_id, True)


@router.delete("/{campaign_id}/drafts/{draft_id}")
def disassociate_draft(business_id: str, campaign_id: str, draft_id: str, db: Session = Depends(get_db)):
    return change_association(db, business_id, campaign_id, draft_id, False)
