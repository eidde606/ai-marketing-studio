"""Durable, idempotent submission and tracking for HeyGen video jobs."""
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from .heygen_provider import (
    HeyGenConfigurationError,
    HeyGenProviderError,
    HeyGenRequestInProgress,
    download_generated_video,
    generate_video,
    get_video_status,
)
from app.models import Draft, HeyGenGenerationAttempt, HeyGenWebhookDelivery
from app.storage_service import upload_marketing_video
from app.transactions import Transactions

from . import repository
from .schemas import HeyGenGenerationRequest

logger = logging.getLogger(__name__)


def _failure(kind: ErrorKind, detail: str) -> ApplicationError:
    return ApplicationError(kind, detail)


# Leave an hour of margin for provider/network timing within its 24-hour window.
IDEMPOTENCY_RETRY_WINDOW = timedelta(hours=23)
SUBMISSION_LEASE = timedelta(seconds=60)
COMPLETION_LEASE = timedelta(minutes=5)
GENERATION_ASPECT_RATIO = "9:16"
GENERATION_RESOLUTION = "1080p"
DEFINITIVE_REJECTION_STATUSES = frozenset({400, 401, 403, 404, 422})

ALLOWED_STATUS_TRANSITIONS = {
    "SUBMITTING": frozenset(
        {"SUBMITTING", "UNKNOWN", "PROCESSING", "COMPLETED", "FAILED"}
    ),
    "UNKNOWN": frozenset(
        {"UNKNOWN", "SUBMITTING", "PROCESSING", "COMPLETED", "FAILED"}
    ),
    "PROCESSING": frozenset({"PROCESSING", "COMPLETED", "FAILED"}),
    "COMPLETED": frozenset({"COMPLETED"}),
    "FAILED": frozenset({"FAILED"}),
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _fingerprint(request: HeyGenGenerationRequest) -> str:
    payload = {
        **request.model_dump(),
        "aspect_ratio": GENERATION_ASPECT_RATIO,
        "resolution": GENERATION_RESOLUTION,
    }
    request_json = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(request_json.encode("utf-8")).hexdigest()


def _response(attempt: HeyGenGenerationAttempt) -> dict:
    return {
        "attempt_id": attempt.id,
        "draft_id": attempt.draft_id,
        "business_id": attempt.business_id,
        "status": attempt.status,
        "provider_video_id": attempt.provider_video_id,
        "storage_status": attempt.storage_status,
        "created_at": attempt.created_at,
        "updated_at": attempt.updated_at,
    }


def _can_attach_video(
    db: Session, draft: Draft | None, attempt: HeyGenGenerationAttempt,
) -> bool:
    latest = repository.latest_attempt(db, attempt.draft_id)
    return bool(
        draft is not None
        and draft.business_id == attempt.business_id
        and draft.deleted_at is None
        and draft.status == "pending"
        and draft.published_at is None
        and draft.facebook_publish_status == "not_published"
        and draft.tiktok_publish_status == "not_published"
        and not draft.facebook_post_id
        and not draft.tiktok_publish_id
        and draft.image_status != "generating"
        and draft.media_type == "video"
        and draft.video_url is None
        and draft.video_status in ("generating", "needs_review", "uploading")
        and draft.video_generation_id == attempt.provider_video_id
        and latest is not None
        and latest.id == attempt.id
    )


def _update_attempt(
    db: Session,
    attempt_id: str,
    *,
    status: str,
    provider_video_id: str | None = None,
    lease_until: datetime | None = None,
    expected_status: str | None = None,
    expected_updated_at: datetime | None = None,
    expected_lease_until: datetime | None = None,
) -> HeyGenGenerationAttempt:
    draft, attempt = repository.lock_attempt_for_update(
        db,
        attempt_id,
        lock_draft=True,
    )
    if attempt is None:
        raise RuntimeError("Persisted HeyGen generation attempt disappeared.")

    if expected_status is not None and attempt.status != expected_status:
        return attempt
    if (
        expected_updated_at is not None
        and _utc(attempt.updated_at) != _utc(expected_updated_at)
    ):
        return attempt
    if expected_lease_until is not None:
        current_lease = (
            _utc(attempt.submission_lease_until)
            if attempt.submission_lease_until is not None
            else None
        )
        if current_lease != _utc(expected_lease_until):
            return attempt
    if status not in ALLOWED_STATUS_TRANSITIONS[attempt.status]:
        return attempt

    can_attach = _can_attach_video(db, draft, attempt)
    attempt.status = status
    if provider_video_id is not None:
        attempt.provider_video_id = provider_video_id
    attempt.submission_lease_until = lease_until
    attempt.updated_at = _now()

    # Tracking may finish after a draft becomes ineligible; never restore
    # that draft's generation association or media state.
    if not can_attach:
        transactions = Transactions(db)
        transactions.commit()
        transactions.refresh(attempt)
        return attempt
    if status in ("SUBMITTING", "PROCESSING"):
        draft.media_type = "video"
        draft.video_status = "generating"
        if attempt.provider_video_id:
            draft.video_generation_id = attempt.provider_video_id
    elif status == "UNKNOWN":
        draft.media_type = "video"
        draft.video_status = "needs_review"
        if attempt.provider_video_id:
            draft.video_generation_id = attempt.provider_video_id
    elif status == "COMPLETED":
        draft.media_type = "video"
        draft.video_status = (
            "completed" if attempt.storage_status == "STORED" else "uploading"
        )
        draft.video_generation_id = attempt.provider_video_id
    elif status == "FAILED":
        draft.video_status = "failed"
        draft.video_generation_id = None
        attempt.storage_status = "FAILED"

    transactions = Transactions(db)
    transactions.commit()
    transactions.refresh(attempt)
    return attempt


def _mark_unknown(
    db: Session,
    attempt_id: str,
    *,
    lease_until: datetime | None,
    expected_lease_until: datetime,
) -> dict:
    attempt = _update_attempt(
        db,
        attempt_id,
        status="UNKNOWN",
        lease_until=lease_until,
        expected_status="SUBMITTING",
        expected_lease_until=expected_lease_until,
    )
    return _response(attempt)


def _submit_provider_request(
    db: Session,
    attempt: HeyGenGenerationAttempt,
    *,
    expected_lease_until: datetime,
) -> dict:
    try:
        result = generate_video(
            avatar_id=attempt.avatar_id,
            voice_id=attempt.voice_id,
            script=attempt.script,
            idempotency_key=attempt.idempotency_key,
            callback_id=attempt.id,
            aspect_ratio=attempt.aspect_ratio,
            resolution=attempt.resolution,
        )
        video_id = result.get("video_id")
        if not isinstance(video_id, str) or not video_id:
            raise ValueError("HeyGen returned no video ID.")
    except HeyGenRequestInProgress:
        return _mark_unknown(
            db,
            attempt.id,
            lease_until=_now() + SUBMISSION_LEASE,
            expected_lease_until=expected_lease_until,
        )
    except httpx.RequestError:
        return _mark_unknown(
            db,
            attempt.id,
            lease_until=_now() + SUBMISSION_LEASE,
            expected_lease_until=expected_lease_until,
        )
    except HeyGenProviderError as exc:
        if exc.status_code not in DEFINITIVE_REJECTION_STATUSES:
            return _mark_unknown(
                db,
                attempt.id,
                lease_until=_now() + SUBMISSION_LEASE,
                expected_lease_until=expected_lease_until,
            )
        attempt = _update_attempt(
            db,
            attempt.id,
            status="FAILED",
            expected_status="SUBMITTING",
            expected_lease_until=expected_lease_until,
        )
        return _response(attempt)
    except HeyGenConfigurationError:
        attempt = _update_attempt(
            db,
            attempt.id,
            status="FAILED",
            expected_status="SUBMITTING",
            expected_lease_until=expected_lease_until,
        )
        return _response(attempt)
    except ValueError:
        return _mark_unknown(
            db,
            attempt.id,
            lease_until=_now() + SUBMISSION_LEASE,
            expected_lease_until=expected_lease_until,
        )
    except Exception:
        logger.exception("Unexpected HeyGen submission error for attempt %s", attempt.id)
        return _mark_unknown(
            db,
            attempt.id,
            lease_until=_now() + SUBMISSION_LEASE,
            expected_lease_until=expected_lease_until,
        )

    attempt = _update_attempt(
        db,
        attempt.id,
        status="PROCESSING",
        provider_video_id=video_id,
        expected_status="SUBMITTING",
        expected_lease_until=expected_lease_until,
    )
    return _response(attempt)


def submit_generation(
    db: Session,
    *,
    user_id: str,
    business_id: str,
    draft_id: str,
    request: HeyGenGenerationRequest,
) -> dict:
    now = _now()
    fingerprint = _fingerprint(request)
    draft = repository.lock_draft_for_generation(
        db,
        business_id=business_id,
        draft_id=draft_id,
    )
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    if draft.status != "pending":
        raise _failure(ErrorKind.CONFLICT, "Only pending drafts can generate videos")

    # Both image and video reservations hold the same draft row lock before
    # inspecting other media operations. Commit the reservation before HTTP I/O.
    if draft.image_status == "generating":
        raise _failure(ErrorKind.CONFLICT, "Image generation is already active")

    active = repository.active_attempt_for_draft(db, draft_id, lock=True)
    if active is not None:
        if active.user_id != user_id or active.business_id != business_id:
            raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
        if active.request_fingerprint != fingerprint:
            raise _failure(
                ErrorKind.CONFLICT,
                "A different HeyGen generation attempt is already active",
            )
        if active.status == "PROCESSING" or active.provider_video_id:
            return _response(active)
        lease_until = (
            _utc(active.submission_lease_until)
            if active.submission_lease_until is not None
            else None
        )
        if lease_until is not None and lease_until > now:
            return _response(active)
        submitted_at = _utc(active.first_submitted_at)
        if now >= submitted_at + IDEMPOTENCY_RETRY_WINDOW:
            return _response(
                _update_attempt(
                    db,
                    active.id,
                    status="UNKNOWN",
                    lease_until=None,
                )
            )

        active.status = "SUBMITTING"
        active.submission_lease_until = now + SUBMISSION_LEASE
        active.updated_at = now
        transactions = Transactions(db)
        transactions.commit()
        transactions.refresh(active)
        return _submit_provider_request(
            db,
            active,
            expected_lease_until=active.submission_lease_until,
        )

    latest = repository.latest_attempt_for_draft(
        db,
        user_id=user_id,
        business_id=business_id,
        draft_id=draft_id,
    )
    if latest is not None and latest.status == "COMPLETED":
        raise _failure(ErrorKind.CONFLICT, "This draft already has a generated video")
    if draft.video_url or draft.video_status in (
        "pending",
        "generating",
        "completed",
        "uploading",
        "needs_review",
    ):
        raise _failure(
            ErrorKind.CONFLICT,
            "This draft already has a video or an active video operation",
        )

    attempt = HeyGenGenerationAttempt(
        id=str(uuid4()),
        user_id=user_id,
        business_id=business_id,
        draft_id=draft_id,
        request_fingerprint=fingerprint,
        idempotency_key=str(uuid4()),
        avatar_id=request.avatar_id,
        voice_id=request.voice_id,
        script=request.script,
        aspect_ratio=GENERATION_ASPECT_RATIO,
        resolution=GENERATION_RESOLUTION,
        status="SUBMITTING",
        first_submitted_at=now,
        submission_lease_until=now + SUBMISSION_LEASE,
        created_at=now,
        updated_at=now,
    )
    draft.media_type = "video"
    draft.video_status = "generating"
    repository.add_attempt(db, attempt)
    try:
        Transactions(db).commit()
    except IntegrityError:
        Transactions(db).rollback()
        concurrent = repository.active_attempt_for_draft(db, draft_id)
        if concurrent is None:
            raise
        if concurrent.user_id != user_id or concurrent.business_id != business_id:
            raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
        if concurrent.request_fingerprint == fingerprint:
            return _response(concurrent)
        raise _failure(
            ErrorKind.CONFLICT,
            "A different HeyGen generation attempt is already active",
        )
    Transactions(db).refresh(attempt)
    return _submit_provider_request(
        db,
        attempt,
        expected_lease_until=attempt.submission_lease_until,
    )


def get_latest_generation(
    db: Session,
    *,
    user_id: str,
    business_id: str,
    draft_id: str,
) -> dict:
    draft = repository.lock_draft_for_generation(
        db,
        business_id=business_id,
        draft_id=draft_id,
    )
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")

    attempt = repository.latest_attempt_for_draft(
        db,
        user_id=user_id,
        business_id=business_id,
        draft_id=draft_id,
    )
    if attempt is None:
        raise _failure(
            ErrorKind.NOT_FOUND,
            "No HeyGen generation attempt found",
        )
    if attempt.status == "COMPLETED" and attempt.storage_status == "STORED":
        # Private storage is authoritative after completion; provider retention
        # or outages must not prevent restoring an already saved video.
        return _response(attempt)

    try:
        if not attempt.provider_video_id:
            delivery = repository.pending_webhook_delivery_for_attempt(db, attempt.id)
            if delivery is not None:
                attempt = _reconcile_webhook_delivery(db, delivery) or attempt
                return _response(attempt)
            return _response(attempt)
        attempt = refresh_attempt_status(db, attempt)
    except CompletionProcessingError as exc:
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "HeyGen video completion could not be stored; retry reconciliation",
        ) from exc
    except (httpx.HTTPError, HeyGenConfigurationError, ValueError) as exc:
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            "HeyGen status is temporarily unavailable; the saved attempt is unchanged",
        ) from exc

    return _response(attempt)


