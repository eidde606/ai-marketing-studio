"""Operator-configured attempt allowances, not customer billing or price estimates."""
import json
import os
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session
from app.errors import ApplicationError, ErrorKind
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal, TenantAccess
from app.features.access.service import require_permission
from app.features.entitlements import service as entitlement_service
from . import repository


class Allowance(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    max_generations: int = Field(ge=0)
    max_script_characters: int = Field(ge=1, le=5000)
    max_concurrent_jobs: int = Field(ge=1)


def _allowance(business_id: str) -> Allowance | None:
    try:
        configuration = json.loads(os.getenv("HEYGEN_BUSINESS_ALLOWANCES", "{}"))
        if not isinstance(configuration, dict):
            raise ValueError("Expected a business mapping")
        raw = configuration.get(business_id)
        return Allowance.model_validate(raw) if raw is not None else None
    except (ValueError, TypeError, ValidationError):
        # Never expose environment contents in an error or allow on bad config.
        raise ApplicationError(ErrorKind.UNAVAILABLE, "HeyGen allowance configuration is invalid") from None


def usage(db: Session, principal: AuthenticatedPrincipal, business_id: str):
    context = require_permission(db, principal, business_id, Permission.READ)
    allowance = _allowance(business_id)
    total, active = repository.generation_usage_scoped(db, context)
    return {"business_id": business_id, "configured": allowance is not None,
            "limits": allowance.model_dump() if allowance else None,
            "attempts_used": total, "active_jobs": active,
            "remaining_generations": max(0, allowance.max_generations - total) if allowance else 0,
            "period": "lifetime", "unit": "generation_attempts"}


def attempt_count(db: Session, principal: AuthenticatedPrincipal, business_id: str) -> int:
    context = require_permission(db, principal, business_id, Permission.READ)
    total, _ = repository.generation_usage_scoped(db, context)
    return total


def require_capacity(db: Session, context: TenantAccess, script: str):
    """Called with the business row locked, in the attempt insertion transaction.

    Each persisted attempt permanently consumes one unit, including failed and
    unknown attempts. This is conservative operational protection, not a charge.
    Same-attempt recovery bypasses new capacity allocation. No automatic reset.
    """
    allowance = _allowance(context.business_id)
    if allowance is None:
        raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "No HeyGen generation allowance is configured for this business")
    total, active = repository.generation_usage_scoped(db, context)
    entitlement = entitlement_service.entitlement_for_business(db, context.business_id)
    if entitlement is not None and entitlement.status == "trialing":
        trial_limit = (entitlement.limits or {}).get("heygen_generations", 0)
        if type(trial_limit) is not int or trial_limit < 0:
            raise ApplicationError(ErrorKind.UNAVAILABLE, "Trial video-generation limit configuration is invalid")
        if total >= trial_limit:
            raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "Video generation is unavailable during this trial")
    if total >= allowance.max_generations:
        raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "The business HeyGen generation allowance is exhausted")
    if active >= allowance.max_concurrent_jobs:
        raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "Wait for an existing HeyGen job to finish or resolve its status")
    if len(script) > allowance.max_script_characters:
        raise ApplicationError(ErrorKind.LIMIT_EXCEEDED, "The script exceeds this business's HeyGen allowance")
