"""Persistence queries used by analytics workflows."""
from sqlalchemy.orm import Session

from app.features.access.principal import TenantAccess
from app.models import EdianAnalysis, SocialAccount
from app.persistence import tenant
from app.features.drafts.repository import get_draft_scoped


def get_connected_facebook_account_scoped(db: Session, context: TenantAccess):
    return db.scalar(tenant.selection(SocialAccount, context).where(
        SocialAccount.platform == "facebook", SocialAccount.connection_status == "connected"))


def edian_analysis_scoped(
    db: Session,
    context: TenantAccess,
    input_fingerprint: str,
    *,
    lock: bool = False,
):
    statement = tenant.selection(EdianAnalysis, context).where(
        EdianAnalysis.input_fingerprint == input_fingerprint,
    )
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def edian_analysis_by_id_scoped(
    db: Session,
    context: TenantAccess,
    analysis_id: str,
):
    return db.scalar(
        tenant.selection(EdianAnalysis, context)
        .where(EdianAnalysis.id == analysis_id)
        .execution_options(populate_existing=True)
    )


def add_edian_analysis_scoped(
    db: Session,
    context: TenantAccess,
    record: EdianAnalysis,
) -> None:
    if record.business_id != context.business_id:
        raise ValueError("Edian analysis must match its authorized business")
    record_id = tenant.insert_record(db, context, record)
    if record_id is None:
        raise ValueError("Edian analysis business is unavailable")
    record.id = record_id


def flush(db: Session) -> None:
    db.flush()
