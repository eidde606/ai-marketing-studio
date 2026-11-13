from typing import Literal

from pydantic import BaseModel, Field


class DraftCreate(BaseModel):
    business_id: str
    title: str
    caption: str
    platform: str
    media_type: Literal["text", "image", "video"] = "text"


class DraftDestinationsUpdate(BaseModel):
    destinations: list[Literal["facebook", "tiktok"]] = Field(
        min_length=1,
        max_length=2,
    )


class DraftUpdate(BaseModel):
    title: str
    caption: str
