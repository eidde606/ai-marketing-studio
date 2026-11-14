from typing import Literal

from pydantic import BaseModel, Field, ConfigDict
from app.features.accounts.schemas import Language


class DraftCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    business_id: str
    title: str
    caption: str
    platform: str
    media_type: Literal["text", "image", "video"] = "text"
    marketing_content_language: Language | None = None


class DraftDestinationsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    destinations: list[Literal["facebook", "tiktok"]] = Field(
        min_length=0,
        max_length=2,
    )


class DraftUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    caption: str
