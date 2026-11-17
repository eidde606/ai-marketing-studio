"""Provider request limits for cost-bounded AI content workflows."""
import json
from typing import Any

from app.errors import ApplicationError, ErrorKind

MAX_INPUT_TOKENS = 8192
MAX_HISTORY_MESSAGES = 20
MAX_OUTPUT_TOKENS = 1000
_MAX_STATIC_PROMPT_BYTES = 4096
MAX_DYNAMIC_INPUT_BYTES = MAX_INPUT_TOKENS - _MAX_STATIC_PROMPT_BYTES
_REQUEST_OVERHEAD_TOKENS = 64


def token_upper_bound(value: str) -> int:
    """UTF-8 bytes conservatively bound the number of byte-pair tokens."""
    return len(value.encode("utf-8"))


def _serialize(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def dynamic_input_size_bytes(*values: object) -> int:
    serialized = "\n".join(
        value if isinstance(value, str) else _serialize(value)
        for value in values
        if value is not None
    )
    return token_upper_bound(serialized)


def assert_dynamic_input_fits(
    *values: object,
) -> None:
    if dynamic_input_size_bytes(*values) > MAX_DYNAMIC_INPUT_BYTES:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "This AI request contains too much context. Shorten the request or conversation and try again.",
        )


def assert_provider_input_fits(
    instructions: str,
    input_value: object,
    *,
    response_format: object | None = None,
) -> None:
    serialized = "\n".join(
        part
        for part in (
            instructions,
            _serialize(input_value),
            _serialize(response_format) if response_format is not None else None,
        )
        if part is not None
    )
    if token_upper_bound(serialized) + _REQUEST_OVERHEAD_TOKENS > MAX_INPUT_TOKENS:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "This AI request contains too much context. Shorten the request or conversation and try again.",
        )
