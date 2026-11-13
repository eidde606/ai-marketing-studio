"""SQLAlchemy operations for campaigns. The service owns commits and refreshes."""
from collections.abc import Sequence

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.models import Business, Campaign, Draft


from sqlalchemy import delete, func
from app.features.access.principal import TenantAccess
from app.persistence import tenant


def find_business(db: Session, business_id: str) -> Business | None:
    return db.get(Business, business_id)


def find_campaign(db: Session, business_id: str, campaign_id: str) -> Campaign | None:
    return db.scalar(
        select(Campaign).where(
            Campaign.id == campaign_id,
            Campaign.business_id == business_id,
        ).options(selectinload(Campaign.drafts.and_(Draft.business_id == business_id)))
    )


def list_campaigns(db: Session, business_id: str) -> Sequence[Campaign]:
    return db.scalars(
        select(Campaign)
        .where(Campaign.business_id == business_id)
        .options(selectinload(Campaign.drafts.and_(Draft.business_id == business_id)))
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
    db.execute(delete(Campaign).where(Campaign.id == campaign.id, Campaign.business_id == business_id))


def lock_draft(db: Session, business_id: str, draft_id: str) -> Draft | None:
    # Keep the existing row lock for association changes and draft operations.
    return db.scalar(
        select(Draft)
        .where(Draft.id == draft_id, Draft.business_id == business_id)
        .with_for_update()
    )




def find_campaign_scoped(db: Session, context: TenantAccess, campaign_id: str):
    return db.scalar(tenant.selection(Campaign, context).where(Campaign.id == campaign_id)
                     .options(selectinload(Campaign.drafts.and_(tenant.predicate(Draft, context)))))


def list_campaigns_scoped(db: Session, context: TenantAccess, *, limit=100, offset=0):
    return db.scalars(tenant.page(tenant.selection(Campaign, context)
        .options(selectinload(Campaign.drafts.and_(tenant.predicate(Draft, context))))
        .order_by(Campaign.created_at.desc(), Campaign.id), limit=limit, offset=offset)).all()


def draft_count_scoped(db: Session, context: TenantAccess, campaign_id: str) -> int:
    return db.scalar(select(func.count()).select_from(Draft).where(
        tenant.predicate(Draft, context), Draft.campaign_id == campaign_id,
        select(Campaign.id).where(Campaign.id == campaign_id, tenant.predicate(Campaign, context)).exists(),
        Draft.deleted_at.is_(None),
    ))


def change_association_scoped(db: Session, context: TenantAccess, campaign_id: str,
                              draft_id: str, *, attach: bool) -> bool:
    # Keep the existing draft-row lock order. Every predicate repeats tenant scope.
    draft = db.scalar(tenant.selection(Draft, context).where(Draft.id == draft_id).with_for_update())
    if draft is None:
        return False
    statement = update(Draft).where(
        tenant.predicate(Draft, context), Draft.id == draft_id,
        select(Campaign.id).where(Campaign.id == campaign_id, tenant.predicate(Campaign, context)).exists(),
    )
    if attach:
        statement = statement.where(Draft.deleted_at.is_(None),
                                     (Draft.campaign_id.is_(None)) | (Draft.campaign_id == campaign_id))
    else:
        statement = statement.where(Draft.campaign_id == campaign_id)
    return db.execute(statement.values(campaign_id=campaign_id if attach else None)
                      .returning(Draft.id)).scalar_one_or_none() is not None


def delete_campaign_scoped(db: Session, context: TenantAccess, campaign_id: str) -> bool:
    # Lock the parent before the unlink/delete pair; transaction remains service-owned.
    if tenant.get(db, context, Campaign, campaign_id, lock=True) is None:
        return False
    db.execute(update(Draft).where(tenant.predicate(Draft, context), Draft.campaign_id == campaign_id)
               .values(campaign_id=None))
    return db.execute(delete(Campaign).where(tenant.predicate(Campaign, context), Campaign.id == campaign_id)
                      .returning(Campaign.id)).scalar_one_or_none() is not None


def add_campaign_scoped(db: Session, context: TenantAccess, record: Campaign):
    if not isinstance(record, Campaign):
        raise TypeError("Expected Campaign")
    return tenant.insert_record(db, context, record)


def update_campaign_scoped(db: Session, context: TenantAccess, campaign_id: str, values: dict) -> bool:
    allowed = {"name", "objective", "status", "start_date", "end_date", "updated_at"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported campaign fields")
    return db.execute(update(Campaign).where(
        tenant.predicate(Campaign, context), Campaign.id == campaign_id,
    ).values(**values).returning(Campaign.id)).scalar_one_or_none() is not None


def lock_campaign_scoped(db: Session, context: TenantAccess, campaign_id: str):
    return tenant.get(db, context, Campaign, campaign_id, lock=True)


def lock_campaign_drafts_scoped(db: Session, context: TenantAccess, campaign_id: str):
    return db.scalars(tenant.selection(Draft, context).where(Draft.campaign_id == campaign_id)
                      .order_by(Draft.id).with_for_update()).all()


def lock_association_draft_scoped(db: Session, context: TenantAccess, draft_id: str):
    return tenant.get(db, context, Draft, draft_id, lock=True)