class CompletionProcessingError(RuntimeError):
    pass


def _validate_provider_video(attempt: HeyGenGenerationAttempt, resource: dict) -> str:
    provider_id = resource.get("id") or resource.get("video_id")
    if not provider_id or provider_id != attempt.provider_video_id:
        raise ValueError("HeyGen returned a different video resource.")
    if str(resource.get("status", "")).lower() != "completed":
        raise ValueError("HeyGen video is not completed.")
    video_url = resource.get("video_url")
    if not isinstance(video_url, str) or not video_url:
        raise ValueError("HeyGen completed video has no download URL.")
    return video_url


def _set_storage_retry(
    db: Session,
    attempt_id: str,
    lease_until: datetime,
) -> None:
    _, attempt = repository.lock_attempt_for_update(db, attempt_id)
    if (
        attempt is not None
        and attempt.storage_status == "PROCESSING"
        and attempt.completion_lease_until is not None
        and _utc(attempt.completion_lease_until) == _utc(lease_until)
    ):
        attempt.storage_status = "RETRY"
        attempt.completion_lease_until = None
        attempt.updated_at = _now()
        Transactions(db).commit()


def _claim_storage(
    db: Session,
    attempt_id: str,
) -> tuple[HeyGenGenerationAttempt, datetime] | None:
    draft, attempt = repository.lock_attempt_for_update(
        db,
        attempt_id,
        lock_draft=True,
    )
    if attempt is None or attempt.status != "COMPLETED":
        return None
    if attempt.storage_status in ("STORED", "FAILED"):
        return None
    if not _can_attach_video(db, draft, attempt):
        attempt.storage_status = "FAILED"
        attempt.completion_lease_until = None
        attempt.updated_at = _now()
        Transactions(db).commit()
        return None
    lease_until = (
        _utc(attempt.completion_lease_until)
        if attempt.completion_lease_until is not None
        else None
    )
    now = _now()
    if attempt.storage_status == "PROCESSING" and lease_until and lease_until > now:
        return None

    lease_until = now + COMPLETION_LEASE
    attempt.storage_status = "PROCESSING"
    attempt.completion_lease_until = lease_until
    attempt.updated_at = now
    transactions = Transactions(db)
    transactions.commit()
    transactions.refresh(attempt)
    return attempt, lease_until


