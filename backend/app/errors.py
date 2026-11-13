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


class ApplicationError(Exception):
    def __init__(self, kind: ErrorKind, detail: str):
        super().__init__(detail)
        self.kind = kind
        self.detail = detail
