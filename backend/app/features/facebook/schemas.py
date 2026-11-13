"""HTTP request schemas for Facebook Page connection."""
from pydantic import BaseModel


class FacebookPageSelection(BaseModel):
    selection_token: str
    page_id: str


class FacebookHandoffRequest(BaseModel):
    handoff_token: str
