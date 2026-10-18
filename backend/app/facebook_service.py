import httpx

GRAPH_API_URL = "https://graph.facebook.com/v26.0"


async def get_page_info(page_id: str, access_token: str) -> dict:
    """Get basic information about a Facebook Page."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{GRAPH_API_URL}/{page_id}",
            params={
                "fields": "id,name",
                "access_token": access_token,
            },
        )
        response.raise_for_status()
        return response.json()


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
