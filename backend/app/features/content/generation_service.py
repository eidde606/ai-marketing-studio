"""Sebastián plans first; Valeria creates content using that exact strategy."""
import json

from .context import BusinessProfile
from . import adapters
from .input_limits import (
    MAX_DYNAMIC_INPUT_BYTES,
    assert_dynamic_input_fits,
    dynamic_input_size_bytes,
)


_OPTIONAL_PROFILE_FIELD_PRIORITY = (
    "industry",
    "products_services",
    "target_audience",
    "description",
    "brand_voice",
    "marketing_goals",
    "service_area",
    "preferred_platforms",
    "posting_frequency",
)


def generate_marketing_content(
    business: BusinessProfile,
    recent_posts: list[dict[str, str]] | None = None,
    campaign_instructions: str | None = None,
    conversation_language: str = "en",
    marketing_content_language: str = "en",
) -> dict[str, str]:
    """Sebastián plans varied content; Valeria creates the final post."""
    profile, history_context, campaign_context = _request_inputs(
        business, recent_posts, campaign_instructions,
    )
    adapters.validate_marketing_content_input(
        profile,
        history_context,
        campaign_context,
        conversation_language=conversation_language,
        marketing_content_language=marketing_content_language,
    )

    strategy = adapters.plan_content(
        profile,
        history_context,
        campaign_context,
        language=conversation_language,
    )
    return adapters.write_content(
        profile,
        strategy,
        language=marketing_content_language,
    )


def validate_marketing_content_input(
    business: BusinessProfile,
    recent_posts: list[dict[str, str]] | None = None,
    campaign_instructions: str | None = None,
    *,
    conversation_language: str = "en",
    marketing_content_language: str = "en",
) -> None:
    profile, history_context, campaign_context = _request_inputs(
        business, recent_posts, campaign_instructions,
    )
    adapters.validate_marketing_content_input(
        profile,
        history_context,
        campaign_context,
        conversation_language=conversation_language,
        marketing_content_language=marketing_content_language,
    )


def _request_inputs(
    business: BusinessProfile,
    recent_posts: list[dict[str, str]] | None,
    campaign_instructions: str | None,
) -> tuple[dict[str, object], str, str | None]:
    all_profile_fields: dict[str, object] = {
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
    campaign_context = (
        campaign_instructions.strip()
        if campaign_instructions
        else None
    )
    history_context = json.dumps([], ensure_ascii=False)
    profile_fields = {"name"}
    essential_profile = {"name": business.name}
    assert_dynamic_input_fits(
        essential_profile,
        history_context,
        campaign_context,
    )

    # Keep whole profile fields in priority order; never truncate JSON values.
    for field in _OPTIONAL_PROFILE_FIELD_PRIORITY:
        value = all_profile_fields[field]
        if value is None or value == "":
            continue
        candidate_fields = profile_fields | {field}
        candidate_profile = {
            key: value
            for key, value in all_profile_fields.items()
            if key in candidate_fields
        }
        if dynamic_input_size_bytes(
            candidate_profile,
            history_context,
            campaign_context,
        ) <= MAX_DYNAMIC_INPUT_BYTES:
            profile_fields = candidate_fields

    profile = {
        key: value
        for key, value in all_profile_fields.items()
        if key in profile_fields
    }
    selected_posts: list[dict[str, str]] = []
    for post in recent_posts:
        candidate_history = json.dumps(
            [*selected_posts, post],
            ensure_ascii=False,
        )
        if dynamic_input_size_bytes(
            profile,
            candidate_history,
            campaign_context,
        ) > MAX_DYNAMIC_INPUT_BYTES:
            break
        selected_posts.append(post)
        history_context = candidate_history

    assert_dynamic_input_fits(profile, history_context, campaign_context)
    return profile, history_context, campaign_context
