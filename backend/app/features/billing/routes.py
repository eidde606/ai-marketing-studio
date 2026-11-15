"""Stripe Billing HTTP boundaries."""
from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import ApplicationError, ErrorKind
from app.features.access.principal import AuthenticatedPrincipal
from app.auth import get_authenticated_principal
from app.http_errors import http_error
from . import service
from .schemas import BillingOverview, HostedSession, WebhookResult

router = APIRouter()


@router.get(
    "/businesses/{business_id}/billing",
    response_model=BillingOverview,
)
def get_billing(
    business_id: str,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.overview(db, principal, business_id)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post(
    "/businesses/{business_id}/billing/checkout",
    response_model=HostedSession,
)
def create_checkout(
    business_id: str,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return {"url": service.create_checkout(db, principal, business_id)}
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post(
    "/businesses/{business_id}/billing/portal",
    response_model=HostedSession,
)
def create_portal(
    business_id: str,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return {"url": service.create_portal(db, principal, business_id)}
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/webhooks/stripe", response_model=WebhookResult)
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
    db: Session = Depends(get_db),
):
    try:
        raw_body = await request.body()
        if len(raw_body) > 1_048_576:
            raise ApplicationError(
                ErrorKind.TOO_LARGE,
                "Stripe event is too large",
            )
        return service.process_webhook(db, raw_body, stripe_signature)
    except ApplicationError as exc:
        raise http_error(exc) from exc
