"""Content integrations. Kept separate from HTTP and persistence."""

from .openai_provider import (
    plan_content,
    validate_generation_input,
    write_content,
)
from .sofia_provider import chat_with_sofia, validate_chat_input


def validate_sofia_chat_input(business, messages, *, language="en") -> None:
    validate_chat_input(business, messages, language=language)


def validate_marketing_content_input(
    profile,
    history_context,
    campaign_context,
    *,
    conversation_language="en",
    marketing_content_language="en",
) -> None:
    validate_generation_input(
        profile,
        history_context,
        campaign_context,
        conversation_language=conversation_language,
        marketing_content_language=marketing_content_language,
    )
