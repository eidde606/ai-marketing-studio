"""SQLAlchemy operations for Facebook OAuth and connected Pages."""
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Business, FacebookOAuthState, SocialAccount


def get_business(db: Session, business_id: str) -> Business | None:
    return db.get(Business, business_id)


def add_oauth_state(db: Session, state: FacebookOAuthState) -> None:
    db.add(state)


def consume_oauth_state(
    db: Session,
    state_hash: str,
    now: datetime,
) -> tuple[str, str] | None:
    result = db.execute(
        delete(FacebookOAuthState)
        .where(
            FacebookOAuthState.state_hash == state_hash,
            FacebookOAuthState.expires_at > now,
            FacebookOAuthState.selection_token_hash.is_(None),
        )
        .returning(
            FacebookOAuthState.business_id,
            FacebookOAuthState.user_id,
        )
    )
    row = result.first()
    return (row.business_id, row.user_id) if row is not None else None


def add_pending_selection(
    db: Session,
    pending: FacebookOAuthState,
) -> None:
    db.add(pending)


def get_pending_handoff(
    db: Session,
    token_hash: str,
    user_id: str,
    now: datetime,
) -> FacebookOAuthState | None:
    return db.scalar(
        select(FacebookOAuthState).where(
            FacebookOAuthState.selection_token_hash == token_hash,
            FacebookOAuthState.user_id == user_id,
            FacebookOAuthState.expires_at > now,
        )
    )


def lock_pending_selection(
    db: Session,
    token_hash: str,
    user_id: str,
    now: datetime,
) -> FacebookOAuthState | None:
    return db.scalar(
        select(FacebookOAuthState)
        .where(
            FacebookOAuthState.selection_token_hash == token_hash,
            FacebookOAuthState.expires_at > now,
            FacebookOAuthState.user_id == user_id,
        )
        .with_for_update()
    )


def get_page_account(
    db: Session,
    business_id: str,
    page_id: str,
) -> SocialAccount | None:
    return db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "facebook",
            SocialAccount.platform_account_id == page_id,
        )
    )


def add_social_account(db: Session, account: SocialAccount) -> None:
    db.add(account)


def delete_pending_selection(
    db: Session,
    pending: FacebookOAuthState,
) -> None:
    db.delete(pending)


def list_page_accounts(db: Session, business_id: str) -> list[SocialAccount]:
    return db.scalars(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "facebook",
        )
    ).all()
