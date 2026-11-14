"""Authenticated business creation and membership-filtered listing."""
from uuid import uuid4
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from app.features.access.service import resolve_principal, require_permission
from app.features.entitlements import service as entitlement_service
from app.models import Business, BusinessMembership
from app.transactions import Transactions, rollback_on_failure
from . import repository
from .schemas import BusinessCreate, BusinessUpdate


@rollback_on_failure
def create_business(request: BusinessCreate, db: Session, *, principal: AuthenticatedPrincipal) -> Business:
    business = provision_business(request, db, principal=principal)
    Transactions(db).commit()
    Transactions(db).refresh(business)
    return business


def provision_business(
    request: BusinessCreate,
    db: Session,
    *,
    principal: AuthenticatedPrincipal,
) -> Business:
    """Insert a new business and owner in the caller's transaction."""
    actor = resolve_principal(db, principal)
    organization_id = None
    if not entitlement_service.is_operator(principal):
        organization, _ = entitlement_service.prepare_workspace_activation(db, actor.user_id)
        organization_id = organization.id
    business = Business(
        id=str(uuid4()),
        customer_organization_id=organization_id,
        **request.model_dump(),
    )
    membership = BusinessMembership(business_id=business.id, user_id=actor.user_id, role="owner", status="active")
    repository.insert_business_and_owner(db, business, membership)
    resolve_principal(db, principal)
    return business


def list_businesses(db: Session, *, principal: AuthenticatedPrincipal) -> list[Business]:
    actor = resolve_principal(db, principal)
    return repository.list_for_principal(db, actor)


@rollback_on_failure
def update_business(
    business_id: str,
    request: BusinessUpdate,
    db: Session,
    *,
    principal: AuthenticatedPrincipal,
) -> Business:
    context = require_permission(db, principal, business_id, Permission.EDIT_BUSINESS, lock=True)
    values = request.model_dump(exclude_unset=True)
    if "name" in values and (not values["name"] or not values["name"].strip()):
        raise ApplicationError(ErrorKind.INVALID_INPUT, "Business name is required")
    business = repository.update_business_scoped(db, context, values)
    if business is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
    require_permission(db, principal, business_id, Permission.EDIT_BUSINESS)
    Transactions(db).commit()
    Transactions(db).refresh(business)
    return business
