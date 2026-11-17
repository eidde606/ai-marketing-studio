from pydantic import BaseModel, ConfigDict


class BusinessCreate(BaseModel):
    name: str
    description: str | None = None
    target_audience: str | None = None
    brand_voice: str | None = None
    industry: str | None = None
    products_services: str | None = None
    service_area: str | None = None
    website_url: str | None = None
    marketing_goals: str | None = None
    preferred_platforms: str | None = None
    posting_frequency: str | None = None


class BusinessUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    target_audience: str | None = None
    brand_voice: str | None = None
    industry: str | None = None
    products_services: str | None = None
    service_area: str | None = None
    website_url: str | None = None
    marketing_goals: str | None = None
    preferred_platforms: str | None = None
    posting_frequency: str | None = None