def _store_completed_video(
    db: Session,
    attempt: HeyGenGenerationAttempt,
    provider_resource: dict,
) -> HeyGenGenerationAttempt:
    claim = _claim_storage(db, attempt.id)
    if claim is None:
        fresh = repository.refreshed_attempt(db, attempt.id)
        return fresh or attempt
    claimed, lease_until = claim
    # Expired workers may still upload; isolate each claim's object so they
    # cannot overwrite a successor's video after losing the database lease.
    claim_path = (
        f"businesses/{claimed.business_id}/heygen/{claimed.id}/{uuid4()}.mp4"
    )

    try:
        video_url = _validate_provider_video(claimed, provider_resource)
        try:
            video_bytes = download_generated_video(video_url)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in (401, 403, 404):
                raise
            refreshed = get_video_status(claimed.provider_video_id)
            video_url = _validate_provider_video(claimed, refreshed)
            video_bytes = download_generated_video(video_url)

        upload_path = upload_marketing_video(
            video_bytes,
            claimed.business_id,
            storage_path=claim_path,
            upsert=False,
        )
        if upload_path != claim_path:
            raise ValueError("Storage returned an unexpected video path.")
    except Exception as exc:
        _set_storage_retry(db, claimed.id, lease_until)
        raise CompletionProcessingError(
            "Unable to download or store the completed HeyGen video."
        ) from exc

    draft, current = repository.lock_attempt_for_update(
        db,
        claimed.id,
        lock_draft=True,
    )
    if (
        current is None
        or current.status != "COMPLETED"
        or current.storage_status != "PROCESSING"
        or current.completion_lease_until is None
        or _utc(current.completion_lease_until) != _utc(lease_until)
    ):
        return current or claimed

    if _utc(lease_until) <= _now():
        _set_storage_retry(db, current.id, lease_until)
        return current
    if not _can_attach_video(db, draft, current):
        current.storage_status = "FAILED"
        current.completion_lease_until = None
        current.updated_at = _now()
        transactions = Transactions(db)
        transactions.commit()
        transactions.refresh(current)
        return current
    current.storage_status = "STORED"
    current.storage_path = claim_path
    current.completion_lease_until = None
    current.updated_at = _now()
    draft.media_type = "video"
    draft.video_url = claim_path
    draft.video_status = "completed"
    draft.video_generation_id = current.provider_video_id
    transactions = Transactions(db)
    transactions.commit()
    transactions.refresh(current)
    return current


