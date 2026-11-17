"""Instagram Graph API image-publishing adapter."""

import httpx

from . import provider

_RATE_LIMIT_CODES = {4, 17, 32, 613, 80004}
_REQUEST_TIMEOUT = 20.0


class InstagramPublishingProviderError(Exception):
    def __init__(
        self,
        status_code: int | None,
        error_code: int | None,
    ) -> None:
        self.status_code = status_code
        self.error_code = error_code
        if error_code == 190:
            self.category = "credentials_expired"
        elif error_code in {10, 200}:
            self.category = "permission"
        elif status_code == 429 or error_code in _RATE_LIMIT_CODES:
            self.category = "rate_limited"
        elif status_code is not None and status_code >= 500:
            self.category = "provider_unavailable"
        else:
            self.category = "provider_rejected"
        super().__init__("Instagram Graph API request failed")


def _error_code(payload: object) -> int | None:
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if not isinstance(error, dict):
        return None
    code = error.get("code")
    return code if type(code) is int else None


async def _request(
    method: str,
    path: str,
    *,
    access_token: str,
    params: dict[str, str] | None = None,
    data: dict[str, str] | None = None,
) -> dict:
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        response = await client.request(
            method,
            f"{provider.GRAPH_API_URL}/{path}",
            params=params,
            data=data,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    try:
        payload = response.json()
    except (TypeError, ValueError):
        payload = None
    error_code = _error_code(payload)
    if response.is_error or error_code is not None:
        raise InstagramPublishingProviderError(
            response.status_code,
            error_code,
        )
    if not isinstance(payload, dict):
        raise InstagramPublishingProviderError(
            response.status_code,
            None,
        )
    return payload


async def create_image_container(
    instagram_account_id: str,
    access_token: str,
    image_url: str,
    caption: str,
) -> str:
    payload = await _request(
        "POST",
        f"{instagram_account_id}/media",
        access_token=access_token,
        data={
            "image_url": image_url,
            "caption": caption,
            "media_type": "IMAGE",
        },
    )
    container_id = payload.get("id")
    if not isinstance(container_id, str) or not container_id:
        raise InstagramPublishingProviderError(None, None)
    return container_id


async def get_container_status(
    container_id: str,
    access_token: str,
) -> str:
    payload = await _request(
        "GET",
        container_id,
        access_token=access_token,
        params={"fields": "status_code"},
    )
    status = payload.get("status_code")
    if not isinstance(status, str):
        raise InstagramPublishingProviderError(None, None)
    return status


async def publish_container(
    instagram_account_id: str,
    container_id: str,
    access_token: str,
) -> str:
    payload = await _request(
        "POST",
        f"{instagram_account_id}/media_publish",
        access_token=access_token,
        data={"creation_id": container_id},
    )
    media_id = payload.get("id")
    if not isinstance(media_id, str) or not media_id:
        raise InstagramPublishingProviderError(None, None)
    return media_id


async def get_media_permalink(
    media_id: str,
    access_token: str,
) -> str | None:
    payload = await _request(
        "GET",
        media_id,
        access_token=access_token,
        params={"fields": "permalink"},
    )
    permalink = payload.get("permalink")
    return permalink if isinstance(permalink, str) else None
