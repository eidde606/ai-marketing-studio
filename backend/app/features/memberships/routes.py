from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from app.auth import get_authenticated_principal
from app.database import get_db
from app.errors import ApplicationError
from app.http_errors import http_error
from app.features.access.principal import AuthenticatedPrincipal
from . import service
from .schemas import MembershipUpdate

router = APIRouter(prefix="/businesses/{business_id}/memberships")


@router.get("")
def list_memberships(business_id: str, principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
                     db: Session = Depends(get_db)):
    try:
        return service.list_memberships(db, principal, business_id)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.patch("/{membership_id}", status_code=204)
def change_membership(business_id: str, membership_id: str, request: MembershipUpdate,
                      principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
                      db: Session = Depends(get_db)):
    try:
        service.change_membership(db, principal, business_id, membership_id,
                                  role=request.role, status=request.status)
        return Response(status_code=204)
    except ApplicationError as exc:
        raise http_error(exc) from exc
