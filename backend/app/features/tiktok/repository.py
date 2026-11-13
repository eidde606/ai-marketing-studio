"""SQLAlchemy operations for TikTok OAuth state and accounts."""
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Business, SocialAccount, TikTokOAuthState


def get_business(db: Session, business_id: str) -> Business | None:
    return db.get(Business, business_id)


def add_oauth_state(db: Session, state: TikTokOAuthState) -> None:
    db.add(state)


def consume_oauth_state(
    db: Session,
    state_hash: str,
    now: datetime,
) -> str | None:
    result = db.execute(
        delete(TikTokOAuthState)
        .where(
            TikTokOAuthState.state_hash == state_hash,
            TikTokOAuthState.expires_at > now,
        )
        .returning(TikTokOAuthState.business_id)
    )
    return result.scalar_one_or_none()


def get_account(
    db: Session,
    business_id: str,
    platform_account_id: str,
) -> SocialAccount | None:
    return db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "tiktok",
            SocialAccount.platform_account_id == platform_account_id,
        )
    )


def add_account(db: Session, account: SocialAccount) -> None:
    db.add(account)


def list_accounts(db: Session, business_id: str) -> list[SocialAccount]:
    return db.scalars(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "tiktok",
        )
    ).all()
