from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    Business,
    InstagramConnection,
    InstagramOAuthState,
    SocialAccount,
)


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
    db.commit()


def consume_oauth_state(db: Session, state_hash: str) -> InstagramOAuthState | None:
    now = datetime.now(timezone.utc)
    result = db.execute(
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
    row = result.first()
    db.commit()
    if row is None:
        return None
    return InstagramOAuthState(
        business_id=row.business_id,
        user_id=row.user_id,
        facebook_page_id=row.facebook_page_id,
        expires_at=now,
        state_hash=state_hash,
    )


def get_connection(db: Session, business_id: str) -> InstagramConnection | None:
    return db.get(InstagramConnection, business_id)


def save_connection(
    db: Session,
    business_id: str,
    values: dict,
    *,
    preserve_authorized: bool = True,
) -> InstagramConnection:
    connection = db.get(InstagramConnection, business_id)
    if (
        preserve_authorized
        and connection is not None
        and connection.status == "connected_and_authorized"
        and values["status"] != "connected_and_authorized"
    ):
        return connection
    if connection is None:
        connection = InstagramConnection(business_id=business_id, **values)
        db.add(connection)
    else:
        for name, value in values.items():
            setattr(connection, name, value)
    db.commit()
    db.refresh(connection)
    return connection
