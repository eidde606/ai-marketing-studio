"""Facebook publishing and analytics provider adapter."""
import httpx
import logging
import re

logger = logging.getLogger(__name__)

GRAPH_API_URL = "https://graph.facebook.com/v26.0"


def _provider_error_fields(response: httpx.Response) -> tuple[str | None, str | None]:
    try:
        body = response.json()
    except (ValueError, TypeError):
        body = {}
    error = body.get("error", {}) if isinstance(body, dict) else {}
    if not isinstance(error, dict):
        error = {}
    code = error.get("code")
    if type(code) not in {int, str}:
        code = None
    elif not re.fullmatch(r"[A-Za-z0-9_.-]{1,40}", str(code)):
        code = None
    provider_type = error.get("type")
    if not isinstance(provider_type, str) or not re.fullmatch(
        r"[A-Za-z0-9_.-]{1,40}", provider_type,
    ):
        provider_type = None
    return (str(code) if code is not None else None, provider_type)


def _metric_count(name: str, value: object) -> int | None:
    if not isinstance(value, dict):
        return None
    if name == "shares":
        count = value.get("count")
    else:
        summary = value.get("summary")
        count = summary.get("total_count") if isinstance(summary, dict) else None
    return count if type(count) is int and count >= 0 else None


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
            },
            headers={"Authorization": f"Bearer {access_token}"},
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
                "published": "true",
            },
            headers={"Authorization": f"Bearer {access_token}"},
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
            if response.is_error:
                code, provider_type = _provider_error_fields(response)
                logger.warning(
                    "Facebook analytics field unavailable: status=%s code=%s type=%s",
                    response.status_code,
                    code,
                    provider_type,
                )
                if code == "190" or response.status_code == 401:
                    return {"_analytics_issue": "reauthorization_required"}
                if code in {"10", "200"} or response.status_code == 403:
                    return {"_analytics_issue": "permission_required"}
                if response.status_code == 400:
                    return {"_analytics_issue": "unavailable"}
            response.raise_for_status()
            return response.json()

        if media_type != "video":
            data = await fetch("id")
            issue = data.pop("_analytics_issue", None)
            metric_status = {
                "reactions": "unavailable",
                "comments": "unavailable",
                "shares": "unavailable",
            }
            authorization_status = "connected"
            if issue == "reauthorization_required":
                authorization_status = issue
            elif issue == "permission_required":
                authorization_status = issue
                metric_status = {name: issue for name in metric_status}
            elif issue:
                return {
                    "id": post_id,
                    "post_status": "unavailable",
                    "authorization_status": authorization_status,
                    "metric_status": metric_status,
                }

            if authorization_status != "connected":
                return {
                    "id": post_id,
                    "post_status": "unverified",
                    "authorization_status": authorization_status,
                    "metric_status": metric_status,
                }

            for field in (
                    "reactions.limit(0).summary(true)",
                    "comments.limit(0).summary(true)",
                    "shares",
                    "permalink_url",
            ):
                result = await fetch(f"id,{field}")
                issue = result.pop("_analytics_issue", None)
                metric = (
                    "reactions" if field.startswith("reactions")
                    else "comments" if field.startswith("comments")
                    else "shares" if field == "shares"
                    else None
                )
                if issue == "reauthorization_required":
                    authorization_status = issue
                    break
                if issue == "permission_required":
                    authorization_status = issue
                    if metric:
                        metric_status[metric] = issue
                    continue
                if issue:
                    continue
                data.update(result)
                if metric:
                    if _metric_count(metric, result.get(metric)) is not None:
                        metric_status[metric] = "available"

            if authorization_status == "reauthorization_required":
                metric_status = {
                    name: "unavailable" for name in metric_status
                }
            return {
                **data,
                "post_status": "available",
                "authorization_status": authorization_status,
                "metric_status": metric_status,
            }

        data = await fetch("id")
        issue = data.pop("_analytics_issue", None)
        metric_status = {
            "reactions": "unavailable",
            "comments": "unavailable",
            "shares": "unavailable",
        }
        authorization_status = "connected"
        if issue in {"reauthorization_required", "permission_required"}:
            authorization_status = issue
            if issue == "permission_required":
                metric_status = {
                    name: issue for name in metric_status
                }
            return {
                "id": post_id,
                "post_status": "unverified",
                "authorization_status": authorization_status,
                "metric_status": metric_status,
            }
        if issue:
            return {
                "id": post_id,
                "post_status": "unavailable",
                "authorization_status": authorization_status,
                "metric_status": metric_status,
            }

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
                code, provider_type = _provider_error_fields(response)
                logger.warning(
                    "Facebook provider error: status=%s code=%s type=%s",
                    response.status_code,
                    code,
                    provider_type,
                )
                if code == "190" or response.status_code == 401:
                    authorization_status = "reauthorization_required"
                    break
                if code in {"10", "200"} or response.status_code == 403:
                    authorization_status = "permission_required"
                    metric_status[key] = "permission_required"
                    continue
                if response.status_code == 400:
                    continue
                response.raise_for_status()
                continue

            data[key] = response.json()
            if _metric_count(key, data[key]) is not None:
                metric_status[key] = "available"

        if authorization_status != "reauthorization_required":
            video_details = await fetch("id,post_id")
            issue = video_details.pop("_analytics_issue", None)
            if issue == "reauthorization_required":
                authorization_status = issue
            elif issue == "permission_required":
                authorization_status = issue
                metric_status["reactions"] = issue
            elif issue:
                pass
            else:
                data.update(video_details)
            feed_post_id = video_details.get("post_id")

            if feed_post_id and authorization_status != "reauthorization_required":
                response = await client.get(
                    f"{GRAPH_API_URL}/{feed_post_id}",
                    params={
                        "fields": "reactions.limit(0).summary(true)",
                    },
                    headers=headers,
                )
                if response.is_error:
                    code, provider_type = _provider_error_fields(response)
                    logger.warning(
                        "Facebook provider error: status=%s code=%s type=%s",
                        response.status_code,
                        code,
                        provider_type,
                    )
                    if code == "190" or response.status_code == 401:
                        authorization_status = "reauthorization_required"
                    elif code in {"10", "200"} or response.status_code == 403:
                        authorization_status = "permission_required"
                        metric_status["reactions"] = "permission_required"
                    elif response.status_code != 400:
                        response.raise_for_status()
                else:
                    reactions = response.json().get("reactions")
                    if reactions is not None:
                        data["reactions"] = reactions
                        if _metric_count("reactions", reactions) is not None:
                            metric_status["reactions"] = "available"

        data["post_status"] = "available"
        data["authorization_status"] = authorization_status
        data["metric_status"] = metric_status
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
            },
            headers={"Authorization": f"Bearer {access_token}"},
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
