"""Campaign input validation and the existing response shapes.

Response TypedDicts document the wire format without changing serialization.
"""
from datetime import date, datetime
from typing import Literal, TypedDict

from pydantic import BaseModel, Field, field_validator

CampaignStatus = Literal["draft", "active", "paused", "completed", "archived"]


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    objective: str = Field(min_length=1, max_length=2000)
    status: CampaignStatus = "draft"
    start_date: date | None = None
    end_date: date | None = None

    @field_validator("name", "objective", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class CampaignUpdate(CampaignCreate):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    objective: str | None = Field(default=None, min_length=1, max_length=2000)
    status: CampaignStatus | None = None

    @field_validator("name", "objective", "status")
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError("Este campo no puede ser nulo.")
        return value


class CampaignDraftResponse(TypedDict):
    id: str
    title: str
    status: str
    platform: str
    published: bool
    deleted_at: datetime | None


class CampaignResponse(TypedDict):
    id: str
    business_id: str
    name: str
    objective: str
    status: str
    start_date: date | None
    end_date: date | None
    created_at: datetime
    updated_at: datetime
    total_count: int
    published_count: int
    pending_count: int
    rejected_count: int
    progress: float | int
    drafts: list[CampaignDraftResponse]
