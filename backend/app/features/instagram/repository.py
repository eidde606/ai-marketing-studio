from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    Business,
    InstagramConnection,
    InstagramOAuthState,
    SocialAccount,
)


from sqlalchemy import update
from app.features.access.principal import TenantAccess
from app.persistence import tenant


def get_business(db: Session, business_id: str) -> Business | None:
    return db.get(Business, business_id)


def get_facebook_page(db: Session, business_id: str) -> SocialAccount | None:
    return db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "facebook",
            SocialAccount.connection_status == "connected",
        )
    )


def get_facebook_page_scoped(db: Session, context: TenantAccess) -> SocialAccount | None:
    return db.scalar(tenant.selection(SocialAccount, context).where(
        SocialAccount.platform == "facebook",
        SocialAccount.connection_status == "connected",
    ))


def create_oauth_state(
    db: Session,
    *,
    state_hash: str,
    business_id: str,
    user_id: str,
    facebook_page_id: str,
    expires_at: datetime,
) -> None:
    db.add(
        InstagramOAuthState(
            state_hash=state_hash,
            business_id=business_id,
            user_id=user_id,
            facebook_page_id=facebook_page_id,
            expires_at=expires_at,
        )
    )


def oauth_state_identity(db: Session, state_hash: str, now: datetime):
    return db.execute(select(
        InstagramOAuthState.business_id, InstagramOAuthState.user_id,
        InstagramOAuthState.facebook_page_id,
    ).where(
        InstagramOAuthState.state_hash == state_hash,
        InstagramOAuthState.expires_at > now,
    )).one_or_none()


def consume_oauth_state(db: Session, state_hash: str, now: datetime):
    result = db.execute(
        _consume_oauth_state_statement(state_hash, now)
    )
    row = result.first()
    return row


def get_connection(db: Session, business_id: str) -> InstagramConnection | None:
    return db.get(InstagramConnection, business_id)


def save_connection(
    db: Session,
    business_id: str,
    values: dict,
    *,
    connection: InstagramConnection | None,
) -> InstagramConnection:
    if connection is None:
        connection = InstagramConnection(business_id=business_id, **values)
        db.add(connection)
    else:
        for name, value in values.items():
            setattr(connection, name, value)
    return connection


def _consume_oauth_state_statement(state_hash, now):
    return (
        delete(InstagramOAuthState)
        .where(
            InstagramOAuthState.state_hash == state_hash,
            InstagramOAuthState.expires_at > now,
        )
        .returning(
            InstagramOAuthState.business_id,
            InstagramOAuthState.user_id,
            InstagramOAuthState.facebook_page_id,
        )
    )




def get_connection_scoped(db: Session, context: TenantAccess):
    return tenant.get(db, context, InstagramConnection, tenant.business_id(context))


def update_connection_scoped(db: Session, context: TenantAccess, values: dict) -> bool:
    allowed = {"instagram_account_id", "username", "facebook_page_id", "encrypted_access_token",
               "token_expires_at", "granted_permissions", "status", "last_error", "updated_at"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported connection fields")
    statement = update(InstagramConnection).where(tenant.predicate(InstagramConnection, context))
    if values.get("facebook_page_id") is not None:
        statement = statement.where(select(SocialAccount.id).where(
            tenant.predicate(SocialAccount, context), SocialAccount.platform == "facebook",
            SocialAccount.platform_account_id == values["facebook_page_id"],
        ).exists())
    return db.execute(statement.values(**values).returning(InstagramConnection.business_id))\
        .scalar_one_or_none() is not None


def consume_oauth_state_scoped(db: Session, context: TenantAccess, state_hash: str,
                               initiator_subject: str, now: datetime):
    return db.execute(_consume_oauth_state_statement(state_hash, now).where(
        tenant.predicate(InstagramOAuthState, context), InstagramOAuthState.user_id == initiator_subject,
    )).first()


def add_connection_scoped(db: Session, context: TenantAccess, record: InstagramConnection):
    if not isinstance(record, InstagramConnection):
        raise TypeError("Expected InstagramConnection")
    return tenant.insert_record(db, context, record)


def add_oauth_state_scoped(db: Session, context: TenantAccess, record: InstagramOAuthState):
    if not isinstance(record, InstagramOAuthState):
        raise TypeError("Expected InstagramOAuthState")
    return tenant.insert_record(db, context, record)
