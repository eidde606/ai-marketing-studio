"""Tenant-authorized Checkout/Portal and signature-verified Stripe webhooks."""
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
import time

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from app.features.entitlements import repository as entitlement_repository
from app.features.entitlements import service as entitlement_service
from app.transactions import Transactions
from . import stripe_gateway

_SIGNATURE_TOLERANCE_SECONDS = 300


def overview(db: Session, principal: AuthenticatedPrincipal, business_id: str) -> dict:
    context = access.require_permission(db, principal, business_id, Permission.READ)
    entitlement = entitlement_repository.entitlement_for_business(db, business_id)
    manageable = (
        context.role in {"owner", "admin"}
        and not entitlement_service.is_operator(principal)
    )
    if entitlement is None:
        return {
            "status": "unavailable",
            "provider_status": None,
            "trial_started_at": None,
            "trial_expires_at": None,
            "days_remaining": None,
            "current_period_end": None,
            "cancel_at_period_end": False,
            "usage": None,
            **stripe_gateway.monthly_plan_details(),
            "checkout_available": False,
            "portal_available": False,
            "can_manage": False,
        }

    usage = entitlement_service.usage_for_business(
        db, business_id, context=context,
    ) or {}
    portal_ready = (
        manageable
        and stripe_gateway.checkout_available()
        and bool(entitlement.stripe_customer_id)
    )
    return {
        "status": usage.get("status", "unavailable"),
        "provider_status": entitlement.payment_provider_status,
        "trial_started_at": entitlement.trial_started_at,
        "trial_expires_at": entitlement.trial_expires_at,
        "days_remaining": usage.get("days_remaining"),
        "current_period_end": entitlement.current_period_end,
        "cancel_at_period_end": entitlement.cancel_at_period_end,
        "usage": usage.get("usage"),
        **stripe_gateway.monthly_plan_details(),
        "checkout_available": (
            manageable
            and stripe_gateway.checkout_available()
            and (
                not entitlement.stripe_subscription_id
                or entitlement.payment_provider_status in {
                    "canceled", "incomplete_expired",
                }
            )
        ),
        "portal_available": portal_ready,
        "can_manage": manageable,
    }


def create_checkout(
    db: Session,
    principal: AuthenticatedPrincipal,
    business_id: str,
) -> str:
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_BILLING,
    )
    organization = entitlement_repository.organization_for_business(db, business_id)
    entitlement = entitlement_repository.entitlement_for_business(db, business_id)
    if organization is None or entitlement is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Customer subscription was not found")
    if (
        entitlement.stripe_subscription_id
        and entitlement.payment_provider_status not in {
            "canceled", "incomplete_expired",
        }
    ):
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "Manage the existing subscription in the billing portal",
        )
    result = stripe_gateway.create_checkout_session(
        organization_id=organization.id,
        business_id=business_id,
        customer_id=entitlement.stripe_customer_id,
    )
    url = stripe_gateway.hosted_session_url(
        result, expected_host="checkout.stripe.com",
    )
    _recheck_billing_permission(db, principal, business_id, context.business_id)
    Transactions(db).commit()
    return url


def create_portal(
    db: Session,
    principal: AuthenticatedPrincipal,
    business_id: str,
) -> str:
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_BILLING,
    )
    entitlement = entitlement_repository.entitlement_for_business(db, business_id)
    if entitlement is None or not entitlement.stripe_customer_id:
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "A Stripe customer is not available for this workspace",
        )
    result = stripe_gateway.create_portal_session(
        customer_id=entitlement.stripe_customer_id,
    )
    url = stripe_gateway.hosted_session_url(
        result, expected_host="billing.stripe.com",
    )
    _recheck_billing_permission(db, principal, business_id, context.business_id)
    Transactions(db).commit()
    return url


def _recheck_billing_permission(
    db: Session,
    principal: AuthenticatedPrincipal,
    business_id: str,
    authorized_business_id: str,
) -> None:
    if business_id != authorized_business_id:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
    access.require_permission(
        db, principal, business_id, Permission.MANAGE_BILLING, lock=True,
    )


def process_webhook(db: Session, raw_body: bytes, signature: str | None) -> dict:
    event = _verified_event(raw_body, signature)
    event_id = event.get("id")
    event_type = event.get("type")
    if not isinstance(event_id, str) or not isinstance(event_type, str):
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Invalid Stripe event")
    data = event.get("data")
    obj = data.get("object") if isinstance(data, dict) else None
    if not isinstance(obj, dict):
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Invalid Stripe event")

    try:
        with db.begin_nested():
            entitlement_repository.record_stripe_event(db, event_id, event_type)
    except IntegrityError:
        return {"received": True, "duplicate": True, "processed": False}

    processed = False
    event_created_at = _stripe_time(event.get("created"))
    if event_type == "checkout.session.completed":
        processed = _checkout_completed(db, obj)
    elif event_type in {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }:
        processed = _subscription_changed(db, event_type, obj, event_created_at)
    elif event_type == "invoice.payment_failed":
        processed = _payment_failed(db, obj, event_created_at)
    Transactions(db).commit()
    return {"received": True, "duplicate": False, "processed": processed}


