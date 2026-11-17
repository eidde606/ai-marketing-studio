"""TikTok OAuth provider calls."""
import os
from urllib.parse import urlencode

import httpx

TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/"
TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"

def requested_scopes() -> list[str]:
    scopes = ["user.info.basic"]
    if os.getenv("TIKTOK_DIRECT_PUBLISHING_ENABLED") == "1":
        scopes.append("video.publish")
    return scopes


def _read_data(response: httpx.Response) -> dict:
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("TikTok returned an invalid response")
    error = payload.get("error")
    if isinstance(error, dict) and error.get("code") not in (None, "ok", 0):
        raise ValueError("TikTok returned an unsuccessful response")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("TikTok response data is missing")
    return data


def _validate_tokens(result: dict, *, needs_refresh: bool) -> dict:
    required = ("access_token", "refresh_token") if needs_refresh else ("access_token",)
    if any(not isinstance(result.get(key), str) or not result[key] for key in required):
        raise ValueError("TikTok token response is incomplete")
    expires_in = result.get("expires_in")
    if isinstance(expires_in, bool) or not isinstance(expires_in, int) or expires_in <= 0:
        raise ValueError("TikTok token expiry is invalid")
    return result


async def refresh_tiktok_token(refresh_token: str) -> dict:
    data = {
        "client_key": os.environ["TIKTOK_CLIENT_KEY"],
        "client_secret": os.environ["TIKTOK_CLIENT_SECRET"],
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(TIKTOK_TOKEN_URL, data=data)
        response.raise_for_status()

    return _validate_tokens(_read_data(response), needs_refresh=True)


def get_tiktok_login_url(state: str) -> str:
    """Build the TikTok authorization URL."""
    client_key = os.environ["TIKTOK_CLIENT_KEY"]
    redirect_uri = os.environ["TIKTOK_REDIRECT_URI"]
    params = {
        "client_key": client_key,
        "response_type": "code",
        "scope": ",".join(requested_scopes()),
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{TIKTOK_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code_for_token(code: str) -> dict:
    """Exchange TikTok's authorization code for tokens."""
    data = {
        "client_key": os.environ["TIKTOK_CLIENT_KEY"],
        "client_secret": os.environ["TIKTOK_CLIENT_SECRET"],
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": os.environ["TIKTOK_REDIRECT_URI"],
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            TIKTOK_TOKEN_URL,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()

    return _validate_tokens(_read_data(response), needs_refresh=True)


async def get_tiktok_user(access_token: str) -> dict:
    """Retrieve the authorized TikTok account's basic profile."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            "https://open.tiktokapis.com/v2/user/info/",
            params={"fields": "open_id,display_name"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()

    data = _read_data(response)
    user = data.get("user")
    if not isinstance(user, dict) or not isinstance(user.get("open_id"), str):
        raise ValueError("TikTok user information is incomplete")
    return user
