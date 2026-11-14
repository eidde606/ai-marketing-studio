"""Trial lifecycle, effective access, and concurrency-safe usage policy."""
from datetime import datetime, timedelta, timezone
from math import ceil
import json
import os

from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access.principal import AuthenticatedPrincipal
from app.features.access.permissions import Permission
from app.models import CustomerEntitlement
from app.transactions import Transactions
from . import repository

_TRIAL_LIMIT_DEFAULTS = {
    "businesses": 1,
    "leo_generations": 20,
    "sofia_requests": 0,
    "campaigns": 2,
    "heygen_generations": 0,
}
_USAGE_LIMITS = {
    "leo_generation": "leo_generations",
    "sofia_request": "sofia_requests",
}


def public_registration_enabled() -> bool:
    allowlisted_user = os.getenv("ALLOWED_USER_ID", "").strip()
    return (
        not allowlisted_user
        and os.getenv("PUBLIC_REGISTRATION_ENABLED", "").strip().lower() == "true"
    )


def trials_enabled() -> bool:
    return os.getenv("TRIALS_ENABLED", "").strip().lower() == "true"


def is_operator(principal: AuthenticatedPrincipal) -> bool:
    allowed_user_id = os.getenv("ALLOWED_USER_ID", "").strip()
    return bool(allowed_user_id and principal.subject == allowed_user_id)


def trial_limits() -> dict[str, int]:
    raw = os.getenv("TRIAL_LIMITS_JSON")
    if raw is None:
        return _TRIAL_LIMIT_DEFAULTS.copy()
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict) or set(parsed) != set(_TRIAL_LIMIT_DEFAULTS):
            raise ValueError
        if any(type(value) is not int or value < 0 for value in parsed.values()):
            raise ValueError
        return parsed
    except (ValueError, TypeError):
        raise ApplicationError(
            ErrorKind.UNAVAILABLE, "Trial limit configuration is invalid",
        ) from None


def ensure_customer_organization(db: Session, user_id: str):
    organization = repository.organization_for_owner(db, user_id, lock=True)
    if organization is not None:
        return organization
    return repository.insert_organization(db, user_id)


def activate_trial(db: Session, organization_id: str) -> CustomerEntitlement:
    if not trials_enabled():
        raise ApplicationError(ErrorKind.UNAVAILABLE, "Trial activation is not enabled")
    organization = repository.organization_by_id(db, organization_id, lock=True)
    if organization is None:
        raise ApplicationError(ErrorKind.CONFLICT, "Customer organization is unavailable")
    current = repository.entitlement_for_organization(db, organization.id, lock=True)
    if current is not None:
        raise ApplicationError(ErrorKind.CONFLICT, "This customer organization already used its trial")
    limits = trial_limits()
    started_at = datetime.now(timezone.utc)
    try:
        days = int(os.getenv("TRIAL_DAYS", "14"))
    except ValueError:
        raise ApplicationError(ErrorKind.UNAVAILABLE, "Trial duration configuration is invalid") from None
    if days != 14:
        raise ApplicationError(ErrorKind.UNAVAILABLE, "Trial duration must remain 14 days")
    entitlement = CustomerEntitlement(
        organization_id=organization.id,
        status="trialing",
        trial_started_at=started_at,
        trial_expires_at=started_at + timedelta(days=days),
        payment_provider_status=None,
        limits=limits,
    )
    return repository.insert_entitlement(db, entitlement)


def prepare_workspace_activation(db: Session, user_id: str):
    """Lock the durable owner identity, start one trial, and enforce workspace count."""
    organization = ensure_customer_organization(db, user_id)
    entitlement = repository.entitlement_for_organization(db, organization.id, lock=True)
    if entitlement is None:
        if not trials_enabled():
            raise ApplicationError(ErrorKind.UNAVAILABLE, "Customer workspace activation is not enabled")
        entitlement = activate_trial(db, organization.id)
    status = effective_status(entitlement)
    if status not in {"trialing", "active", "operator_granted"}:
        raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "Your trial or subscription has ended")
    limit = (entitlement.limits or {}).get("businesses", 0)
    if type(limit) is not int or limit < 1:
        raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "No additional business workspace is available")
    if repository.count_businesses(db, organization.id) >= limit:
        raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "This account has reached its business workspace limit")
    return organization, entitlement


def require_campaign_capacity(db: Session, business_id: str) -> None:
    organization = repository.organization_for_business(db, business_id, lock=True)
    if organization is None:
        return
    entitlement = repository.entitlement_for_organization(db, organization.id, lock=True)
    if entitlement is None or entitlement.status != "trialing":
        return
    if effective_status(entitlement) != "trialing":
        raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "Your trial has ended")
    limit = (entitlement.limits or {}).get("campaigns", 0)
    if type(limit) is not int or limit < 0:
        raise ApplicationError(ErrorKind.UNAVAILABLE, "Trial campaign limit configuration is invalid")
    if repository.count_campaigns(db, organization.id) >= limit:
        raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "This trial campaign allowance is exhausted")


def entitlement_for_business(db: Session, business_id: str):
    return repository.entitlement_for_business(db, business_id)


