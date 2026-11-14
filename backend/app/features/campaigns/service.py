"""Campaign rules, response calculations and transaction boundaries."""
from datetime import date, datetime, timezone
from enum import Enum

from sqlalchemy.orm import Session

from app.models import Campaign, Draft
from app.features.access.principal import AuthenticatedPrincipal
from app.features.access.permissions import Permission
from app.features.access.service import require_permission
from app.features.entitlements import service as entitlement_service
from app.transactions import Transactions, rollback_on_failure
from . import repository
from .schemas import (
    CampaignCreate,
    CampaignDraftResponse,
    CampaignResponse,
    CampaignUpdate,
)


class CampaignErrorKind(Enum):
    NOT_FOUND = "not_found"
    INVALID_DATES = "invalid_dates"
    ASSOCIATION_CONFLICT = "association_conflict"


class CampaignError(Exception):
    """An expected rejection; routes translate it into the existing HTTP response."""

    def __init__(self, kind: CampaignErrorKind, detail: str):
        super().__init__(detail)
        self.kind = kind
        self.detail = detail


def validate_dates(start_date: date | None, end_date: date | None) -> None:
    if start_date and end_date and end_date < start_date:
        raise CampaignError(CampaignErrorKind.INVALID_DATES, "La fecha final no puede ser anterior a la inicial.")


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


def _campaign(db, context, campaign_id):
    campaign = repository.find_campaign_scoped(db, context, campaign_id)
    if campaign is None:
        raise CampaignError(CampaignErrorKind.NOT_FOUND, "Campaña no encontrada para este negocio.")
    return campaign


def _lock_campaign(db, principal, business_id, campaign_id):
    context = require_permission(db, principal, business_id, Permission.MANAGE_CAMPAIGNS)
    campaign = repository.lock_campaign_scoped(db, context, campaign_id)
    context = require_permission(db, principal, business_id, Permission.MANAGE_CAMPAIGNS)
    if campaign is None:
        raise CampaignError(CampaignErrorKind.NOT_FOUND, "Campaña no encontrada para este negocio.")
    return context, campaign


def _response(db, principal, business_id, campaign_id):
    context = require_permission(db, principal, business_id, Permission.READ)
    return campaign_response(_campaign(db, context, campaign_id))


def list_campaigns(business_id: str, db: Session, *, principal: AuthenticatedPrincipal) -> list[CampaignResponse]:
    context = require_permission(db, principal, business_id, Permission.READ)
    result = []
    while True:
        page = repository.list_campaigns_scoped(db, context, limit=100, offset=len(result))
        result.extend(campaign_response(c) for c in page)
        if len(page) < 100:
            return result


@rollback_on_failure
def create_campaign(business_id: str, request: CampaignCreate, db: Session, *,
                    principal: AuthenticatedPrincipal) -> CampaignResponse:
    context = require_permission(db, principal, business_id, Permission.MANAGE_CAMPAIGNS)
    validate_dates(request.start_date, request.end_date)
    entitlement_service.require_campaign_capacity(db, business_id)
    campaign_id = repository.add_campaign_scoped(db, context, Campaign(business_id=business_id, **request.model_dump()))
    require_permission(db, principal, business_id, Permission.MANAGE_CAMPAIGNS)
    Transactions(db).commit()
    return _response(db, principal, business_id, campaign_id)


def get_campaign(business_id: str, campaign_id: str, db: Session, *, principal: AuthenticatedPrincipal) -> CampaignResponse:
    return _response(db, principal, business_id, campaign_id)


@rollback_on_failure
def update_campaign(business_id: str, campaign_id: str, request: CampaignUpdate, db: Session, *,
                    principal: AuthenticatedPrincipal) -> CampaignResponse:
    context, campaign = _lock_campaign(db, principal, business_id, campaign_id)
    changes = request.model_dump(exclude_unset=True)
    validate_dates(changes.get("start_date", campaign.start_date), changes.get("end_date", campaign.end_date))
    if changes:
        repository.update_campaign_scoped(db, context, campaign_id, changes)
    require_permission(db, principal, business_id, Permission.MANAGE_CAMPAIGNS)
    Transactions(db).commit()
    return _response(db, principal, business_id, campaign_id)


@rollback_on_failure
def delete_campaign(business_id: str, campaign_id: str, db: Session, *, principal: AuthenticatedPrincipal) -> dict[str, str]:
    context, _ = _lock_campaign(db, principal, business_id, campaign_id)
    # Parent first, then drafts in stable order; reauthorize after all lock waits.
    repository.lock_campaign_drafts_scoped(db, context, campaign_id)
    context = require_permission(db, principal, business_id, Permission.MANAGE_CAMPAIGNS)
    repository.delete_campaign_scoped(db, context, campaign_id)
    require_permission(db, principal, business_id, Permission.MANAGE_CAMPAIGNS)
    Transactions(db).commit()
    return {"message": "Campaña eliminada correctamente."}


@rollback_on_failure
def change_association(db: Session, business_id: str, campaign_id: str, draft_id: str, attach: bool, *,
                       principal: AuthenticatedPrincipal) -> CampaignResponse:
    context, campaign = _lock_campaign(db, principal, business_id, campaign_id)
    draft = repository.lock_association_draft_scoped(db, context, draft_id)
    context = require_permission(db, principal, business_id, Permission.MANAGE_CAMPAIGNS)
    if draft is None or (attach and draft.deleted_at is not None):
        raise CampaignError(CampaignErrorKind.NOT_FOUND, "Contenido no encontrado para este negocio.")
    if attach and draft.campaign_id not in (None, campaign.id):
        raise CampaignError(CampaignErrorKind.ASSOCIATION_CONFLICT, "Desvincula el contenido de su campaña actual antes de asociarlo.")
    if not attach and draft.campaign_id != campaign.id:
        raise CampaignError(CampaignErrorKind.NOT_FOUND, "El contenido no pertenece a esta campaña.")
    if not repository.change_association_scoped(db, context, campaign_id, draft_id, attach=attach):
        raise CampaignError(CampaignErrorKind.NOT_FOUND, "Contenido no encontrado para este negocio.")
    repository.update_campaign_scoped(db, context, campaign_id, {"updated_at": datetime.now(timezone.utc)})
    require_permission(db, principal, business_id, Permission.MANAGE_CAMPAIGNS)
    Transactions(db).commit()
    return _response(db, principal, business_id, campaign_id)
