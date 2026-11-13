"""TikTok publishing settings, video submission and verification workflows."""
import logging
import os
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from app.storage_service import get_storage_client
from app.transactions import Transactions
from . import publishing_provider, repository, service as oauth_service
from .schemas import TikTokPublishRequest

logger = logging.getLogger(__name__)


def _failure(kind: ErrorKind, detail: str) -> ApplicationError:
    return ApplicationError(kind, detail)


async def get_creator_settings(
    draft_id: str,
    account_id: str,
    *,
    db: Session,
    principal: AuthenticatedPrincipal,
) -> dict:
    context = access.require_draft_permission(
        db, principal, draft_id, Permission.PUBLISH,
    )
    draft = repository.get_draft_scoped(db, context, draft_id)
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    account = repository.get_connected_account_scoped(db, context, account_id)
    if account is None:
        raise _failure(ErrorKind.CONFLICT, "Connect TikTok first")
    access_token = await oauth_service.get_valid_access_token(
        account_id,
        business_id=draft.business_id,
        principal=principal,
        db=db,
    )
    try:
        access.require_draft_permission(db, principal, draft_id, Permission.PUBLISH)
        result = await publishing_provider.get_creator_info(access_token)
        access.require_draft_permission(db, principal, draft_id, Permission.PUBLISH)
        return result
    except (httpx.HTTPError, ValueError):
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Unable to retrieve TikTok publishing settings",
        ) from None


async def publish_video(
    draft_id: str,
    request: TikTokPublishRequest,
    *,
    db: Session,
    principal: AuthenticatedPrincipal,
) -> dict[str, str]:
    context = access.require_draft_permission(
        db, principal, draft_id, Permission.PUBLISH,
    )
    draft = repository.get_draft_scoped(db, context, draft_id)
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    if "tiktok" not in (draft.publish_destinations or []):
        raise _failure(
            ErrorKind.CONFLICT,
            "TikTok is not selected for this draft",
        )

    account = repository.get_connected_account_scoped(
        db, context, request.account_id,
    )
    if account is None:
        raise _failure(ErrorKind.CONFLICT, "Connect TikTok first")

    if draft.media_type == "video":
        if draft.video_status != "completed" or not draft.video_url:
            raise _failure(ErrorKind.CONFLICT, "A completed video is required")
        storage_path = draft.video_url
    elif draft.image_url:
        storage_path = draft.image_url
    else:
        raise _failure(ErrorKind.CONFLICT, "TikTok requires an image or video")

    if draft.media_type != "video":
        raise _failure(
            ErrorKind.CONFLICT,
            "TikTok photo publishing requires a verified media URL; not configured yet",
        )

    try:
        repository.validate_storage_path_scoped(db, context, storage_path)
    except ValueError:
        raise _failure(ErrorKind.INVALID_INPUT, "Invalid media storage path")

    try:
        bucket = os.environ["SUPABASE_STORAGE_BUCKET"]
        video_bytes = (
            get_storage_client()
            .storage.from_(bucket)
            .download(storage_path)
        )
    except Exception as exc:
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Unable to download TikTok video",
        ) from exc

    if not isinstance(video_bytes, bytes) or video_bytes[4:8] != b"ftyp":
        raise _failure(ErrorKind.INVALID_INPUT, "Invalid MP4 video")
    if not 5 * 1024 * 1024 <= len(video_bytes) <= 64 * 1024 * 1024:
        raise _failure(
            ErrorKind.CONFLICT,
            "Video must be 5–64 MiB for current TikTok uploader",
        )

    access_token = await oauth_service.get_valid_access_token(
        account.id,
        business_id=draft.business_id,
        principal=principal,
        db=db,
    )
    try:
        access.require_draft_permission(db, principal, draft_id, Permission.PUBLISH)
        creator = await publishing_provider.get_creator_info(access_token)
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Unable to validate TikTok settings",
        ) from exc
    if request.privacy_level not in creator.get("privacy_level_options", []):
        raise _failure(
            ErrorKind.UNPROCESSABLE_ENTITY,
            "Privacy option not permitted by TikTok",
        )

    transactions = Transactions(db)
    context = access.require_permission(
        db, principal, draft.business_id, Permission.PUBLISH, lock=True,
    )
    if not repository.claim_publication_scoped(db, context, draft_id, account.id):
        transactions.rollback()
        raise _failure(
            ErrorKind.CONFLICT,
            "Draft is not eligible for TikTok publishing",
        )
    transactions.commit()

    try:
        access.require_draft_permission(db, principal, draft_id, Permission.PUBLISH)
    except ApplicationError:
        transactions.rollback()
        repository.release_publication_claim_scoped(db, context, draft_id)
        transactions.commit()
        raise

    try:
        result = await publishing_provider.publish_tiktok_video_file(
            access_token=access_token,
            video_bytes=video_bytes,
            caption=draft.caption,
            privacy_level=request.privacy_level,
            disable_comment=request.disable_comment,
            disable_duet=request.disable_duet,
            disable_stitch=request.disable_stitch,
        )
        publish_id = result.get("publish_id")
        if not publish_id:
            raise ValueError("TikTok returned no publish ID")
    except Exception as exc:
        transactions.rollback()
        repository.save_claimed_publication_scoped(
            db, context, draft_id,
            expected_status="publishing",
            values={"tiktok_publish_status": "needs_review"},
        )
        transactions.commit()
        logger.exception(
            "TikTok publishing requires review for draft %s",
            draft_id,
        )
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "TikTok publishing outcome requires review",
        ) from exc
    if not repository.save_claimed_publication_scoped(
        db, context, draft_id,
        expected_status="publishing",
        values={
            "tiktok_publish_id": publish_id,
            "tiktok_publish_status": "needs_review",
        },
    ):
        transactions.rollback()
        raise _failure(ErrorKind.CONFLICT, "TikTok publication claim is no longer active")
    transactions.commit()
    access.require_draft_permission(db, principal, draft_id, Permission.PUBLISH)
    return {"status": "processing", "tiktok_publish_id": publish_id}


