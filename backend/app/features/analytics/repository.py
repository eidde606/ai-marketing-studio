"""Persistence queries used by analytics workflows."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Draft, SocialAccount


from app.features.access.principal import TenantAccess
from app.persistence import tenant
from app.features.drafts.repository import get_draft_scoped


def get_draft(db: Session, draft_id: str) -> Draft | None:
    return db.get(Draft, draft_id)


def get_connected_facebook_account(
    db: Session,
    business_id: str | None,
) -> SocialAccount | None:
    return db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "facebook",
            SocialAccount.connection_status == "connected",
        )
    )




def get_connected_facebook_account_scoped(db: Session, context: TenantAccess):
    return db.scalar(tenant.selection(SocialAccount, context).where(
        SocialAccount.platform == "facebook", SocialAccount.connection_status == "connected"))
