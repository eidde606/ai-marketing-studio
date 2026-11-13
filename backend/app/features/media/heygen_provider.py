"""HeyGen HTTP adapter for assets and video lifecycle operations."""
import os
import time
from urllib.parse import urljoin, urlparse
import httpx
from dotenv import load_dotenv

load_dotenv(".env")

HEYGEN_API_URL = "https://api.heygen.com"
HEYGEN_VIDEO_HOSTS = frozenset({
    "files.heygen.ai",
    "resource.heygen.ai",
    "files2.heygen.ai",
    "resource2.heygen.ai",
})
MAX_GENERATED_VIDEO_SIZE = 100 * 1024 * 1024
MAX_GENERATED_VIDEO_DOWNLOAD_SECONDS = 300


class HeyGenConfigurationError(RuntimeError):
    pass


def _heygen_headers() -> dict[str, str]:
    api_key = os.getenv("HEYGEN_API_KEY")
    if not api_key:
        raise HeyGenConfigurationError("HEYGEN_API_KEY is not configured.")
    return {
        "X-Api-Key": api_key,
        "Accept": "application/json",
    }


def _list_heygen_resources(
    endpoint: str,
    *,
    limit: int,
    token: str | None,
    filters: dict[str, str | None],
) -> dict:
    params = {"limit": limit}
    params.update({key: value for key, value in filters.items() if value})
    if token:
        params["token"] = token

    with httpx.Client(timeout=30.0) as client:
        response = client.get(
            f"{HEYGEN_API_URL}{endpoint}",
            headers=_heygen_headers(),
            params=params,
        )
        response.raise_for_status()
        result = response.json()

    if not isinstance(result, dict):
        raise ValueError("HeyGen returned an invalid list response.")
    if result.get("error"):
        raise ValueError(f"HeyGen API error: {result['error']}")

    if not isinstance(result.get("data"), list):
        raise ValueError("HeyGen returned an invalid list response.")

    return {
        "data": result["data"],
        "has_more": result.get("has_more", False),
        "next_token": result.get("next_token"),
    }


def list_avatar_looks(
    *,
    avatar_type: str | None = None,
    ownership: str | None = None,
    limit: int = 20,
    token: str | None = None,
) -> dict:
    return _list_heygen_resources(
        "/v3/avatars/looks",
        limit=limit,
        token=token,
        filters={"avatar_type": avatar_type, "ownership": ownership},
    )


def get_available_avatar_looks() -> list:
    return list_avatar_looks()["data"]


class HeyGenProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        code: str | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class HeyGenRequestInProgress(HeyGenProviderError):
    pass


def _error_code(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    error = body.get("error") if isinstance(body, dict) else None
    return error.get("code") if isinstance(error, dict) else None


def generate_video(
    avatar_id: str,
    voice_id: str,
    script: str,
    *,
    idempotency_key: str,
    callback_id: str | None = None,
    aspect_ratio: str = "9:16",
    resolution: str = "1080p",
) -> dict:
    headers = {
        **_heygen_headers(),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
    }
    payload = {
        "type": "avatar",
        "avatar_id": avatar_id,
        "script": script,
        "voice_id": voice_id,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
    }
    if callback_id is not None:
        payload["callback_id"] = callback_id

    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            f"{HEYGEN_API_URL}/v3/videos",
            headers=headers,
            json=payload,
        )

        if response.status_code == 409:
            raise HeyGenRequestInProgress(
                "HeyGen is still processing this idempotent request.",
                status_code=409,
                code=_error_code(response) or "request_in_progress",
            )

        if response.is_error:
            raise HeyGenProviderError(
                "HeyGen rejected the video generation request.",
                status_code=response.status_code,
                code=_error_code(response),
            )
        result = response.json()

    if not isinstance(result, dict):
        raise ValueError("HeyGen returned an invalid generation response.")
    if result.get("error"):
        error = result["error"]
        raise HeyGenProviderError(
            "HeyGen rejected the video generation request.",
            code=error.get("code") if isinstance(error, dict) else None,
        )

    data = result.get("data")
    if not isinstance(data, dict):
        raise ValueError("HeyGen returned an invalid generation response.")
    return data


def get_video_status(video_id: str) -> dict:
    with httpx.Client(timeout=30.0) as client:
        response = client.get(
            f"{HEYGEN_API_URL}/v3/videos/{video_id}",
            headers=_heygen_headers(),
        )
        response.raise_for_status()
        result = response.json()

    if not isinstance(result, dict):
        raise ValueError("HeyGen returned an invalid status response.")
    if result.get("error"):
        raise ValueError(str(result["error"]))

    data = result.get("data")
    if not isinstance(data, dict):
        raise ValueError("HeyGen returned an invalid status response.")
    return data


def download_generated_video(video_url: str) -> bytes:
    """Download a HeyGen MP4 without following untrusted redirects."""

    def validate_url(url: str) -> None:
        parsed = urlparse(url)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in HEYGEN_VIDEO_HOSTS
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in (None, 443)
        ):
            raise ValueError("Untrusted HeyGen video URL.")

    current_url = video_url
    deadline = time.monotonic() + MAX_GENERATED_VIDEO_DOWNLOAD_SECONDS
    timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        for redirect_count in range(4):
            if time.monotonic() >= deadline:
                raise ValueError("Video download exceeded the time limit.")
            validate_url(current_url)
            with client.stream("GET", current_url) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location or redirect_count == 3:
                        raise ValueError("Invalid or excessive video redirects.")
                    current_url = urljoin(current_url, location)
                    continue

                response.raise_for_status()
                content_length = response.headers.get("content-length")
                if content_length:
                    try:
                        declared_size = int(content_length)
                    except ValueError as exc:
                        raise ValueError("Invalid video content length.") from exc
                    if declared_size > MAX_GENERATED_VIDEO_SIZE:
                        raise ValueError("Video exceeds the 100 MB limit.")

                chunks = []
                total_size = 0
                for chunk in response.iter_bytes():
                    if time.monotonic() >= deadline:
                        raise ValueError("Video download exceeded the time limit.")
                    total_size += len(chunk)
                    if total_size > MAX_GENERATED_VIDEO_SIZE:
                        raise ValueError("Video exceeds the 100 MB limit.")
                    chunks.append(chunk)
                return b"".join(chunks)

    raise ValueError("Unable to download HeyGen video.")


def get_available_voices() -> list:
    voices = []
    token = None
    seen_tokens = set()

    while True:
        page = list_voices(voice_type="private", limit=20, token=token)
        voices.extend(page["data"])
        if not page["has_more"] or not page["next_token"]:
            return voices
        if page["next_token"] in seen_tokens:
            raise ValueError("HeyGen repeated a voice pagination cursor.")
        seen_tokens.add(page["next_token"])
        token = page["next_token"]


def list_voices(
    *,
    voice_type: str = "private",
    limit: int = 20,
    token: str | None = None,
) -> dict:
    return _list_heygen_resources(
        "/v3/models/audio/voices",
        limit=limit,
        token=token,
        filters={"type": voice_type},
    )
