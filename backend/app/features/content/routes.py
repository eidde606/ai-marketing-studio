"""HTTP contracts and application error translation."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db

from app.errors import ApplicationError
from app.http_errors import http_error
from . import service
from .schemas import SofiaChatRequest

router = APIRouter(dependencies=[Depends(verify_token)])


@router.post("/businesses/{business_id}/generate-content", status_code=201)
def generate_content(business_id: str, db: Session = Depends(get_db)):
    try:
        return service.generate_content(business_id=business_id, db=db)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/businesses/{business_id}/sofia/conversations")
def list_sofia_conversations(business_id: str, db: Session = Depends(get_db)):
    try:
        return service.list_sofia_conversations(business_id=business_id, db=db)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/businesses/{business_id}/sofia/conversations/{conversation_id}")
def get_sofia_conversation(
    business_id: str,
    conversation_id: str,
    db: Session = Depends(get_db),
):
    try:
        return service.get_sofia_conversation(
            business_id=business_id,
            conversation_id=conversation_id,
            db=db,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/businesses/{business_id}/sofia/conversation/latest")
def get_latest_sofia_conversation(
    business_id: str,
    db: Session = Depends(get_db),
):
    try:
        return service.get_latest_sofia_conversation(business_id=business_id, db=db)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/businesses/{business_id}/sofia/chat")
def sofia_chat(
    business_id: str,
    request: SofiaChatRequest,
    db: Session = Depends(get_db),
):
    try:
        return service.sofia_chat(business_id=business_id, request=request, db=db)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post(
    "/businesses/{business_id}/sofia/conversations/{conversation_id}/generate-draft"
)
def generate_sofia_conversation_draft(
    business_id: str,
    conversation_id: str,
    db: Session = Depends(get_db),
):
    try:
        return service.generate_sofia_conversation_draft(
            business_id=business_id,
            conversation_id=conversation_id,
            db=db,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc
