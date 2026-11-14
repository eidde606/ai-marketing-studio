"""Resumable onboarding operations with atomic workspace activation."""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from app.features.accounts import repository as account_repository
from app.features.businesses import service as business_service
from app.features.businesses.schemas import BusinessCreate
from app.features.entitlements import service as entitlement_service
from app.features.media import usage_service as heygen_usage_service
from app.transactions import Transactions, rollback_on_failure
from . import repository
from .schemas import OnboardingActivation, OnboardingUpdate


def _lock_user(db: Session, principal: AuthenticatedPrincipal):
    user = repository.lock_active_user(db, principal)
    if user is None:
        raise ApplicationError(ErrorKind.FORBIDDEN, "Application access denied")
    return user


def _progress(db: Session, user_id: str, *, create: bool = False):
    progress = repository.progress_for_user(db, user_id, lock=True)
    if progress is None and create:
        progress = repository.add_progress(db, user_id)
    return progress


def get_progress(db: Session, principal: AuthenticatedPrincipal):
    actor = access.resolve_principal(db, principal)
    progress = repository.progress_for_user(db, actor.user_id)
    if progress is None:
        return {
            "current_step": 1,
            "business_profile": {},
            "interface_language": "en",
            "conversation_language": "en",
            "marketing_content_language": "en",
            "social_accounts_skipped": False,
            "completed": False,
            "tutorial_completed": False,
            "tutorial_step": 0,
        }
    data = progress.data or {}
    tutorial_step = data.get("tutorial_step", 0)
    if type(tutorial_step) is not int or not 0 <= tutorial_step <= 9:
        tutorial_step = 0
    return {
        "current_step": progress.current_step,
        "business_profile": data.get("business_profile", {}),
        "interface_language": data.get("interface_language", "en"),
        "conversation_language": data.get("conversation_language", "en"),
        "marketing_content_language": data.get("marketing_content_language", "en"),
        "social_accounts_skipped": data.get("social_accounts_skipped", False),
        "completed": progress.completed_at is not None,
        "tutorial_completed": progress.tutorial_completed_at is not None,
        "tutorial_step": tutorial_step,
    }


@rollback_on_failure
def save_progress(db: Session, principal: AuthenticatedPrincipal, request: OnboardingUpdate):
    user = _lock_user(db, principal)
    progress = _progress(db, user.id, create=True)
    progress.current_step = request.current_step
    progress.data = request.model_dump(exclude_none=True)
    Transactions(db).commit()
    return get_progress(db, principal)


@rollback_on_failure
def activate_workspace(
    db: Session,
    principal: AuthenticatedPrincipal,
    request: OnboardingActivation,
):
    user = _lock_user(db, principal)
    progress = _progress(db, user.id, create=True)
    if progress.business_id is not None:
        business = repository.owned_business(db, progress.business_id, user.id)
        if business is None:
            raise ApplicationError(ErrorKind.CONFLICT, "Onboarding workspace is unavailable")
        return business

    profile = request.business_profile
    if not profile.name or not profile.name.strip():
        raise ApplicationError(ErrorKind.INVALID_INPUT, "A business name is required")
    business = business_service.provision_business(
        BusinessCreate(**profile.model_dump(exclude_none=True)),
        db,
        principal=principal,
    )
    languages = {
        "interface_language": request.interface_language or "en",
        "conversation_language": request.conversation_language or "en",
    }
    account_repository.save_preferences_for_identity(db, principal, languages)
    context = access.require_permission(db, principal, business.id, Permission.EDIT_BUSINESS)
    account_repository.save_business_preferences_scoped(
        db, context, request.marketing_content_language or "en",
    )

    progress.business_id = business.id
    progress.current_step = 6
    progress.completed_at = datetime.now(timezone.utc)
    progress.data = request.model_dump(exclude_none=True)
    Transactions(db).commit()
    Transactions(db).refresh(business)
    return business


@rollback_on_failure
def update_tutorial_status(
    db: Session,
    principal: AuthenticatedPrincipal,
    completed: bool,
    *,
    current_step: int | None = None,
):
    user = _lock_user(db, principal)
    progress = _progress(db, user.id, create=True)
    data = dict(progress.data or {})
    if current_step is not None:
        data["tutorial_step"] = current_step
        progress.data = data
        if current_step == 0 and not completed:
            progress.tutorial_completed_at = None
    if completed and progress.tutorial_completed_at is None:
        progress.tutorial_completed_at = datetime.now(timezone.utc)
    Transactions(db).commit()
    return {
        "completed": progress.tutorial_completed_at is not None,
        "current_step": data.get("tutorial_step", 0),
    }


def entitlement_status(db: Session, principal: AuthenticatedPrincipal, business_id: str):
    access.require_permission(db, principal, business_id, Permission.READ)
    status = entitlement_service.usage_for_business(db, business_id)
    if status is not None:
        status["usage"]["heygen_generations"]["used"] = heygen_usage_service.attempt_count(
            db, principal, business_id,
        )
        return status
    return {
        "status": "operator_granted" if entitlement_service.is_operator(principal) else "unavailable",
        "provider_status": None,
        "trial_started_at": None,
        "trial_expires_at": None,
        "days_remaining": None,
        "usage": None,
        "features": {"heygen_generation": False},
        "subscription_management": "unavailable",
    }
