"""Sofía plans first; Leo then creates content using that exact strategy."""
import json

from app.models import Business
from . import adapters


def generate_marketing_content(
    business: Business,
    recent_posts: list[dict[str, str]] | None = None,
    campaign_instructions: str | None = None,
) -> dict[str, str]:
    """Sofía plans varied content; Leo creates the final post."""

    profile = {
        "name": business.name,
        "industry": business.industry,
        "description": business.description,
        "products_services": business.products_services,
        "target_audience": business.target_audience,
        "service_area": business.service_area,
        "brand_voice": business.brand_voice,
        "marketing_goals": business.marketing_goals,
        "preferred_platforms": business.preferred_platforms,
        "posting_frequency": business.posting_frequency,
    }

    recent_posts = recent_posts or []

    # Instructions from Sofía's conversation with the business owner.
    # None means automatic content generation.
    campaign_context = (
        campaign_instructions.strip()
        if campaign_instructions
        else None
    )

    history_context = json.dumps(
        recent_posts,
        ensure_ascii=False,
    )

    strategy = adapters.plan_content(
        profile,
        history_context,
        campaign_context,
    )
    return adapters.write_content(profile, strategy)
