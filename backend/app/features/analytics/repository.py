"""Persistence queries used by analytics workflows."""
from sqlalchemy.orm import Session

from app.features.access.principal import TenantAccess
from app.models import SocialAccount
from app.persistence import tenant
from app.features.drafts.repository import get_draft_scoped


def get_connected_facebook_account_scoped(db: Session, context: TenantAccess):
    return db.scalar(tenant.selection(SocialAccount, context).where(
        SocialAccount.platform == "facebook", SocialAccount.connection_status == "connected"))
