"""Facebook analytics workflows and provider error handling."""
import logging

import httpx
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorCode, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from app.features.facebook.publishing_provider import get_post_insights, get_post_reach
from app.token_service import decrypt_token
from . import repository

logger = logging.getLogger(__name__)


def _published_facebook_post(
    db: Session,
    draft_id: str,
    principal: AuthenticatedPrincipal,
    *,
    reach: bool,
):
    context = access.require_draft_permission(
        db, principal, draft_id, Permission.READ, include_deleted=True,
    )
    draft = repository.get_draft_scoped(
        db, context, draft_id, include_deleted=True,
    )
    if draft is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Draft not found")

    if draft.facebook_publish_status != "published" or not draft.facebook_post_id:
        detail = "Draft is not published" if reach else (
            "Draft has not been published to Facebook"
        )
        raise ApplicationError(ErrorKind.CONFLICT, detail)

    account = repository.get_connected_facebook_account_scoped(db, context)
    if account is None:
        detail = "Facebook not connected" if reach else (
            "Connect a Facebook Page to this business first"
        )
        raise ApplicationError(ErrorKind.CONFLICT, detail)

    return draft, decrypt_token(account.encrypted_access_token)


async def facebook_post_analytics(
    draft_id: str,
    *,
    db: Session,
    principal: AuthenticatedPrincipal,
) -> dict[str, object]:
    draft, access_token = _published_facebook_post(
        db,
        draft_id,
        principal,
        reach=False,
    )

    try:
        data = await get_post_insights(
            post_id=draft.facebook_post_id,
            access_token=access_token,
            media_type=draft.media_type,
        )
    except httpx.HTTPStatusError as exc:
        try:
            error_data = exc.response.json().get("error", {})
            if not isinstance(error_data, dict):
                error_data = {}
        except ValueError:
            error_data = {}

        logger.warning(
            "Facebook analytics error: status=%s, code=%s, type=%s",
            exc.response.status_code,
            error_data.get("code"),
            error_data.get("type"),
        )
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Unable to retrieve Facebook analytics",
            code=ErrorCode.FACEBOOK_PROVIDER_ERROR,
        ) from exc
    except httpx.RequestError as exc:
        logger.warning(
            "Facebook analytics connection error: %s",
            type(exc).__name__,
        )
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Facebook analytics service is unavailable",
            code=ErrorCode.FACEBOOK_PROVIDER_ERROR,
        ) from exc

    access.require_draft_permission(
        db, principal, draft_id, Permission.READ, include_deleted=True,
    )

    def metric_count(name: str) -> int | None:
        metric = data.get(name)
        if not isinstance(metric, dict):
            return None
        summary = metric.get("summary")
        if not isinstance(summary, dict):
            return None
        count = summary.get("total_count")
        return count if type(count) is int and count >= 0 else None

    shares = data.get("shares")
    raw_share_count = shares.get("count") if isinstance(shares, dict) else None
    share_count = (
        raw_share_count
        if type(raw_share_count) is int and raw_share_count >= 0
        else None
    )
    metric_status = data.get("metric_status")
    if not isinstance(metric_status, dict):
        metric_status = {}

    def status_for(name: str, value: int | None) -> str:
        status = metric_status.get(name)
        if status in {"available", "unavailable", "permission_required"}:
            return status
        return "available" if value is not None else "unavailable"

    return {
        "draft_id": draft.id,
        "platform": "facebook",
        "post_id": draft.facebook_post_id,
        "reactions": metric_count("reactions"),
        "comments": metric_count("comments"),
        "shares": share_count,
        "permalink_url": data.get("permalink_url"),
        "post_status": data.get("post_status", "available"),
        "authorization_status": data.get(
            "authorization_status", "connected",
        ),
        "metric_status": {
            "reactions": status_for("reactions", metric_count("reactions")),
            "comments": status_for("comments", metric_count("comments")),
            "shares": status_for("shares", share_count),
        },
    }


async def facebook_post_reach(
    draft_id: str,
    *,
    db: Session,
    principal: AuthenticatedPrincipal,
) -> dict[str, object]:
    draft, access_token = _published_facebook_post(
        db,
        draft_id,
        principal,
        reach=True,
    )

    try:
        data = await get_post_reach(draft.facebook_post_id, access_token)
        access.require_draft_permission(
            db, principal, draft_id, Permission.READ, include_deleted=True,
        )

        unique_media_viewers = next(
            (
                metric["values"][0]["value"]
                for metric in data.get("data", [])
                if metric.get("name") == "post_total_media_view_unique"
                and metric.get("period") == "lifetime"
                and metric.get("values")
            ),
            None,
        )
        return {"unique_media_viewers": unique_media_viewers}
    except httpx.HTTPStatusError as exc:
        try:
            error_data = exc.response.json().get("error", {})
            if not isinstance(error_data, dict):
                error_data = {}
        except ValueError:
            error_data = {}
        facebook_error = error_data
        logger.warning(
            "Facebook reach error: status=%s, code=%s, type=%s",
            exc.response.status_code,
            facebook_error.get("code"),
            facebook_error.get("type"),
        )
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Facebook did not return reach data",
        ) from exc
    except httpx.RequestError as exc:
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Facebook analytics service is unavailable",
        ) from exc
