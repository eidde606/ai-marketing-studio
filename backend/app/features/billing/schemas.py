from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BillingOverview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    provider_status: str | None
    trial_started_at: datetime | None
    trial_expires_at: datetime | None
    days_remaining: int | None
    current_period_end: datetime | None
    cancel_at_period_end: bool
    usage: dict[str, dict[str, int]] | None
    plan_name: str
    price_display: str | None
    checkout_available: bool
    portal_available: bool
    can_manage: bool


class HostedSession(BaseModel):
    url: str


class WebhookResult(BaseModel):
    received: bool
    duplicate: bool = False
    processed: bool = False
