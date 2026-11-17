"""HTTP endpoints; keep paths, authorization and response contracts unchanged."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import verify_token, get_authenticated_principal
from app.features.access.principal import AuthenticatedPrincipal
from app.errors import ApplicationError, ErrorKind
from app.http_errors import http_error
from app.database import get_db
from . import service
from .schemas import CampaignCreate, CampaignUpdate

_ERROR_STATUS = {
    service.CampaignErrorKind.NOT_FOUND: 404,
    service.CampaignErrorKind.INVALID_DATES: 422,
    service.CampaignErrorKind.ASSOCIATION_CONFLICT: 409,
}

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns",
    dependencies=[Depends(verify_token)],
)


@router.get("")
def list_campaigns(
    business_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.list_campaigns(business_id, db, principal=principal)
    except ApplicationError as exc:
        if exc.kind is ErrorKind.NOT_FOUND and exc.detail == "Business not found":
            raise HTTPException(404, "Negocio no encontrado.") from exc
        raise http_error(exc) from exc
    except service.CampaignError as exc:
        raise HTTPException(_ERROR_STATUS[exc.kind], exc.detail) from exc


@router.post("", status_code=201)
def create_campaign(
    business_id: str,
    request: CampaignCreate,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.create_campaign(business_id, request, db, principal=principal)
    except ApplicationError as exc:
        if exc.kind is ErrorKind.NOT_FOUND and exc.detail == "Business not found":
            raise HTTPException(404, "Negocio no encontrado.") from exc
        raise http_error(exc) from exc
    except service.CampaignError as exc:
        raise HTTPException(_ERROR_STATUS[exc.kind], exc.detail) from exc


@router.get("/{campaign_id}")
def get_campaign(
    business_id: str,
    campaign_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.get_campaign(business_id, campaign_id, db, principal=principal)
    except ApplicationError as exc:
        if exc.kind is ErrorKind.NOT_FOUND and exc.detail == "Business not found":
            raise HTTPException(404, "Negocio no encontrado.") from exc
        raise http_error(exc) from exc
    except service.CampaignError as exc:
        raise HTTPException(_ERROR_STATUS[exc.kind], exc.detail) from exc


@router.patch("/{campaign_id}")
def update_campaign(
    business_id: str,
    campaign_id: str,
    request: CampaignUpdate,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.update_campaign(business_id, campaign_id, request, db, principal=principal)
    except ApplicationError as exc:
        if exc.kind is ErrorKind.NOT_FOUND and exc.detail == "Business not found":
            raise HTTPException(404, "Negocio no encontrado.") from exc
        raise http_error(exc) from exc
    except service.CampaignError as exc:
        raise HTTPException(_ERROR_STATUS[exc.kind], exc.detail) from exc


@router.delete("/{campaign_id}")
def delete_campaign(
    business_id: str,
    campaign_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.delete_campaign(business_id, campaign_id, db, principal=principal)
    except ApplicationError as exc:
        if exc.kind is ErrorKind.NOT_FOUND and exc.detail == "Business not found":
            raise HTTPException(404, "Negocio no encontrado.") from exc
        raise http_error(exc) from exc
    except service.CampaignError as exc:
        raise HTTPException(_ERROR_STATUS[exc.kind], exc.detail) from exc


@router.patch("/{campaign_id}/drafts/{draft_id}")
def associate_draft(
    business_id: str,
    campaign_id: str,
    draft_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.change_association(db, business_id, campaign_id, draft_id, True, principal=principal)
    except ApplicationError as exc:
        if exc.kind is ErrorKind.NOT_FOUND and exc.detail == "Business not found":
            raise HTTPException(404, "Negocio no encontrado.") from exc
        raise http_error(exc) from exc
    except service.CampaignError as exc:
        raise HTTPException(_ERROR_STATUS[exc.kind], exc.detail) from exc


@router.delete("/{campaign_id}/drafts/{draft_id}")
def disassociate_draft(
    business_id: str,
    campaign_id: str,
    draft_id: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.change_association(db, business_id, campaign_id, draft_id, False, principal=principal)
    except ApplicationError as exc:
        if exc.kind is ErrorKind.NOT_FOUND and exc.detail == "Business not found":
            raise HTTPException(404, "Negocio no encontrado.") from exc
        raise http_error(exc) from exc
    except service.CampaignError as exc:
        raise HTTPException(_ERROR_STATUS[exc.kind], exc.detail) from exc
