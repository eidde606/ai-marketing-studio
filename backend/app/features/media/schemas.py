"""HeyGen asset selection response shapes."""
from typing import Literal

from pydantic import BaseModel, Field


AvatarType = Literal["studio_avatar", "digital_twin", "photo_avatar"]
AvatarOwnership = Literal["private", "public"]
VoiceType = Literal["private", "public"]


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
