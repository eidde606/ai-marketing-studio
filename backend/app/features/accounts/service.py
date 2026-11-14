"""Account workflows: trusted identity only, no ownership assignment."""
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.errors import ApplicationError, ErrorKind
from app.features.access.permissions import Permission, allows
from app.features.access.principal import Principal, AuthenticatedPrincipal
from app.features.access.service import resolve_principal, require_permission
from app.features.entitlements import service as entitlement_service
from app.transactions import Transactions, rollback_on_failure
from . import repository
from .schemas import AccountPreferencesUpdate


def _active_user(db: Session, identity: Principal, *, lock=False):
    user = repository.user_for_identity(db, identity, lock=lock)
    if user is None or user.status != "active":
        raise ApplicationError(ErrorKind.FORBIDDEN, "Application access denied")
    return user


@rollback_on_failure
def register(db: Session, identity: Principal):
    # The route supplies only the verified, still-allowlisted JWT identity.
    # No email matching, membership inference, or disabled-account resurrection.
    user = repository.user_for_identity(db, identity, lock=True)
    if user is None:
        try:
            user = repository.insert_identity(db, identity)
        except IntegrityError:
            Transactions(db).rollback()
            # Concurrent requests converge through the unique issuer/subject key.
            user = _active_user(db, identity)
    elif user.status != "active":
        raise ApplicationError(ErrorKind.FORBIDDEN, "Application access denied")
    entitlement_service.ensure_customer_organization(db, user.id)
    Transactions(db).commit()
    return account(db, resolve_principal(db, identity))


def language_preferences(db: Session, principal: AuthenticatedPrincipal):
    actor = resolve_principal(db, principal)
    preferences = repository.preferences_for_identity(db, actor)
    return {
        "interface_language": preferences.interface_language if preferences else "en",
        "conversation_language": preferences.conversation_language if preferences else "en",
    }


def account(db: Session, principal: AuthenticatedPrincipal):
    actor = resolve_principal(db, principal)
    memberships = repository.memberships_for_identity(db, actor)
    return {
        "user_id": actor.user_id,
        "preferences": language_preferences(db, actor),
        "businesses": [{"id": row.id, "name": row.name, "membership_id": row.membership_id,
                        "role": row.role,
                        "capabilities": [p.value for p in Permission if allows(row.role, p)]}
                       for row in memberships],
        "features": {"public_registration": entitlement_service.public_registration_enabled(), "facebook_publishing": True,
                     "tiktok_direct_publishing": False, "tiktok_manual_export": True,
                     "instagram_publishing": False, "instagram_connection": True,
                     "mia_analysis": False, "scheduling": False},
    }


@rollback_on_failure
def update_preferences(db: Session, principal: AuthenticatedPrincipal, request: AccountPreferencesUpdate):
    actor = resolve_principal(db, principal)
    _active_user(db, actor, lock=True)
    values = request.model_dump(exclude_unset=True)
    if not values or any(value is None for value in values.values()):
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Choose at least one supported language")
    repository.save_preferences_for_identity(db, actor, values)
    Transactions(db).commit()
    return language_preferences(db, actor)


def business_preferences(db: Session, principal: AuthenticatedPrincipal, business_id: str):
    context = require_permission(db, principal, business_id, Permission.READ)
    preferences = repository.get_business_preferences_scoped(db, context)
    return {"marketing_content_language": preferences.marketing_content_language if preferences else "en"}


@rollback_on_failure
def update_business_preferences(db: Session, principal: AuthenticatedPrincipal, business_id: str, language: str):
    context = require_permission(db, principal, business_id, Permission.EDIT_BUSINESS, lock=True)
    repository.save_business_preferences_scoped(db, context, language)
    Transactions(db).commit()
    return business_preferences(db, principal, business_id)
