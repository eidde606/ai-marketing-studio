"""Transport-independent expected application failures."""
from enum import Enum


class ErrorKind(Enum):
    INVALID_INPUT = "invalid_input"
    UNPROCESSABLE_ENTITY = "unprocessable_entity"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    UPSTREAM_FAILURE = "upstream_failure"
    UNAVAILABLE = "unavailable"
    TOO_LARGE = "too_large"
    UNSUPPORTED_MEDIA = "unsupported_media"
    FORBIDDEN = "forbidden"
    UNAUTHENTICATED = "unauthenticated"
    LIMIT_EXCEEDED = "limit_exceeded"


class ErrorCode(Enum):
    AI_ENTITLEMENT_REQUIRED = "ai_entitlement_required"
    AI_SUBSCRIPTION_REQUIRED = "ai_subscription_required"
    AI_QUOTA_EXHAUSTED = "ai_quota_exhausted"
    PROVIDER_RATE_LIMITED = "provider_rate_limited"
    FACEBOOK_PERMISSION_REQUIRED = "facebook_permission_required"
    FACEBOOK_TOKEN_EXPIRED = "facebook_token_expired"
    FACEBOOK_POST_UNAVAILABLE = "facebook_post_unavailable"
    FACEBOOK_PROVIDER_ERROR = "facebook_provider_error"


class ApplicationError(Exception):
    def __init__(self, kind: ErrorKind, detail: str, *, code: str | ErrorCode | None = None):
        super().__init__(detail)
        self.kind = kind
        self.detail = detail
        self.code = code.value if isinstance(code, ErrorCode) else code
