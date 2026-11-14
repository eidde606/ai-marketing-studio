"""Authenticated business endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import verify_token, get_authenticated_principal
from app.features.access.principal import AuthenticatedPrincipal
from app.errors import ApplicationError
from app.http_errors import http_error
from app.database import get_db
from . import service
from .schemas import BusinessCreate, BusinessUpdate

router = APIRouter(dependencies=[Depends(verify_token)])


@router.post("/businesses", status_code=201)
def create_business(
    request: BusinessCreate,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.create_business(request, db, principal=principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/businesses")
def list_businesses(
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.list_businesses(db, principal=principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.patch("/businesses/{business_id}")
def update_business(
    business_id: str,
    request: BusinessUpdate,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
):
    try:
        return service.update_business(business_id, request, db, principal=principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc
