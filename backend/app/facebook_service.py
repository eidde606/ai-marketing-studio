import httpx
import logging

from app.features.facebook.provider import get_page_info


logger = logging.getLogger(__name__)

GRAPH_API_URL = "https://graph.facebook.com/v26.0"

async def publish_text_post(
        page_id: str,
        access_token: str,
        message: str,
) -> dict:
    """Publish a text post to a Facebook Page."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{GRAPH_API_URL}/{page_id}/feed",
            data={
                "message": message,
                "access_token": access_token,
            },
        )
        response.raise_for_status()
        return response.json()


async def publish_image_post(
        page_id: str,
        access_token: str,
        message: str,
        image_bytes: bytes,
) -> dict:
    """Publish a stored marketing image and caption together."""
    if not image_bytes:
        raise ValueError("Cannot publish an empty image")

    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        filename, content_type = "marketing.png", "image/png"
    elif image_bytes.startswith(b"\xff\xd8\xff"):
        filename, content_type = "marketing.jpg", "image/jpeg"
    elif image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        filename, content_type = "marketing.webp", "image/webp"
    else:
        raise ValueError("Unsupported image data")

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{GRAPH_API_URL}/{page_id}/photos",
            data={
                "message": message,
                "access_token": access_token,
                "published": "true",
            },
            files={"source": (filename, image_bytes, content_type)},
        )
        response.raise_for_status()
        return response.json()


async def publish_video_post(
        page_id: str,
        access_token: str,
        message: str,
        video_url: str,
) -> dict:
    """Submit a privately stored MP4 to a Facebook Page."""

    if not video_url.startswith("https://"):
        raise ValueError("A secure video URL is required")

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{GRAPH_API_URL}/{page_id}/videos",
            data={
                "file_url": video_url,
                "description": message,
                "published": "true",
            },
            headers={
                "Authorization": f"Bearer {access_token}",
            },
        )
        response.raise_for_status()
        return response.json()


async def get_post_insights(
        post_id: str,
        access_token: str,
        media_type: str = "text",
) -> dict:
    """Retrieve Facebook engagement for posts and videos."""

    headers = {
        "Authorization": f"Bearer {access_token}",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:

        async def fetch(fields: str) -> dict:
            response = await client.get(
                f"{GRAPH_API_URL}/{post_id}",
                params={"fields": fields},
                headers=headers,
            )
            response.raise_for_status()
            return response.json()

        if media_type != "video":
            # Regular Facebook feed post
            data = await fetch("id")

            for field in (
                    "reactions.limit(0).summary(true)",
                    "comments.limit(0).summary(true)",
                    "shares",
                    "permalink_url",
            ):
                try:
                    result = await fetch(f"id,{field}")
                    data.update(result)
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code != 400:
                        raise
                    # This field is unavailable for this object.
                    logger.warning(
                        "Facebook field unavailable: %s", field
                    )

            return data

        # Facebook video object
        data = await fetch("id")

        # Keep the existing working video comments and likes.
        for edge, key in (
                ("likes", "reactions"),
                ("comments", "comments"),
        ):
            response = await client.get(
                f"{GRAPH_API_URL}/{post_id}/{edge}",
                params={
                    "limit": 0,
                    "summary": "true",
                },
                headers=headers,
            )

            if response.is_error:
                logger.warning(
                    "Facebook video %s error: %s",
                    edge,
                    response.text,
                )
                if response.status_code != 400:
                    response.raise_for_status()
                continue

            data[key] = response.json()

        # Try to resolve the video's associated Facebook feed post.
        try:
            video_details = await fetch("id,post_id")
            feed_post_id = video_details.get("post_id")

            if feed_post_id:
                response = await client.get(
                    f"{GRAPH_API_URL}/{feed_post_id}",
                    params={
                        "fields": "reactions.limit(0).summary(true)",
                    },
                    headers=headers,
                )
                response.raise_for_status()

                reactions = response.json().get("reactions")
                if reactions is not None:
                    data["reactions"] = reactions

        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Video feed-post reactions unavailable: %s",
                exc.response.text,
            )

        return data


async def get_post_reach(
        post_id: str,
        access_token: str,
) -> dict:
    """Retrieve unique reach for a Facebook post, if available."""

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            f"{GRAPH_API_URL}/{post_id}/insights",
            params={
                "metric": "post_total_media_view_unique",
                "access_token": access_token,
            },
        )

        response.raise_for_status()
        return response.json()


async def get_video_status(
        video_id: str,
        access_token: str,
) -> dict:
    """Check Facebook's processing and publishing status for a video."""

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            f"{GRAPH_API_URL}/{video_id}",
            params={
                "fields": "id,status",
            },
            headers={
                "Authorization": f"Bearer {access_token}",
            },
        )
        response.raise_for_status()
        return response.json()
