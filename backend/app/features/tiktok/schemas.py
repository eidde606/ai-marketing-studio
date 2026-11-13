"""TikTok publication request schemas."""
from pydantic import BaseModel, Field


class TikTokPublishRequest(BaseModel):
    account_id: str = Field(min_length=1)
    privacy_level: str = Field(min_length=1)
    disable_comment: bool = False
    disable_duet: bool = False
    disable_stitch: bool = False
