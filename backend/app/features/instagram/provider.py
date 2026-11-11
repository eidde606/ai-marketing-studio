import os
from urllib.parse import urlencode

import httpx

GRAPH_API_URL = "https://graph.facebook.com/v27.0"
LOGIN_URL = "https://www.facebook.com/v27.0/dialog/oauth"

REQUIRED_PERMISSIONS = (
    "instagram_basic",
    "instagram_content_publish",
    "pages_show_list",
    "pages_read_engagement",
)


class MetaAPIError(Exception):
    def __init__(self, status_code: int, error_code: int | None = None):
        self.status_code = status_code
        self.error_code = error_code
        super().__init__("Meta API request failed")


class TokenExchangeError(ValueError):
    def __init__(self, reason_code: str):
        self.reason_code = reason_code
        super().__init__(reason_code)


def build_login_url(state: str) -> str:
    app_id = os.getenv("FACEBOOK_APP_ID")
    config_id = os.getenv("INSTAGRAM_CONFIG_ID")
    redirect_uri = os.getenv("INSTAGRAM_REDIRECT_URI")
    if not app_id or not config_id or not redirect_uri:
        raise RuntimeError("Instagram OAuth is not configured")

    return f"{LOGIN_URL}?{urlencode({
        'client_id': app_id,
        'redirect_uri': redirect_uri,
        'state': state,
        'response_type': 'code',
        'config_id': config_id,
    })}"


def _raise_meta_error(response: httpx.Response) -> None:
    if response.is_error:
        try:
            code = response.json().get("error", {}).get("code")
        except (ValueError, AttributeError):
            code = None
        raise MetaAPIError(response.status_code, code if isinstance(code, int) else None)


async def exchange_code_for_long_lived_token(code: str) -> tuple[str, int]:
    app_id = os.environ["FACEBOOK_APP_ID"]
    app_secret = os.environ["FACEBOOK_APP_SECRET"]
    redirect_uri = os.environ["INSTAGRAM_REDIRECT_URI"]
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{GRAPH_API_URL}/oauth/access_token",
            params={
                "client_id": app_id,
                "client_secret": app_secret,
                "redirect_uri": redirect_uri,
                "code": code,
            },
        )
        _raise_meta_error(response)
        short_payload = _parse_token_response(response, "short")
        short_token = _read_access_token(short_payload, "short")
        response = await client.get(
            f"{GRAPH_API_URL}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": app_id,
                "client_secret": app_secret,
                "fb_exchange_token": short_token,
            },
        )
        _raise_meta_error(response)
        payload = _parse_token_response(response, "long")

    token = _read_access_token(payload, "long")
    expires_in = payload.get("expires_in")
    if "expires_in" not in payload:
        raise TokenExchangeError("long_token_missing_expires_in")
    if isinstance(expires_in, bool) or not isinstance(expires_in, int):
        raise TokenExchangeError("long_token_invalid_expires_in_type")
    if expires_in <= 0:
        raise TokenExchangeError("long_token_invalid_expires_in_value")
    return token, expires_in


def _parse_token_response(response: httpx.Response, stage: str) -> dict:
    try:
        payload = response.json()
    except ValueError as exc:
        raise TokenExchangeError(f"{stage}_token_invalid_json") from exc
    if not isinstance(payload, dict):
        raise TokenExchangeError(f"{stage}_token_invalid_response")
    return payload


def _read_access_token(payload: dict, stage: str) -> str:
    if "access_token" not in payload:
        raise TokenExchangeError(f"{stage}_token_missing_access_token")
    token = payload["access_token"]
    if not isinstance(token, str):
        raise TokenExchangeError(f"{stage}_token_invalid_access_token_type")
    if not token:
        raise TokenExchangeError(f"{stage}_token_invalid_access_token_value")
    return token


async def get_granted_permissions(access_token: str) -> set[str]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{GRAPH_API_URL}/me/permissions",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        _raise_meta_error(response)
        payload = response.json()

    data = payload.get("data")
    if not isinstance(data, list):
        raise ValueError("Meta returned an invalid permissions response")
    return {
        item["permission"]
        for item in data
        if isinstance(item, dict)
        and item.get("status") == "granted"
        and isinstance(item.get("permission"), str)
    }


async def get_managed_pages(access_token: str) -> list[dict]:
    pages: list[dict] = []
    after: str | None = None
    async with httpx.AsyncClient(timeout=15.0) as client:
        while True:
            params: dict[str, str | int] = {
                "fields": "id,name",
                "limit": 100,
            }
            if after:
                params["after"] = after
            response = await client.get(
                f"{GRAPH_API_URL}/me/accounts",
                params=params,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            _raise_meta_error(response)
            payload = response.json()
            data = payload.get("data")
            if not isinstance(data, list):
                raise ValueError("Meta returned an invalid Page list")
            pages.extend(page for page in data if isinstance(page, dict))
            after = payload.get("paging", {}).get("cursors", {}).get("after")
            if not after or not payload.get("paging", {}).get("next"):
                return pages


async def get_page_instagram_account(
    access_token: str,
    page_id: str,
) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{GRAPH_API_URL}/{page_id}",
            params={"fields": "id,instagram_business_account{id,username}"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        _raise_meta_error(response)
        payload = response.json()

    if not isinstance(payload, dict):
        raise ValueError("Meta returned an invalid Page response")
    return payload
