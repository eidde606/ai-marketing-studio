"""Persistence queries for customer entitlements and usage reservations."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AIUsageReservation,
    Business,
    Campaign,
    CustomerEntitlement,
    CustomerOrganization,
)


def organization_for_owner(db: Session, user_id: str, *, lock: bool = False):
    statement = select(CustomerOrganization).where(
        CustomerOrganization.owner_user_id == user_id,
    )
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def organization_by_id(db: Session, organization_id: str, *, lock: bool = False):
    statement = select(CustomerOrganization).where(CustomerOrganization.id == organization_id)
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def insert_organization(db: Session, user_id: str) -> CustomerOrganization:
    organization = CustomerOrganization(owner_user_id=user_id)
    db.add(organization)
    db.flush()
    return organization


def entitlement_for_organization(db: Session, organization_id: str, *, lock: bool = False):
    statement = select(CustomerEntitlement).where(
        CustomerEntitlement.organization_id == organization_id,
    )
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def insert_entitlement(db: Session, entitlement: CustomerEntitlement) -> CustomerEntitlement:
    db.add(entitlement)
    db.flush()
    return entitlement


def entitlement_for_business(db: Session, business_id: str, *, lock: bool = False):
    statement = (
        select(CustomerEntitlement)
        .join(CustomerOrganization, CustomerOrganization.id == CustomerEntitlement.organization_id)
        .join(Business, Business.customer_organization_id == CustomerOrganization.id)
        .where(Business.id == business_id)
    )
    if lock:
        statement = statement.with_for_update(of=CustomerEntitlement)
    return db.scalar(statement.execution_options(populate_existing=True))


def organization_for_business(db: Session, business_id: str, *, lock: bool = False):
    statement = select(CustomerOrganization).join(
        Business, Business.customer_organization_id == CustomerOrganization.id,
    ).where(Business.id == business_id)
    if lock:
        statement = statement.with_for_update(of=CustomerOrganization)
    return db.scalar(statement.execution_options(populate_existing=True))


def count_businesses(db: Session, organization_id: str) -> int:
    return db.scalar(select(func.count()).select_from(Business).where(
        Business.customer_organization_id == organization_id,
    )) or 0


def count_campaigns(db: Session, organization_id: str) -> int:
    return db.scalar(
        select(func.count()).select_from(Campaign).join(
            Business, Business.id == Campaign.business_id,
        ).where(Business.customer_organization_id == organization_id)
    ) or 0


def usage_reservation_by_key(
    db: Session, organization_id: str, metric: str, idempotency_key: str,
):
    return db.scalar(select(AIUsageReservation).where(
        AIUsageReservation.organization_id == organization_id,
        AIUsageReservation.metric == metric,
        AIUsageReservation.idempotency_key == idempotency_key,
    ).execution_options(populate_existing=True))


def count_usage(db: Session, organization_id: str, metric: str) -> int:
    return db.scalar(select(func.count()).select_from(AIUsageReservation).where(
        AIUsageReservation.organization_id == organization_id,
        AIUsageReservation.metric == metric,
        AIUsageReservation.status != "failed",
    )) or 0


def insert_usage_reservation(
    db: Session,
    *,
    organization_id: str,
    business_id: str,
    user_id: str,
    metric: str,
    idempotency_key: str,
) -> AIUsageReservation:
    reservation = AIUsageReservation(
        organization_id=organization_id,
        business_id=business_id,
        user_id=user_id,
        metric=metric,
        idempotency_key=idempotency_key,
        status="reserved",
    )
    db.add(reservation)
    db.flush()
    return reservation


def usage_reservation(db: Session, reservation_id: str, *, lock: bool = False):
    statement = select(AIUsageReservation).where(AIUsageReservation.id == reservation_id)
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def update_usage_reservation(
    db: Session, reservation_id: str, *, status: str, result_id: str | None,
):
    reservation = usage_reservation(db, reservation_id, lock=True)
    if reservation is None or reservation.status not in {"reserved", "succeeded"}:
        return False
    if reservation.status == "reserved":
        reservation.status = status
    if result_id is not None:
        reservation.result_id = result_id
    db.flush()
    return True


def release_usage_reservation(db: Session, reservation_id: str) -> bool:
    reservation = usage_reservation(db, reservation_id, lock=True)
    if reservation is None or reservation.status != "reserved":
        return False
    reservation.status = "failed"
    db.flush()
    return True
