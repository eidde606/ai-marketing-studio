"""Public contact endpoint; never requires or trusts a caller identity."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.errors import ApplicationError
from app.http_errors import http_error
from . import service
from .schemas import ContactSubmission

router = APIRouter()


class ContactResult(BaseModel):
    status: Literal["submitted"]


@router.post("/public/contact", response_model=ContactResult, status_code=201)
def submit_contact(submission: ContactSubmission, request: Request):
    try:
        client_address = request.client.host if request.client else ""
        return service.submit_contact(
            submission,
            client_address=client_address,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc
