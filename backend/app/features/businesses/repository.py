"""SQLAlchemy operations for businesses."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Business


from app.features.access.principal import TenantAccess
from app.persistence import tenant


def add_business(db: Session, business: Business) -> None:
    db.add(business)


def list_businesses(db: Session) -> list[Business]:
    return db.scalars(select(Business)).all()




def get_business_scoped(db: Session, context: TenantAccess):
    return tenant.get(db, context, Business, tenant.business_id(context))
