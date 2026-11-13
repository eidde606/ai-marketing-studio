"""Immutable AI inputs and attribution contracts; no ORM, HTTP, or SDK dependencies."""
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class BusinessProfile:
    name: str
    industry: str | None
    description: str | None
    products_services: str | None
    target_audience: str | None
    service_area: str | None
    brand_voice: str | None
    marketing_goals: str | None
    preferred_platforms: str | None
    posting_frequency: str | None
    website_url: str | None


@dataclass(frozen=True)
class Message:
    role: str
    content: str


@dataclass(frozen=True)
class LanguagePreferences:
    # Independent future preferences. None preserves current provider prompts.
    interface: str | None = None
    conversation: str | None = None
    marketing_content: str | None = None


@dataclass(frozen=True)
class OperationContext:
    request_id: str
    business_id: str
    user_id: str
    operation: str
    languages: LanguagePreferences = LanguagePreferences()


@dataclass(frozen=True)
class ProviderUsage:
    # Unknown values stay unknown; do not estimate billable usage from text length.
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost: Decimal | None = None
    currency: str | None = None