def refresh_attempt_status(
    db: Session,
    attempt: HeyGenGenerationAttempt,
    *,
    provider_video_id: str | None = None,
) -> HeyGenGenerationAttempt:
    requested_video_id = attempt.provider_video_id or provider_video_id
    if not requested_video_id:
        return attempt
    resource = get_video_status(requested_video_id)
    returned_video_id = resource.get("id") or resource.get("video_id")
    if not returned_video_id or returned_video_id != requested_video_id:
        raise ValueError("HeyGen returned a different video resource.")
    status = str(resource.get("status", "")).lower()
    status_map = {
        "waiting": "PROCESSING",
        "pending": "PROCESSING",
        "processing": "PROCESSING",
        "generating": "PROCESSING",
        "completed": "COMPLETED",
        "success": "COMPLETED",
        "failed": "FAILED",
        "error": "FAILED",
        "cancelled": "FAILED",
        "canceled": "FAILED",
    }
    mapped_status = status_map.get(status)
    if mapped_status and (
        mapped_status != attempt.status
        or attempt.provider_video_id is None
    ):
        attempt = _update_attempt(
            db,
            attempt.id,
            status=mapped_status,
            expected_status=attempt.status,
            expected_updated_at=attempt.updated_at,
            expected_lease_until=attempt.submission_lease_until,
            provider_video_id=requested_video_id,
        )
    if mapped_status == "COMPLETED":
        attempt = _store_completed_video(db, attempt, resource)
    return attempt


