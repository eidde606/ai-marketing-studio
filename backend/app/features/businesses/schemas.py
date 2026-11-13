from pydantic import BaseModel


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
