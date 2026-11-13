from dataclasses import dataclass


@dataclass(frozen=True)
class Principal:
    """Trusted identity supplied only after JWT verification, never request JSON.

    This value does not verify tokens or grant access by itself. Do not construct
    it from client-selected user IDs.
    """

    issuer: str
    subject: str

    def __post_init__(self) -> None:
        if (not isinstance(self.issuer, str) or not self.issuer.strip()
                or not isinstance(self.subject, str) or not self.subject.strip()):
            raise ValueError("Verified issuer and subject are required")


@dataclass(frozen=True)
class AuthenticatedPrincipal(Principal):
    """Verified external identity resolved to an active application user.

    Resolution grants no membership. Services must still require_permission for
    every business operation; this value is not a cache of account status.
    """

    user_id: str


@dataclass(frozen=True)
class TenantAccess:
    """Request-local result, not a reusable authorization cache."""

    user_id: str
    business_id: str
    membership_id: str
    role: str
