
import os
from pathlib import Path

import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

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


def verify_token(
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
            options={
                "require": ["exp", "iat", "iss", "aud", "sub"]
            },
        )

        # Only Ángela's Supabase account is authorized.
        if payload.get("sub") != ALLOWED_USER_ID:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to access this application",
            )

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
