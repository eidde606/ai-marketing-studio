from pydantic import BaseModel, ConfigDict, Field

from app.features.accounts.schemas import Language


class BusinessProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    industry: str | None = Field(default=None, max_length=200)
    products_services: str | None = Field(default=None, max_length=5000)
    website_url: str | None = Field(default=None, max_length=2048)
    service_area: str | None = Field(default=None, max_length=500)
    target_audience: str | None = Field(default=None, max_length=2000)
    brand_voice: str | None = Field(default=None, max_length=500)
    marketing_goals: str | None = Field(default=None, max_length=2000)
    preferred_platforms: str | None = Field(default=None, max_length=500)
    posting_frequency: str | None = Field(default=None, max_length=100)


class OnboardingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_step: int = Field(ge=1, le=6)
    business_profile: BusinessProfile | None = None
    interface_language: Language | None = None
    conversation_language: Language | None = None
    marketing_content_language: Language | None = None
    social_accounts_skipped: bool | None = None


class OnboardingActivation(OnboardingUpdate):
    business_profile: BusinessProfile


class TutorialUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completed: bool