def _verified_event(raw_body: bytes, signature: str | None) -> dict:
    secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Stripe webhook verification is not configured",
        )
    if not signature:
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Invalid Stripe webhook signature")

    fields: dict[str, list[str]] = {}
    for pair in signature.split(","):
        name, separator, value = pair.partition("=")
        if separator:
            fields.setdefault(name.strip(), []).append(value.strip())
    try:
        timestamp = int(fields.get("t", [""])[0])
    except ValueError:
        timestamp = 0
    now = int(time.time())
    if not timestamp or abs(now - timestamp) > _SIGNATURE_TOLERANCE_SECONDS:
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Invalid Stripe webhook signature")
    signed_payload = str(timestamp).encode() + b"." + raw_body
    expected = hmac.new(
        secret.encode(), signed_payload, hashlib.sha256,
    ).hexdigest()
    if not any(
        hmac.compare_digest(expected, candidate)
        for candidate in fields.get("v1", [])
    ):
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Invalid Stripe webhook signature")
    try:
        event = json.loads(raw_body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Invalid Stripe event") from exc
    if not isinstance(event, dict):
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Invalid Stripe event")
    if event.get("livemode") is not False:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Only Stripe test-mode events are accepted",
        )
    return event


def _checkout_completed(db: Session, session: dict) -> bool:
    if session.get("mode") != "subscription":
        return False
    organization_id = session.get("client_reference_id")
    metadata = session.get("metadata")
    metadata_organization_id = (
        metadata.get("organization_id") if isinstance(metadata, dict) else None
    )
    if (
        organization_id
        and metadata_organization_id
        and organization_id != metadata_organization_id
    ):
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "Stripe checkout organization identifiers do not match",
        )
    if not isinstance(organization_id, str) and isinstance(metadata, dict):
        organization_id = metadata_organization_id
    customer_id = _stripe_id(session.get("customer"))
    subscription_id = _stripe_id(session.get("subscription"))
    entitlement = _resolve_entitlement(
        db, organization_id=organization_id, customer_id=customer_id,
        subscription_id=subscription_id,
        business_id=metadata.get("business_id") if isinstance(metadata, dict) else None,
    )
    if entitlement is None:
        return False
    if customer_id:
        entitlement.stripe_customer_id = customer_id
    if subscription_id:
        entitlement.stripe_subscription_id = subscription_id
    return True


def _subscription_changed(
    db: Session,
    event_type: str,
    subscription: dict,
    event_created_at: datetime | None,
) -> bool:
    subscription_id = _stripe_id(subscription.get("id"))
    customer_id = _stripe_id(subscription.get("customer"))
    if not subscription_id or not customer_id:
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Invalid Stripe subscription")
    metadata = subscription.get("metadata")
    organization_id = metadata.get("organization_id") if isinstance(metadata, dict) else None
    business_id = metadata.get("business_id") if isinstance(metadata, dict) else None
    entitlement = _resolve_entitlement(
        db, organization_id=organization_id, customer_id=customer_id,
        subscription_id=subscription_id, business_id=business_id,
        allow_new_subscription=event_type == "customer.subscription.created",
    )
    if entitlement is None:
        return False
    if _is_stale_event(entitlement, event_created_at):
        return False
    price_id = _subscription_price_id(subscription)
    if price_id != stripe_gateway.monthly_price_id():
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "Stripe subscription does not match the configured monthly plan",
        )

    status = str(subscription.get("status", ""))
    if entitlement.status == "active" and status in {"incomplete", "trialing"}:
        return False
    trial_still_active = (
        entitlement.status == "trialing"
        and entitlement_service.effective_status(entitlement) == "trialing"
    )
    if event_type == "customer.subscription.deleted":
        entitlement.status = "trialing" if trial_still_active else "canceled"
        entitlement.cancel_at_period_end = False
    elif status == "active":
        entitlement.status = "active"
        entitlement.cancel_at_period_end = bool(subscription.get("cancel_at_period_end"))
    elif status == "canceled":
        entitlement.status = "trialing" if trial_still_active else "canceled"
        entitlement.cancel_at_period_end = bool(subscription.get("cancel_at_period_end"))
    elif status == "incomplete_expired":
        entitlement.status = "trialing" if trial_still_active else "canceled"
        entitlement.cancel_at_period_end = False
    elif status in {"incomplete", "trialing"} and trial_still_active:
        entitlement.status = "trialing"
        entitlement.cancel_at_period_end = bool(subscription.get("cancel_at_period_end"))
    else:
        entitlement.status = "past_due"
        entitlement.cancel_at_period_end = bool(subscription.get("cancel_at_period_end"))

    entitlement.payment_provider_status = status or "unknown"
    entitlement.stripe_customer_id = customer_id
    entitlement.stripe_subscription_id = subscription_id
    entitlement.stripe_price_id = price_id
    if entitlement.status != "trialing":
        entitlement.limits = entitlement_service.monthly_subscription_limits()
    period_start = _stripe_time(subscription.get("current_period_start"))
    period_end = _stripe_time(subscription.get("current_period_end"))
    if status == "active" and period_end is None:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Active Stripe subscriptions must include a billing period end",
        )
    if period_start is not None:
        entitlement.current_period_start = period_start
    if period_end is not None:
        entitlement.current_period_end = period_end
    if event_type == "customer.subscription.deleted":
        now = datetime.now(timezone.utc)
        if entitlement.current_period_end is None or entitlement.current_period_end > now:
            entitlement.current_period_end = now
    _advance_event_time(entitlement, event_created_at)
    return True


