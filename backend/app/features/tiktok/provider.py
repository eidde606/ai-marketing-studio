"""TikTok OAuth provider calls."""
import os
from urllib.parse import urlencode

import httpx

TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/"
TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"

SCOPES = [
    "user.info.basic",
    "video.publish",
]


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

    result = response.json()

    if "access_token" not in result or "refresh_token" not in result:
        raise ValueError("TikTok token refresh failed")

    return result


def get_tiktok_login_url(state: str) -> str:
    """Build the TikTok authorization URL."""
    client_key = os.environ["TIKTOK_CLIENT_KEY"]
    redirect_uri = os.environ["TIKTOK_REDIRECT_URI"]
    params = {
        "client_key": client_key,
        "response_type": "code",
        "scope": ",".join(SCOPES),
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

    result = response.json()

    if "access_token" not in result:
        raise ValueError("TikTok did not return an access token")

    return result


async def get_tiktok_user(access_token: str) -> dict:
    """Retrieve the authorized TikTok account's basic profile."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            "https://open.tiktokapis.com/v2/user/info/",
            params={"fields": "open_id,display_name"},
            headers={"Authorization": f"******"},
        )
        response.raise_for_status()

    payload = response.json()

    if payload.get("error", {}).get("code") != "ok":
        raise ValueError("TikTok user lookup failed")

    return payload["data"]["user"]
