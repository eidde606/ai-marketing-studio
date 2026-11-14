"""Identity-scoped account persistence and tenant-scoped business preferences."""
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import User, UserPreferences, Business, BusinessMembership, BusinessPreferences
from app.features.access.principal import Principal, AuthenticatedPrincipal, TenantAccess


def user_for_identity(db: Session, identity: Principal, *, lock=False):
    statement = select(User).where(User.auth_issuer == identity.issuer, User.auth_subject == identity.subject)
    if isinstance(identity, AuthenticatedPrincipal):
        statement = statement.where(User.id == identity.user_id)
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def insert_identity(db: Session, identity: Principal):
    user = User(auth_issuer=identity.issuer, auth_subject=identity.subject, status="active")
    db.add(user)
    db.flush()
    return user


def preferences_for_identity(db: Session, identity: AuthenticatedPrincipal):
    return db.scalar(select(UserPreferences).join(User, User.id == UserPreferences.user_id).where(
        User.id == identity.user_id, User.auth_issuer == identity.issuer,
        User.auth_subject == identity.subject, User.status == "active",
    ).execution_options(populate_existing=True))


def save_preferences_for_identity(db: Session, identity: AuthenticatedPrincipal, values: dict):
    preferences = preferences_for_identity(db, identity)
    if preferences is None:
        preferences = UserPreferences(user_id=identity.user_id)
        db.add(preferences)
    for key, value in values.items():
        if key not in {"interface_language", "conversation_language"}:
            raise ValueError("Unsupported account preference")
        setattr(preferences, key, value)
    db.flush()


def memberships_for_identity(db: Session, identity: AuthenticatedPrincipal):
    return db.execute(select(Business.id, Business.name, BusinessMembership.id.label("membership_id"),
                             BusinessMembership.role).join(
        BusinessMembership, BusinessMembership.business_id == Business.id,
    ).join(User, User.id == BusinessMembership.user_id).where(
        User.id == identity.user_id, User.auth_issuer == identity.issuer,
        User.auth_subject == identity.subject, User.status == "active",
        BusinessMembership.status == "active",
    ).order_by(Business.name, Business.id)).all()


def get_business_preferences_scoped(db: Session, context: TenantAccess):
    return db.scalar(select(BusinessPreferences).where(
        BusinessPreferences.business_id == context.business_id,
    ).execution_options(populate_existing=True))


def save_business_preferences_scoped(db: Session, context: TenantAccess, language: str):
    preferences = get_business_preferences_scoped(db, context)
    if preferences is None:
        preferences = BusinessPreferences(business_id=context.business_id)
        db.add(preferences)
    preferences.marketing_content_language = language
    db.flush()