def process_webhook_delivery(delivery_id: str) -> None:
    from app.database import SessionLocal

    with SessionLocal() as db:
        delivery = repository.webhook_delivery(db, delivery_id)
        if delivery is None or delivery.processed_at is not None:
            return
        try:
            _reconcile_webhook_delivery(db, delivery)
        except Exception:
            logger.exception(
                "Unable to reconcile HeyGen webhook delivery %s",
                delivery_id,
            )
            return


def _reconcile_webhook_delivery(
    db: Session,
    delivery: HeyGenWebhookDelivery,
) -> HeyGenGenerationAttempt | None:
    if delivery.callback_id:
        attempt = repository.attempt_by_id(db, delivery.callback_id)
        if (
            attempt is not None
            and attempt.provider_video_id is not None
            and attempt.provider_video_id != delivery.provider_video_id
        ):
            return attempt
    else:
        attempt = repository.attempt_for_provider_video(
            db,
            delivery.provider_video_id,
        )
    if attempt is None:
        return None

    attempt = refresh_attempt_status(
        db,
        attempt,
        provider_video_id=delivery.provider_video_id,
    )
    if attempt.status in ("COMPLETED", "FAILED"):
        delivery.processed_at = _now()
        Transactions(db).commit()
    return attempt


def record_webhook_delivery(
    db: Session,
    *,
    event_type: str,
    provider_video_id: str,
    callback_id: str | None,
) -> HeyGenWebhookDelivery:
    deduplication_key = hashlib.sha256(
        f"{event_type}:{provider_video_id}".encode("utf-8")
    ).hexdigest()
    existing = repository.webhook_delivery_by_key(db, deduplication_key)
    if existing is not None:
        return existing

    delivery = HeyGenWebhookDelivery(
        id=str(uuid4()),
        deduplication_key=deduplication_key,
        event_type=event_type,
        provider_video_id=provider_video_id,
        callback_id=callback_id,
        received_at=_now(),
    )
    repository.add_webhook_delivery(db, delivery)
    try:
        Transactions(db).commit()
    except IntegrityError:
        Transactions(db).rollback()
        existing = repository.webhook_delivery_by_key(db, deduplication_key)
        if existing is None:
            raise
        return existing
    Transactions(db).refresh(delivery)
    return delivery


def has_unstored_generation(db: Session, draft_id: str) -> bool:
    attempt = repository.latest_attempt(db, draft_id)
    if attempt is not None:
        return attempt.status == "COMPLETED" and attempt.storage_status != "STORED"
    return False


def verify_webhook_signature(raw_body: bytes, signature: str | None) -> bool:
    secret = os.getenv("HEYGEN_WEBHOOK_SECRET")
    if not secret or not signature:
        return False
    expected = hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(signature, expected)


def has_active_generation(db: Session, draft_id: str) -> bool:
    return repository.has_active_attempt(db, draft_id)
