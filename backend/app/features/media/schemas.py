"""HeyGen asset selection response shapes."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


AvatarType = Literal["studio_avatar", "digital_twin", "photo_avatar"]
AvatarOwnership = Literal["private", "public"]
VoiceType = Literal["private", "public"]
GenerationStatus = Literal["SUBMITTING", "UNKNOWN", "PROCESSING", "COMPLETED", "FAILED"]


class AvatarLook(BaseModel):
    id: str
    name: str
    avatar_type: AvatarType
    default_voice_id: str | None = None
    supported_api_engines: list[str] | None = None
    preview_image_url: str | None = None
    preview_video_url: str | None = None
    group_id: str | None = None
    gender: str | None = None
    tags: list[str] = Field(default_factory=list)
    status: str | None = None


class HeyGenVoice(BaseModel):
    voice_id: str
    name: str
    language: str | None = None
    status: str | None = None
    mode: str | None = None
    preview_audio_url: str | None = None


class AvatarLookPage(BaseModel):
    data: list[AvatarLook]
    has_more: bool = False
    next_token: str | None = None


class HeyGenVoicePage(BaseModel):
    data: list[HeyGenVoice]
    has_more: bool = False
    next_token: str | None = None


class HeyGenGenerationRequest(BaseModel):
    avatar_id: str = Field(min_length=1)
    voice_id: str = Field(min_length=1)
    script: str = Field(min_length=1, max_length=5000)


class ImageRevisionRequest(BaseModel):
    instructions: str = Field(min_length=1, max_length=1000)


class HeyGenGenerationResponse(BaseModel):
    attempt_id: str
    draft_id: str
    business_id: str
    status: GenerationStatus
    provider_video_id: str | None = None
    storage_status: Literal["PENDING", "PROCESSING", "RETRY", "STORED", "FAILED"]
    created_at: datetime
    updated_at: datetime
