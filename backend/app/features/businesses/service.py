"""Authenticated business creation and membership-filtered listing."""
from uuid import uuid4
from sqlalchemy.orm import Session

from app.features.access.principal import AuthenticatedPrincipal
from app.features.access.service import resolve_principal
from app.models import Business, BusinessMembership
from app.transactions import Transactions, rollback_on_failure
from . import repository
from .schemas import BusinessCreate


@rollback_on_failure
def create_business(request: BusinessCreate, db: Session, *, principal: AuthenticatedPrincipal) -> Business:
    actor = resolve_principal(db, principal)
    business = Business(id=str(uuid4()), **request.model_dump())
    membership = BusinessMembership(business_id=business.id, user_id=actor.user_id, role="owner", status="active")
    repository.insert_business_and_owner(db, business, membership)
    resolve_principal(db, principal)
    Transactions(db).commit()
    Transactions(db).refresh(business)
    return business


def list_businesses(db: Session, *, principal: AuthenticatedPrincipal) -> list[Business]:
    actor = resolve_principal(db, principal)
    return repository.list_for_principal(db, actor)
