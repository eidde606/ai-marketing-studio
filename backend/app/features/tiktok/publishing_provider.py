"""TikTok publishing API adapter."""
import httpx

TIKTOK_API_URL = "https://open.tiktokapis.com/v2"


async def get_creator_info(access_token: str) -> dict:
    """Retrieve TikTok's available publishing settings."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            f"{TIKTOK_API_URL}/post/publish/creator_info/query/",
            headers={
                "Authorization": f"******",
                "Content-Type": "application/json",
            },
            json={},
        )
        response.raise_for_status()

    result = response.json()
    if result.get("error", {}).get("code") != "ok":
        raise ValueError("TikTok creator information request failed")
    return result["data"]


async def publish_tiktok_video(
    access_token: str,
    video_url: str,
    caption: str,
    privacy_level: str,
    disable_comment: bool = False,
    disable_duet: bool = False,
    disable_stitch: bool = False,
) -> dict:
    payload = {
        "post_info": {
            "title": caption[:2200],
            "privacy_level": privacy_level,
            "disable_comment": disable_comment,
            "disable_duet": disable_duet,
            "disable_stitch": disable_stitch,
        },
        "source_info": {
            "source": "PULL_FROM_URL",
            "video_url": video_url,
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{TIKTOK_API_URL}/post/publish/video/init/",
            headers={
                "Authorization": f"******",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()

    result = response.json()
    if result.get("error", {}).get("code") != "ok":
        raise ValueError("TikTok rejected the video publishing request")
    return result["data"]


async def publish_tiktok_video_file(
    access_token: str,
    video_bytes: bytes,
    caption: str,
    privacy_level: str,
    disable_comment: bool = False,
    disable_duet: bool = False,
    disable_stitch: bool = False,
) -> dict:
    """Directly upload one MP4 chunk (5–64 MiB) to TikTok."""
    size = len(video_bytes)
    if not 5 * 1024 * 1024 <= size <= 64 * 1024 * 1024:
        raise ValueError("TikTok single-chunk upload requires 5–64 MiB")
    payload = {
        "post_info": {
            "title": caption[:2200],
            "privacy_level": privacy_level,
            "disable_comment": disable_comment,
            "disable_duet": disable_duet,
            "disable_stitch": disable_stitch,
        },
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": size,
            "chunk_size": size,
            "total_chunk_count": 1,
        },
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{TIKTOK_API_URL}/post/publish/video/init/",
            headers={"Authorization": f"******"},
            json=payload,
        )
        if response.is_error:
            raise ValueError(
                f"TikTok video initialization failed "
                f"(HTTP {response.status_code}): "
                f"{response.text[:2000]}"
            )
        result = response.json()
        if result.get("error", {}).get("code") != "ok":
            raise ValueError("TikTok rejected video initialization")
        data = result["data"]
        upload_response = await client.put(
            data["upload_url"],
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(size),
                "Content-Range": f"bytes 0-{size - 1}/{size}",
            },
            content=video_bytes,
        )
        upload_response.raise_for_status()
    return {"publish_id": data["publish_id"]}


async def publish_tiktok_photo(
    access_token: str,
    image_url: str,
    caption: str,
    privacy_level: str,
    disable_comment: bool = False,
) -> dict:
    payload = {
        "post_info": {
            "title": caption[:90],
            "description": caption[:4000],
            "privacy_level": privacy_level,
            "disable_comment": disable_comment,
            "auto_add_music": True,
        },
        "source_info": {
            "source": "PULL_FROM_URL",
            "photo_cover_index": 0,
            "photo_images": [image_url],
        },
        "post_mode": "DIRECT_POST",
        "media_type": "PHOTO",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{TIKTOK_API_URL}/post/publish/content/init/",
            headers={
                "Authorization": f"******",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()

    result = response.json()
    if result.get("error", {}).get("code") != "ok":
        raise ValueError("TikTok rejected the photo publishing request")
    return result["data"]


async def get_tiktok_publish_status(
    access_token: str,
    publish_id: str,
) -> dict:
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            f"{TIKTOK_API_URL}/post/publish/status/fetch/",
            headers={
                "Authorization": f"******",
                "Content-Type": "application/json",
            },
            json={"publish_id": publish_id},
        )
        response.raise_for_status()

    result = response.json()
    if result.get("error", {}).get("code") != "ok":
        raise ValueError("TikTok publication status request failed")
    return result["data"]
