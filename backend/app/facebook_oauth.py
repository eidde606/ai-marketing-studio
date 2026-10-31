import os
from urllib.parse import urlencode

import httpx

GRAPH_API_URL = "https://graph.facebook.com/v26.0"
FACEBOOK_LOGIN_URL = "https://www.facebook.com/v26.0/dialog/oauth"

REDIRECT_URI = (
    "https://ai-marketing-studio-api-ha8a.onrender.com" "/auth/facebook/callback"
)

FACEBOOK_SCOPES = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
]


def get_facebook_login_url(state: str) -> str:
    """Build the Facebook authorization URL."""

    app_id = os.getenv("FACEBOOK_APP_ID")
    config_id = os.getenv("FACEBOOK_CONFIG_ID")

    if not app_id or not config_id:
        raise RuntimeError("Facebook OAuth is not configured")

    params = {
        "client_id": app_id,
        "redirect_uri": REDIRECT_URI,
        "state": state,
        "response_type": "code",
        "config_id": config_id,
    }

    return f"{FACEBOOK_LOGIN_URL}?{urlencode(params)}"


async def exchange_code_for_token(code: str) -> str:
    """Exchange an OAuth authorization code for a user token."""

    params = {
        "client_id": os.environ["FACEBOOK_APP_ID"],
        "client_secret": os.environ["FACEBOOK_APP_SECRET"],
        "redirect_uri": REDIRECT_URI,
        "code": code,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{GRAPH_API_URL}/oauth/access_token",
            params=params,
        )
        response.raise_for_status()

    return response.json()["access_token"]


async def get_long_lived_user_token(short_lived_token: str) -> str:
    """Exchange a short-lived user token for a longer-lived token."""

    params = {
        "grant_type": "fb_exchange_token",
        "client_id": os.environ["FACEBOOK_APP_ID"],
        "client_secret": os.environ["FACEBOOK_APP_SECRET"],
        "fb_exchange_token": short_lived_token,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{GRAPH_API_URL}/oauth/access_token",
            params=params,
        )
        response.raise_for_status()

    return response.json()["access_token"]


async def get_managed_pages(user_token: str) -> list[dict]:
    """Retrieve Facebook Pages available to the authorized user."""

    pages = []
    url = f"{GRAPH_API_URL}/me/accounts"

    async with httpx.AsyncClient(timeout=15.0) as client:
        while url:
            response = await client.get(
                url,
                params=(
                    {
                        "fields": "id,name,access_token,tasks",
                        "limit": 100,
                        "access_token": user_token,
                    }
                    if url == f"{GRAPH_API_URL}/me/accounts"
                    else None
                ),
            )

            response.raise_for_status()

            data = response.json()

            pages.extend(data.get("data", []))

            url = data.get("paging", {}).get("next")

    return pages
