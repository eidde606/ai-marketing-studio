"""Application workflow for public support requests."""

from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from app.errors import ApplicationError, ErrorKind
from . import email_adapter
from .schemas import ContactSubmission

_RATE_LIMIT_ATTEMPTS = 5
_RATE_LIMIT_WINDOW_SECONDS = 60 * 60


class ContactRateLimiter:
    """Process-local first-line abuse limit; request data is not persisted."""

    def __init__(self) -> None:
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, client_address: str) -> None:
        now = monotonic()
        cutoff = now - _RATE_LIMIT_WINDOW_SECONDS
        with self._lock:
            for address in tuple(self._attempts):
                attempts = self._attempts[address]
                while attempts and attempts[0] <= cutoff:
                    attempts.popleft()
                if not attempts:
                    del self._attempts[address]

            attempts = self._attempts[client_address]
            if len(attempts) >= _RATE_LIMIT_ATTEMPTS:
                raise ApplicationError(
                    ErrorKind.LIMIT_EXCEEDED,
                    "Too many contact requests",
                )
            attempts.append(now)

    def clear(self) -> None:
        with self._lock:
            self._attempts.clear()


_rate_limiter = ContactRateLimiter()


def submit_contact(
    submission: ContactSubmission,
    *,
    client_address: str,
) -> dict[str, str]:
    if submission.website.strip():
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "Contact request could not be accepted",
        )
    if not client_address:
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Support request could not be accepted",
        )
    email_adapter.ensure_configured()
    _rate_limiter.check(client_address)
    email_adapter.send_contact_email(submission)
    return {"status": "submitted"}
