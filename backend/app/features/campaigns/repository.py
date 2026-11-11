"""SQLAlchemy operations for campaigns. The service owns commits and refreshes."""
from collections.abc import Sequence

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.models import Business, Campaign, Draft


def find_business(db: Session, business_id: str) -> Business | None:
    return db.get(Business, business_id)


def find_campaign(db: Session, business_id: str, campaign_id: str) -> Campaign | None:
    return db.scalar(
        select(Campaign).where(
            Campaign.id == campaign_id,
            Campaign.business_id == business_id,
        )
    )


def list_campaigns(db: Session, business_id: str) -> Sequence[Campaign]:
    return db.scalars(
        select(Campaign)
        .where(Campaign.business_id == business_id)
        .options(selectinload(Campaign.drafts))
        .order_by(Campaign.created_at.desc(), Campaign.id)
    ).all()


def add_campaign(db: Session, campaign: Campaign) -> None:
    db.add(campaign)


def delete_campaign(db: Session, business_id: str, campaign: Campaign) -> None:
    # Unlink and delete in the same transaction; never delete the underlying drafts.
    db.execute(
        update(Draft)
        .where(
            Draft.business_id == business_id,
            Draft.campaign_id == campaign.id,
        )
        .values(campaign_id=None)
    )
    db.delete(campaign)


def lock_draft(db: Session, business_id: str, draft_id: str) -> Draft | None:
    # Keep the existing row lock for association changes and draft operations.
    return db.scalar(
        select(Draft)
        .where(Draft.id == draft_id, Draft.business_id == business_id)
        .with_for_update()
    )
