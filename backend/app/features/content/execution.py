"""Application extension points for future tenant usage policy/attribution.

These hooks do not implement billing, quotas or persistence. Hooks get effective
language preferences and trusted request-local metadata only, never prompts,
history, tokens, or output. HeyGen attempt limits live in media.usage_service.
Provider success is not the same as authorization to persist the output.
"""
from .context import OperationContext, ProviderUsage


def before_generation(context: OperationContext) -> None:
    """Future tenant usage/limit policy; called only after access authorization."""


def after_generation(context: OperationContext, *, succeeded: bool,
                     usage: ProviderUsage | None = None) -> None:
    """Future attribution sink, including provider work whose output is discarded."""
