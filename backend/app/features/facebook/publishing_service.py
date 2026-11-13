"""Facebook draft publication and video-verification workflows."""
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from .publishing_provider import (
    get_video_status,
    publish_image_post,
    publish_text_post,
    publish_video_post,
)
from app.storage_service import download_marketing_image, get_marketing_image_url
from app.token_service import decrypt_token
from app.transactions import Transactions
from . import repository

logger = logging.getLogger(__name__)


def _failure(kind: ErrorKind, detail: str) -> ApplicationError:
    return ApplicationError(kind, detail)


def _save_status(db: Session, draft_id: str, status: str) -> None:
    draft = repository.get_draft(db, draft_id, include_deleted=True)
    if draft is not None:
        draft.facebook_publish_status = status
        Transactions(db).commit()


async def publish_draft(draft_id: str, *, db: Session) -> dict[str, str]:
    draft = repository.get_draft(db, draft_id)
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")

    account = repository.get_connected_page(db, draft.business_id)
    if account is None:
        raise _failure(
            ErrorKind.CONFLICT,
            "Connect a Facebook Page to this business first",
        )

    page_id = account.platform_account_id
    access_token = decrypt_token(account.encrypted_access_token)
    transactions = Transactions(db)
    if not repository.claim_publication(db, draft_id):
        transactions.rollback()
        raise _failure(
            ErrorKind.CONFLICT,
            "Draft is not eligible for Facebook publishing",
        )
    transactions.commit()

    draft = repository.get_draft(db, draft_id, include_deleted=True)
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")

    if draft.media_type == "video":
        if draft.video_status != "completed" or not draft.video_url:
            draft.facebook_publish_status = "not_published"
            transactions.commit()
            raise _failure(ErrorKind.CONFLICT, "A completed MP4 is required")

        expected_prefix = f"businesses/{draft.business_id}/"
        if (
            not draft.video_url.startswith(expected_prefix)
            or not draft.video_url.endswith(".mp4")
        ):
            draft.facebook_publish_status = "not_published"
            transactions.commit()
            raise _failure(ErrorKind.INVALID_INPUT, "Invalid video storage path")

        try:
            signed_url = get_marketing_image_url(
                draft.video_url,
                expires_in=3600,
            )
            response = await publish_video_post(
                page_id=page_id,
                access_token=access_token,
                message=draft.caption,
                video_url=signed_url,
            )
            video_id = response.get("id")
            if not video_id:
                raise ValueError("Facebook returned no video ID")

            draft.facebook_post_id = str(video_id)
            draft.facebook_publish_status = "needs_review"
            transactions.commit()
            return {
                "status": "processing",
                "facebook_post_id": str(video_id),
            }
        except httpx.HTTPStatusError as exc:
            transactions.rollback()
            rejected = (
                400 <= exc.response.status_code < 500
                and exc.response.status_code != 429
            )
            _save_status(
                db,
                draft_id,
                "not_published" if rejected else "needs_review",
            )
            raise _failure(
                ErrorKind.UPSTREAM_FAILURE,
                (
                    "Facebook rejected the video request"
                    if rejected
                    else "Facebook video submission requires review"
                ),
            ) from exc
        except Exception as exc:
            transactions.rollback()
            _save_status(db, draft_id, "needs_review")
            logger.exception(
                "Facebook video publishing outcome uncertain for draft %s",
                draft_id,
            )
            raise _failure(
                ErrorKind.UPSTREAM_FAILURE,
                "Check Facebook before retrying the video",
            ) from exc

    try:
        image_bytes = (
            download_marketing_image(draft.image_url, draft.business_id)
            if draft.image_url
            else None
        )
        if image_bytes is not None and not (
            image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
            or image_bytes.startswith(b"\xff\xd8\xff")
            or (
                image_bytes.startswith(b"RIFF")
                and image_bytes[8:12] == b"WEBP"
            )
        ):
            raise ValueError("Unsupported image data")
    except Exception as exc:
        transactions.rollback()
        _save_status(db, draft_id, "not_published")
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Unable to prepare the marketing image",
        ) from exc

    try:
        if image_bytes is not None:
            response = await publish_image_post(
                page_id=page_id,
                access_token=access_token,
                message=draft.caption,
                image_bytes=image_bytes,
            )
            post_id = response.get("post_id") or response.get("id")
        else:
            response = await publish_text_post(
                page_id=page_id,
                access_token=access_token,
                message=draft.caption,
            )
            post_id = response.get("id")

        if not post_id:
            raise ValueError("Facebook returned no publication ID")
        draft.facebook_post_id = str(post_id)
        draft.facebook_publish_status = "published"
        draft.published_at = datetime.now(timezone.utc)
        transactions.commit()
        return {"status": "published", "facebook_post_id": str(post_id)}
    except httpx.HTTPStatusError as exc:
        transactions.rollback()
        rejected = (
            400 <= exc.response.status_code < 500
            and exc.response.status_code != 429
        )
        _save_status(
            db,
            draft_id,
            "not_published" if rejected else "needs_review",
        )
        if rejected:
            raise _failure(
                ErrorKind.UPSTREAM_FAILURE,
                "Facebook rejected the request. Check Page token, permissions and image format.",
            ) from exc
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Facebook publishing outcome requires review",
        ) from exc
    except Exception as exc:
        transactions.rollback()
        _save_status(db, draft_id, "needs_review")
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Facebook publishing outcome requires review",
        ) from exc


async def verify_video(draft_id: str, *, db: Session) -> dict[str, str]:
    draft = repository.get_draft(db, draft_id, include_deleted=True)
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    if draft.media_type != "video" or not draft.facebook_post_id:
        raise _failure(
            ErrorKind.CONFLICT,
            "No submitted Facebook video to verify",
        )
    if draft.facebook_publish_status == "published":
        return {
            "status": "published",
            "facebook_post_id": draft.facebook_post_id,
        }
    if draft.facebook_publish_status != "needs_review":
        raise _failure(
            ErrorKind.CONFLICT,
            "Video is not awaiting verification",
        )

    account = repository.get_connected_page(db, draft.business_id)
    if account is None:
        raise _failure(ErrorKind.CONFLICT, "Facebook Page is not connected")

    access_token = decrypt_token(account.encrypted_access_token)
    try:
        result = await get_video_status(
            video_id=draft.facebook_post_id,
            access_token=access_token,
        )
    except httpx.HTTPError as exc:
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Unable to verify Facebook video status",
        ) from exc

    status = result.get("status", {})
    video_status = status.get("video_status", "") if isinstance(status, dict) else ""
    if video_status == "ready":
        draft.facebook_publish_status = "published"
        draft.published_at = datetime.now(timezone.utc)
        Transactions(db).commit()
        return {
            "status": "published",
            "facebook_post_id": draft.facebook_post_id,
        }

    return {
        "status": "processing",
        "facebook_post_id": draft.facebook_post_id,
    }


def reset_publication(draft_id: str, *, db: Session) -> dict[str, str]:
    if not repository.reset_publication(db, draft_id):
        Transactions(db).rollback()
        raise _failure(ErrorKind.CONFLICT, "Draft cannot be reset")
    Transactions(db).commit()
    return {"status": "not_published"}
