import os

import httpx
from dotenv import load_dotenv

load_dotenv(".env")

HEYGEN_API_URL = "https://api.heygen.com"


def get_available_avatar_looks() -> list:
    headers = {
        "X-Api-Key": os.environ["HEYGEN_API_KEY"],
        "Accept": "application/json",
    }

    with httpx.Client(timeout=30.0) as client:
        response = client.get(
            f"{HEYGEN_API_URL}/v3/avatars/looks",
            headers=headers,
        )
        response.raise_for_status()
        result = response.json()

    if result.get("error"):
        raise ValueError(str(result["error"]))

    for look in result.get("data", []):
        if "eddie" in look.get("name", "").lower():
            print("EDDIE LOOK:", look, flush=True)

    return result.get("data", [])


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


def get_available_voices() -> list:
    api_key = os.getenv("HEYGEN_API_KEY")

    if not api_key:
        raise ValueError("HEYGEN_API_KEY is not configured.")

    headers = {
        "X-Api-Key": api_key,
        "Accept": "application/json",
    }

    with httpx.Client(timeout=30.0) as client:
        response = client.get(
            f"{HEYGEN_API_URL}/v2/voices",
            headers=headers,
        )
        response.raise_for_status()
        result = response.json()

    if result.get("error"):
        raise ValueError(f"HeyGen API error: {result['error']}")

    return result.get("data", {}).get("voices", [])
