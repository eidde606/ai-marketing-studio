from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.auth import get_authenticated_principal, get_registration_identity
from app.database import get_db
from app.errors import ApplicationError
from app.http_errors import http_error
from app.features.access.principal import Principal, AuthenticatedPrincipal
from app.features.entitlements import service as entitlement_service
from . import service
from .schemas import (RegistrationRequest, AccountPreferencesUpdate, BusinessPreferencesUpdate,
                      AccountResponse, AccountPreferences)

router = APIRouter()


@router.get("/public/config")
def public_config():
    return {"public_registration": entitlement_service.public_registration_enabled()}


@router.post("/account/register", response_model=AccountResponse)
def register(request: RegistrationRequest, identity: Principal = Depends(get_registration_identity),
             db: Session = Depends(get_db)):
    try:
        return service.register(db, identity)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/account", response_model=AccountResponse)
def account(principal: AuthenticatedPrincipal = Depends(get_authenticated_principal), db: Session = Depends(get_db)):
    try:
        return service.account(db, principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.patch("/account/preferences", response_model=AccountPreferences)
def update_preferences(request: AccountPreferencesUpdate,
                       principal: AuthenticatedPrincipal = Depends(get_authenticated_principal), db: Session = Depends(get_db)):
    try:
        return service.update_preferences(db, principal, request)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/businesses/{business_id}/preferences", response_model=BusinessPreferencesUpdate)
def business_preferences(business_id: str, principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
                         db: Session = Depends(get_db)):
    try:
        return service.business_preferences(db, principal, business_id)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.patch("/businesses/{business_id}/preferences", response_model=BusinessPreferencesUpdate)
def update_business_preferences(business_id: str, request: BusinessPreferencesUpdate,
                                principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
                                db: Session = Depends(get_db)):
    try:
        return service.update_business_preferences(db, principal, business_id, request.marketing_content_language)
    except ApplicationError as exc:
        raise http_error(exc) from exc
