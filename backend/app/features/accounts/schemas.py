from typing import Literal
from pydantic import BaseModel, ConfigDict

Language = Literal["en", "es"]


class RegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AccountPreferencesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    interface_language: Language | None = None
    conversation_language: Language | None = None


class BusinessPreferencesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    marketing_content_language: Language


class AccountPreferences(BaseModel):
    interface_language: Language
    conversation_language: Language


class BusinessAccess(BaseModel):
    id: str
    name: str
    membership_id: str
    role: Literal["owner", "admin", "member"]
    capabilities: list[str]


class FeatureAvailability(BaseModel):
    public_registration: bool
    facebook_publishing: bool
    tiktok_direct_publishing: bool
    tiktok_manual_export: bool
    instagram_publishing: bool
    instagram_connection: bool
    mia_analysis: bool
    scheduling: bool


class AccountResponse(BaseModel):
    user_id: str
    preferences: AccountPreferences
    businesses: list[BusinessAccess]
    features: FeatureAvailability
