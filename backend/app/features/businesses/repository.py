"""SQLAlchemy operations for businesses."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Business


def add_business(db: Session, business: Business) -> None:
    db.add(business)


def list_businesses(db: Session) -> list[Business]:
    return db.scalars(select(Business)).all()
