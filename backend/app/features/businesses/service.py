"""Business creation and listing workflows."""
from sqlalchemy.orm import Session

from app.models import Business
from . import repository
from .schemas import BusinessCreate


def create_business(request: BusinessCreate, db: Session) -> Business:
    business = Business(**request.model_dump())
    repository.add_business(db, business)
    db.commit()
    db.refresh(business)
    return business


def list_businesses(db: Session) -> list[Business]:
    return repository.list_businesses(db)
