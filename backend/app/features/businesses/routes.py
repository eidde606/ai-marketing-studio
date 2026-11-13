"""Authenticated business endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from . import service
from .schemas import BusinessCreate

router = APIRouter(dependencies=[Depends(verify_token)])


@router.post("/businesses", status_code=201)
def create_business(
    request: BusinessCreate,
    db: Session = Depends(get_db),
):
    return service.create_business(request, db)


@router.get("/businesses")
def list_businesses(db: Session = Depends(get_db)):
    return service.list_businesses(db)