def effective_status(entitlement: CustomerEntitlement, *, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    if entitlement.status == "trialing":
        expiry = entitlement.trial_expires_at
        if expiry is None:
            return "expired"
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        return "trialing" if now < expiry else "expired"
    return entitlement.status


def assert_mutation_allowed(db: Session, business_id: str, permission: Permission) -> None:
    entitlement = repository.entitlement_for_business(db, business_id)
    if entitlement is None:
        return
    status = effective_status(entitlement)
    if status in {"trialing", "active", "operator_granted"}:
        return
    if permission in {Permission.READ, Permission.EDIT_BUSINESS, Permission.PUBLISH}:
        return
    raise ApplicationError(
        ErrorKind.LIMIT_EXCEEDED,
        "Your trial or subscription has ended. Review account options to continue.",
    )


def assert_publishing_allowed(db: Session, business_id: str) -> None:
    entitlement = repository.entitlement_for_business(db, business_id)
    if entitlement is None or effective_status(entitlement) in {
        "trialing", "active", "operator_granted",
    }:
        return
    raise ApplicationError(
        ErrorKind.LIMIT_EXCEEDED,
        "Your trial or subscription has ended. Review account options to continue.",
    )


def reserve_usage(
    db: Session,
    principal: AuthenticatedPrincipal,
    *,
    business_id: str,
    metric: str,
    idempotency_key: str | None,
):
    if metric not in _USAGE_LIMITS:
        raise ValueError("Unsupported AI usage metric")
    entitlement = repository.entitlement_for_business(db, business_id)
    if entitlement is None or entitlement.status != "trialing":
        return None, False
    status = effective_status(entitlement)
    if status != "trialing":
        raise ApplicationError(
            ErrorKind.LIMIT_EXCEEDED,
            "Your trial has ended. Review account options to continue.",
        )
    organization = repository.organization_for_business(db, business_id, lock=True)
    if organization is None:
        raise ApplicationError(ErrorKind.FORBIDDEN, "Customer organization is unavailable")
    if idempotency_key is None:
        raise ApplicationError(ErrorKind.INVALID_INPUT, "A valid idempotency key is required")
    key = idempotency_key.strip()
    if not key or len(key) > 128:
        raise ApplicationError(ErrorKind.INVALID_INPUT, "A valid idempotency key is required")
    existing = repository.usage_reservation_by_key(db, organization.id, metric, key)
    if existing is not None:
        if existing.business_id != business_id or existing.user_id != principal.user_id:
            raise ApplicationError(ErrorKind.CONFLICT, "This idempotency key was already used")
        return existing, True
    limits = entitlement.limits or {}
    limit = limits.get(_USAGE_LIMITS[metric], 0)
    if type(limit) is not int or limit < 0:
        raise ApplicationError(ErrorKind.UNAVAILABLE, "Trial usage configuration is invalid")
    if repository.count_usage(db, organization.id, metric) >= limit:
        raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "This trial usage allowance is exhausted")
    return repository.insert_usage_reservation(
        db,
        organization_id=organization.id,
        business_id=business_id,
        user_id=principal.user_id,
        metric=metric,
        idempotency_key=key,
    ), False


def finish_usage_batch(
    db: Session,
    reservation_ids: list[str],
    *,
    succeeded: bool,
    result_id: str | None = None,
):
    status = "succeeded" if succeeded else "uncertain"
    updated = False
    for reservation_id in reservation_ids:
        updated = repository.update_usage_reservation(
            db, reservation_id, status=status, result_id=result_id,
        ) or updated
    if updated:
        Transactions(db).commit()


def finish_usage(db: Session, reservation_id: str, *, succeeded: bool, result_id: str | None = None):
    finish_usage_batch(
        db, [reservation_id], succeeded=succeeded, result_id=result_id,
    )


def release_usage_before_provider_call(db: Session, reservation_id: str) -> None:
    """Release a reservation only when the provider was definitely not called."""
    if repository.release_usage_reservation(db, reservation_id):
        Transactions(db).commit()


def usage_for_business(db: Session, business_id: str):
    entitlement = repository.entitlement_for_business(db, business_id)
    if entitlement is None:
        return None
    limits = entitlement.limits or {}
    organization_id = entitlement.organization_id
    campaign_count = repository.count_campaigns(db, organization_id)
    leo_used = repository.count_usage(db, organization_id, "leo_generation")
    sofia_used = repository.count_usage(db, organization_id, "sofia_request")
    now = datetime.now(timezone.utc)
    expires_at = entitlement.trial_expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    remaining_days = max(0, ceil((expires_at - now).total_seconds() / 86400)) if expires_at else 0
    return {
        "status": effective_status(entitlement),
        "provider_status": entitlement.payment_provider_status,
        "trial_started_at": entitlement.trial_started_at,
        "trial_expires_at": entitlement.trial_expires_at,
        "days_remaining": remaining_days,
        "usage": {
            "businesses": {
                "used": repository.count_businesses(db, organization_id),
                "limit": limits.get("businesses", 0),
            },
            "leo_generations": {"used": leo_used, "limit": limits.get("leo_generations", 0)},
            "sofia_requests": {"used": sofia_used, "limit": limits.get("sofia_requests", 0)            },
            "campaigns": {"used": campaign_count, "limit": limits.get("campaigns", 0)},
            "heygen_generations": {"used": 0, "limit": limits.get("heygen_generations", 0)},
        },
        "features": {
            "leo_generation": effective_status(entitlement) == "trialing" and leo_used < limits.get("leo_generations", 0),
            "sofia_requests": effective_status(entitlement) == "trialing" and sofia_used < limits.get("sofia_requests", 0),
            "heygen_generation": False,
            "facebook_publishing": effective_status(entitlement) == "trialing",
            "campaign_creation": (
                effective_status(entitlement) == "trialing"
                and campaign_count < limits.get("campaigns", 0)
            ),
        },
        "subscription_management": "unavailable",
    }
