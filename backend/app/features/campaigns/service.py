"""Campaign rules, response calculations and transaction boundaries."""
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.models import Campaign, Draft
from . import repository
from .schemas import (
    CampaignCreate,
    CampaignDraftResponse,
    CampaignResponse,
    CampaignUpdate,
)


class CampaignError(Exception):
    """An expected rejection; routes translate it into the existing HTTP response."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def require_business(db: Session, business_id: str) -> None:
    if repository.find_business(db, business_id) is None:
        raise CampaignError(404, "Negocio no encontrado.")


def require_campaign(db: Session, business_id: str, campaign_id: str) -> Campaign:
    campaign = repository.find_campaign(db, business_id, campaign_id)
    if campaign is None:
        raise CampaignError(404, "Campaña no encontrada para este negocio.")
    return campaign


def validate_dates(start_date: date | None, end_date: date | None) -> None:
    if start_date and end_date and end_date < start_date:
        raise CampaignError(422, "La fecha final no puede ser anterior a la inicial.")


def is_published(draft: Draft) -> bool:
    # A successful platform status AND its publication ID are required.
    # Approval, timestamps, downloads and copied captions are not evidence.
    return bool(
        (draft.facebook_publish_status == "published" and draft.facebook_post_id)
        or (draft.tiktok_publish_status == "published" and draft.tiktok_publish_id)
    )


def campaign_response(campaign: Campaign) -> CampaignResponse:
    contents: list[CampaignDraftResponse] = []
    for draft in campaign.drafts:
        if draft.business_id != campaign.business_id:
            continue
        published = is_published(draft)
        if draft.deleted_at is not None and not published:
            continue
        contents.append({
            "id": draft.id,
            "title": draft.title,
            "status": draft.status,
            "platform": draft.platform,
            "published": published,
            "deleted_at": draft.deleted_at,
        })
    contents.sort(key=lambda item: (item["title"].casefold(), item["id"]))
    total = len(contents)
    published_count = sum(item["published"] for item in contents)
    return {
        "id": campaign.id,
        "business_id": campaign.business_id,
        "name": campaign.name,
        "objective": campaign.objective,
        "status": campaign.status,
        "start_date": campaign.start_date,
        "end_date": campaign.end_date,
        "created_at": campaign.created_at,
        "updated_at": campaign.updated_at,
        "total_count": total,
        "published_count": published_count,
        "pending_count": total - published_count,
        "rejected_count": sum(item["status"] == "rejected" for item in contents),
        "progress": round(100 * published_count / total, 1) if total else 0,
        "drafts": contents,
    }


def list_campaigns(business_id: str, db: Session) -> list[CampaignResponse]:
    require_business(db, business_id)
    campaigns = repository.list_campaigns(db, business_id)
    return [campaign_response(campaign) for campaign in campaigns]


def create_campaign(
    business_id: str, request: CampaignCreate, db: Session,
) -> CampaignResponse:
    require_business(db, business_id)
    validate_dates(request.start_date, request.end_date)
    campaign = Campaign(business_id=business_id, **request.model_dump())
    repository.add_campaign(db, campaign)
    db.commit()
    db.refresh(campaign)
    return campaign_response(campaign)


def get_campaign(business_id: str, campaign_id: str, db: Session) -> CampaignResponse:
    return campaign_response(require_campaign(db, business_id, campaign_id))


def update_campaign(
    business_id: str, campaign_id: str, request: CampaignUpdate, db: Session,
) -> CampaignResponse:
    campaign = require_campaign(db, business_id, campaign_id)
    changes = request.model_dump(exclude_unset=True)
    validate_dates(
        changes.get("start_date", campaign.start_date),
        changes.get("end_date", campaign.end_date),
    )
    for key, value in changes.items():
        setattr(campaign, key, value)
    db.commit()
    db.refresh(campaign)
    return campaign_response(campaign)


def delete_campaign(business_id: str, campaign_id: str, db: Session) -> dict[str, str]:
    campaign = require_campaign(db, business_id, campaign_id)
    repository.delete_campaign(db, business_id, campaign)
    db.commit()
    return {"message": "Campaña eliminada correctamente."}


def change_association(
    db: Session, business_id: str, campaign_id: str, draft_id: str, attach: bool,
) -> CampaignResponse:
    campaign = require_campaign(db, business_id, campaign_id)
    # Serialize association changes with existing draft edits and soft deletion.
    draft = repository.lock_draft(db, business_id, draft_id)
    if draft is None or (attach and draft.deleted_at is not None):
        raise CampaignError(404, "Contenido no encontrado para este negocio.")
    if attach and draft.campaign_id not in (None, campaign.id):
        raise CampaignError(
            409, "Desvincula el contenido de su campaña actual antes de asociarlo.",
        )
    if not attach and draft.campaign_id != campaign.id:
        raise CampaignError(404, "El contenido no pertenece a esta campaña.")
    draft.campaign_id = campaign.id if attach else None
    campaign.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(campaign)
    return campaign_response(campaign)
