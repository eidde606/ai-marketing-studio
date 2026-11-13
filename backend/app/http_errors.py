"""HTTP translation shared by route boundaries, never imported by services."""
from fastapi import HTTPException

from app.errors import ApplicationError, ErrorKind


_STATUS = {
    ErrorKind.INVALID_INPUT: 400,
    ErrorKind.NOT_FOUND: 404,
    ErrorKind.CONFLICT: 409,
    ErrorKind.UPSTREAM_FAILURE: 502,
    ErrorKind.UNAVAILABLE: 503,
    ErrorKind.TOO_LARGE: 413,
    ErrorKind.UNSUPPORTED_MEDIA: 415,
    ErrorKind.FORBIDDEN: 403,
    ErrorKind.UNAUTHENTICATED: 401,
}


def http_error(error: ApplicationError) -> HTTPException:
    return HTTPException(
        status_code=_STATUS[error.kind],
        detail=error.detail,
    )
