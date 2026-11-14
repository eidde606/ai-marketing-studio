"""Onboarding API boundaries."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import verify_token, get_authenticated_principal
from app.database import get_db
from app.errors import ApplicationError
from app.features.access.principal import AuthenticatedPrincipal
from app.http_errors import http_error
from . import service
from .schemas import OnboardingActivation, OnboardingUpdate, TutorialUpdate

router = APIRouter(dependencies=[Depends(verify_token)])


@router.get("/account/onboarding")
def get_onboarding(
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.get_progress(db, principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.put("/account/onboarding")
def save_onboarding(
    request: OnboardingUpdate,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.save_progress(db, principal, request)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/account/onboarding/activate", status_code=201)
def activate_onboarding(
    request: OnboardingActivation,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.activate_workspace(db, principal, request)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.patch("/account/onboarding/tutorial")
def update_tutorial(
    request: TutorialUpdate,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.update_tutorial_status(db, principal, request.completed)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/businesses/{business_id}/entitlement")
def get_entitlement(
    business_id: str,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.entitlement_status(db, principal, business_id)
    except ApplicationError as exc:
        raise http_error(exc) from exc