async def verify_publication(
    draft_id: str,
    *,
    db: Session,
    principal: AuthenticatedPrincipal,
) -> dict[str, str | None]:
    context = access.require_draft_permission(
        db, principal, draft_id, Permission.PUBLISH,
    )
    draft = repository.get_draft_scoped(
        db, context, draft_id, include_deleted=True,
    )
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    if not draft.tiktok_publish_id:
        raise _failure(
            ErrorKind.CONFLICT,
            "No TikTok publication to verify",
        )

    account = repository.get_connected_account_scoped(
        db, context, draft.tiktok_account_id,
    )
    if account is None:
        raise _failure(ErrorKind.CONFLICT, "TikTok is not connected")
    access_token = await oauth_service.get_valid_access_token(
        account.id,
        business_id=draft.business_id,
        principal=principal,
        db=db,
    )

    try:
        access.require_draft_permission(db, principal, draft_id, Permission.PUBLISH)
        result = await publishing_provider.get_tiktok_publish_status(
            access_token=access_token,
            publish_id=draft.tiktok_publish_id,
        )
    except (httpx.HTTPError, ValueError):
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "Unable to verify TikTok publication",
        ) from None

    status = result.get("status")
    if status == "PUBLISH_COMPLETE":
        if not repository.save_claimed_publication_scoped(
            db, context, draft_id,
            expected_status="needs_review",
            values={
                "tiktok_publish_status": "published",
                "published_at": datetime.now(timezone.utc),
            },
        ):
            raise _failure(ErrorKind.CONFLICT, "TikTok publication is no longer awaiting verification")
        Transactions(db).commit()
        access.require_draft_permission(db, principal, draft_id, Permission.PUBLISH)
        return {"status": "published"}
    if status == "FAILED":
        access.require_draft_permission(db, principal, draft_id, Permission.PUBLISH)
        return {"status": "failed"}
    access.require_draft_permission(db, principal, draft_id, Permission.PUBLISH)
    return {
        "status": "processing",
        "tiktok_status": status,
    }
