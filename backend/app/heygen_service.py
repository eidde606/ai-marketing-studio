import os

import httpx
from dotenv import load_dotenv
from urllib.parse import urlparse

load_dotenv(".env")

HEYGEN_API_URL = "https://api.heygen.com"


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


def generate_video(avatar_id: str, voice_id: str, script: str) -> dict:
    headers = {
        "X-Api-Key": os.environ["HEYGEN_API_KEY"],
        "Content-Type": "application/json",
    }

    payload = {
        "type": "avatar",
        "avatar_id": avatar_id,
        "script": script,
        "voice_id": voice_id,
        "aspect_ratio": "9:16",
        "resolution": "1080p",
    }

    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            f"{HEYGEN_API_URL}/v3/videos",
            headers=headers,
            json=payload,
        )

        if response.is_error:
            print("HeyGen error:", response.status_code, response.text)

        response.raise_for_status()
        result = response.json()

    if result.get("error"):
        raise ValueError(str(result["error"]))

    return result.get("data", result)


def get_video_status(video_id: str) -> dict:
    headers = {"X-Api-Key": os.environ["HEYGEN_API_KEY"]}

    with httpx.Client(timeout=30.0) as client:
        response = client.get(
            f"{HEYGEN_API_URL}/v3/videos/{video_id}",
            headers=headers,
        )
        response.raise_for_status()
        result = response.json()

    if result.get("error"):
        raise ValueError(str(result["error"]))

    return result["data"]


def download_generated_video(video_url: str) -> bytes:
    """Download a completed HeyGen video with basic URL and size checks."""

    parsed = urlparse(video_url)

    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Invalid video download URL.")

    # Only allow HeyGen's documented video delivery hosts.
    allowed_hosts = {
        "resource2.heygen.ai",
        "files2.heygen.ai",
    }

    if parsed.hostname not in allowed_hosts:
        raise ValueError("Untrusted HeyGen video URL.")

    max_size = 100 * 1024 * 1024
    chunks = []
    total_size = 0

    with httpx.Client(timeout=120.0, follow_redirects=False) as client:
        with client.stream("GET", video_url) as response:
            response.raise_for_status()

            for chunk in response.iter_bytes():
                total_size += len(chunk)

                if total_size > max_size:
                    raise ValueError("Video exceeds the 100 MB limit.")

                chunks.append(chunk)

    return b"".join(chunks)


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
