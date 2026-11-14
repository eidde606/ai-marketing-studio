import os
from pathlib import Path

import jwt
import httpx
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import ApplicationError
from app.features.access.principal import AuthenticatedPrincipal, Principal
from app.features.access import service as access_service
from app.features.entitlements import service as entitlement_service
from app.http_errors import http_error

# Load environment variables
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
ALLOWED_USER_ID = os.getenv("ALLOWED_USER_ID", "").strip()

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL is not configured")

if not ALLOWED_USER_ID:
    raise RuntimeError("ALLOWED_USER_ID is not configured")

SUPABASE_ISSUER = f"{SUPABASE_URL}/auth/v1"
SUPABASE_JWKS_URL = f"{SUPABASE_ISSUER}/.well-known/jwks.json"

security = HTTPBearer(auto_error=False)
jwks_client = PyJWKClient(SUPABASE_JWKS_URL)


def _verify_supabase_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    token = credentials.credentials

    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)

        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=SUPABASE_ISSUER,
            leeway=30,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )

        # Application admission is resolved against an active local identity;
        # registration availability is enforced only by the provisioning route.
        return payload

    except HTTPException:
        raise

    except jwt.PyJWTError as exc:
        print(
            f"JWT verification failed: {type(exc).__name__}: {exc}",
            flush=True,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
        ) from exc

    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify authentication",
        )


def get_registration_identity(
    payload: dict = Depends(_verify_supabase_token),
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> Principal:
    """Provision a verified operator or gated, email-verified customer identity."""
    if payload.get("is_anonymous", False):
        raise HTTPException(status_code=403, detail="Application access denied")
    if payload.get("sub") != ALLOWED_USER_ID and not entitlement_service.public_registration_enabled():
        raise HTTPException(status_code=403, detail="Customer registration is not enabled")
    if payload.get("sub") != ALLOWED_USER_ID and not _has_verified_email(
        payload,
        credentials.credentials if credentials else "",
    ):
        raise HTTPException(
            status_code=403,
            detail="Verify your email address before creating an account",
        )
    return Principal(issuer=payload["iss"], subject=payload["sub"])


def _has_verified_email(payload: dict, access_token: str) -> bool:
    publishable_key = (
        os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        or os.getenv("SUPABASE_ANON_KEY", "").strip()
    )
    if not publishable_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email verification is unavailable",
        )

    try:
        response = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": publishable_key,
                "Authorization": f"Bearer {access_token}",
            },
            timeout=5.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify email address",
        ) from exc

    if response.status_code in {401, 403}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
        )
    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify email address",
        )
    try:
        user = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify email address",
        ) from exc
    if not isinstance(user, dict):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify email address",
        )
    if user.get("id") != payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
        )
    return bool(user.get("email") and user.get("email_confirmed_at"))


def get_authenticated_principal(
    payload: dict = Depends(_verify_supabase_token),
    db: Session = Depends(get_db),
) -> AuthenticatedPrincipal:
    """HTTP boundary: verified, admitted JWT -> active application identity.

    No request-selected user IDs and no implicit user or membership creation.
    FastAPI caches this dependency only for the current request.
    """
    try:
        return access_service.resolve_principal(
            db, Principal(issuer=payload["iss"], subject=payload["sub"]),
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


def verify_token(
    payload: dict = Depends(_verify_supabase_token),
    principal: AuthenticatedPrincipal = Depends(get_authenticated_principal),
) -> dict:
    """Compatibility dependency for existing routes; preserves JWT claim shape.

    Both dependencies share the same cached JWT verification. The principal
    dependency gates every legacy protected route on an active application user.
    Registration admission is enforced only by get_registration_identity. New
    integrations should receive get_authenticated_principal and authorize the
    business in their application service.
    """
    return payload