def _payment_failed(
    db: Session,
    invoice: dict,
    event_created_at: datetime | None,
) -> bool:
    subscription_id = _stripe_id(invoice.get("subscription"))
    parent = invoice.get("parent")
    if subscription_id is None and isinstance(parent, dict):
        details = parent.get("subscription_details")
        if isinstance(details, dict):
            subscription_id = _stripe_id(details.get("subscription"))
    customer_id = _stripe_id(invoice.get("customer"))
    entitlement = _resolve_entitlement(
        db, customer_id=customer_id, subscription_id=subscription_id,
    )
    if entitlement is None:
        return False
    if _is_stale_event(entitlement, event_created_at):
        return False
    if not (
        entitlement.status == "trialing"
        and entitlement_service.effective_status(entitlement) == "trialing"
    ):
        entitlement.status = "past_due"
    entitlement.payment_provider_status = "past_due"
    _advance_event_time(entitlement, event_created_at)
    return True


def _is_stale_event(entitlement, event_created_at: datetime | None) -> bool:
    last_event = entitlement.stripe_event_created_at
    if event_created_at is None or last_event is None:
        return False
    if last_event.tzinfo is None:
        last_event = last_event.replace(tzinfo=timezone.utc)
    return event_created_at < last_event


def _advance_event_time(entitlement, event_created_at: datetime | None) -> None:
    if event_created_at is not None:
        entitlement.stripe_event_created_at = event_created_at


def _resolve_entitlement(
    db: Session,
    *,
    organization_id: str | None = None,
    customer_id: str | None = None,
    subscription_id: str | None = None,
    business_id: str | None = None,
    allow_new_subscription: bool = False,
):
    by_organization = (
        entitlement_repository.entitlement_for_organization(
            db, organization_id, lock=True,
        )
        if organization_id else None
    )
    by_customer = (
        entitlement_repository.entitlement_by_stripe_customer(
            db, customer_id, lock=True,
        )
        if customer_id else None
    )
    by_subscription = (
        entitlement_repository.entitlement_by_stripe_subscription(
            db, subscription_id, lock=True,
        )
        if subscription_id else None
    )
    matches = {
        entitlement.id
        for entitlement in (by_organization, by_customer, by_subscription)
        if entitlement is not None
    }
    if len(matches) > 1:
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "Stripe identifiers do not belong to one customer organization",
        )
    entitlement = by_organization or by_customer or by_subscription
    if entitlement is None:
        return None
    if customer_id and entitlement.stripe_customer_id not in {None, customer_id}:
        raise ApplicationError(ErrorKind.CONFLICT, "Stripe customer tenant mismatch")
    if subscription_id and entitlement.stripe_subscription_id not in {None, subscription_id}:
        if by_subscription is None and by_customer is entitlement:
            if (
                allow_new_subscription
                and entitlement.payment_provider_status in {
                    "canceled", "incomplete_expired",
                }
            ):
                pass
            else:
                return None
        else:
            raise ApplicationError(ErrorKind.CONFLICT, "Stripe subscription tenant mismatch")
    if business_id:
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        if organization is None or organization.id != entitlement.organization_id:
            raise ApplicationError(ErrorKind.CONFLICT, "Stripe business tenant mismatch")
    return entitlement


def _stripe_time(value) -> datetime | None:
    if type(value) not in {int, float}:
        return None
    try:
        return datetime.fromtimestamp(value, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Invalid Stripe subscription period") from None


def _stripe_id(value) -> str | None:
    if isinstance(value, dict):
        value = value.get("id")
    return value if isinstance(value, str) and value else None


def _subscription_price_id(subscription: dict) -> str | None:
    items = subscription.get("items")
    data = items.get("data") if isinstance(items, dict) else None
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        return None
    price = data[0].get("price")
    return _stripe_id(price)
