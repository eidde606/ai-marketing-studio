"""HTTP contracts and application error translation."""
from fastapi import APIRouter, Body, Depends, Response
from sqlalchemy.orm import Session

from app.auth import verify_token, get_authenticated_principal
from app.features.access.principal import AuthenticatedPrincipal
from app.database import get_db

from app.errors import ApplicationError
from app.http_errors import http_error
from . import service
from .schemas import SofiaChatRequest, AIGenerationRequest

router = APIRouter(dependencies=[Depends(verify_token)])


@router.post("/businesses/{business_id}/generate-content", status_code=201)
def generate_content(
    business_id: str,
    request: AIGenerationRequest | None = Body(default=None),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.generate_content(business_id=business_id, db=db, principal=principal, request=request)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/businesses/{business_id}/sofia/conversations")
def list_sofia_conversations(
    business_id: str,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.list_sofia_conversations(business_id=business_id, db=db, principal=principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/businesses/{business_id}/sofia/conversations/{conversation_id}")
def get_sofia_conversation(
    business_id: str,
    conversation_id: str,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.get_sofia_conversation(
            business_id=business_id,
            conversation_id=conversation_id,
            db=db, principal=principal,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/businesses/{business_id}/sofia/conversation/latest")
def get_latest_sofia_conversation(
    business_id: str,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.get_latest_sofia_conversation(business_id=business_id, db=db, principal=principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/businesses/{business_id}/sofia/chat")
def sofia_chat(
    business_id: str,
    request: SofiaChatRequest,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.sofia_chat(business_id=business_id, request=request, db=db, principal=principal)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post(
    "/businesses/{business_id}/sofia/conversations/{conversation_id}/generate-draft"
)
def generate_sofia_conversation_draft(
    business_id: str,
    conversation_id: str,
    request: AIGenerationRequest | None = Body(default=None),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        return service.generate_sofia_conversation_draft(
            request=request,
            business_id=business_id,
            conversation_id=conversation_id,
            db=db, principal=principal,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.delete("/businesses/{business_id}/sofia/conversations/{conversation_id}", status_code=204)
def delete_sofia_conversation(
    business_id: str,
    conversation_id: str,
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
    db: Session = Depends(get_db),
):
    try:
        service.delete_sofia_conversation(business_id, conversation_id, db=db, principal=principal)
        return Response(status_code=204)
    except ApplicationError as exc:
        raise http_error(exc) from exc
