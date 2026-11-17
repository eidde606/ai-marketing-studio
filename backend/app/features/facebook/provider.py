"""Facebook OAuth and Page lookup API adapter."""
import os
from urllib.parse import urlencode, urlsplit

import httpx

GRAPH_API_URL = "https://graph.facebook.com/v26.0"
FACEBOOK_LOGIN_URL = "https://www.facebook.com/v26.0/dialog/oauth"

FACEBOOK_SCOPES = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
]


def callback_uri() -> str:
    redirect_uri = os.getenv("FACEBOOK_REDIRECT_URI", "").strip()
    parsed = urlsplit(redirect_uri)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or (
            parsed.scheme == "http"
            and parsed.hostname not in ("localhost", "127.0.0.1")
        )
    ):
        raise RuntimeError("Facebook OAuth redirect URI is not configured")
    return redirect_uri


async def get_page_info(page_id: str, access_token: str) -> dict:
    """Get basic information about a Facebook Page."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{GRAPH_API_URL}/{page_id}",
            params={
                "fields": "id,name",
            },
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        return response.json()


def get_facebook_login_url(state: str) -> str:
    """Build the Facebook authorization URL."""
    app_id = os.getenv("FACEBOOK_APP_ID")
    config_id = os.getenv("FACEBOOK_CONFIG_ID")

    if not app_id or not config_id:
        raise RuntimeError("Facebook OAuth is not configured")

    params = {
        "client_id": app_id,
        "redirect_uri": callback_uri(),
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
        "redirect_uri": callback_uri(),
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
                    }
                    if url == f"{GRAPH_API_URL}/me/accounts"
                    else None
                ),
                headers={"Authorization": f"Bearer {user_token}"},
            )

            response.raise_for_status()

            data = response.json()

            pages.extend(data.get("data", []))

            url = data.get("paging", {}).get("next")

    return pages
