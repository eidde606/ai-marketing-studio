"""Durable, idempotent submission and tracking for HeyGen video jobs."""
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.heygen_service import (
    HeyGenConfigurationError,
    HeyGenProviderError,
    HeyGenRequestInProgress,
    generate_video,
    get_video_status,
)
from app.models import Draft, HeyGenGenerationAttempt

from . import repository
from .schemas import HeyGenGenerationRequest

logger = logging.getLogger(__name__)

# Leave an hour of margin for provider/network timing within its 24-hour window.
IDEMPOTENCY_RETRY_WINDOW = timedelta(hours=23)
SUBMISSION_LEASE = timedelta(seconds=60)
GENERATION_ASPECT_RATIO = "9:16"
GENERATION_RESOLUTION = "1080p"
DEFINITIVE_REJECTION_STATUSES = frozenset({400, 401, 403, 404, 422})

ALLOWED_STATUS_TRANSITIONS = {
    "SUBMITTING": frozenset({"SUBMITTING", "UNKNOWN", "PROCESSING", "FAILED"}),
    "UNKNOWN": frozenset({"UNKNOWN", "SUBMITTING", "PROCESSING", "FAILED"}),
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
        "created_at": attempt.created_at,
        "updated_at": attempt.updated_at,
    }


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
    attempt = db.scalar(
        select(HeyGenGenerationAttempt)
        .where(HeyGenGenerationAttempt.id == attempt_id)
        .with_for_update()
        .execution_options(populate_existing=True)
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

    attempt.status = status
    if provider_video_id is not None:
        attempt.provider_video_id = provider_video_id
    attempt.submission_lease_until = lease_until
    attempt.updated_at = _now()

    draft = db.get(Draft, attempt.draft_id)
    if draft is None:
        raise RuntimeError("Draft for HeyGen generation attempt disappeared.")
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
        draft.video_status = "needs_review"
        draft.video_generation_id = attempt.provider_video_id
    elif status == "FAILED":
        draft.video_status = "failed"
        draft.video_generation_id = None

    db.commit()
    db.refresh(attempt)
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
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status != "pending":
        raise HTTPException(status_code=409, detail="Only pending drafts can generate videos")

    active = repository.active_attempt_for_draft(db, draft_id, lock=True)
    if active is not None:
        if active.user_id != user_id or active.business_id != business_id:
            raise HTTPException(status_code=404, detail="Draft not found")
        if active.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="A different HeyGen generation attempt is already active",
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
        db.commit()
        db.refresh(active)
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
        raise HTTPException(status_code=409, detail="This draft already has a generated video")
    if draft.video_url or draft.video_status in (
        "pending",
        "generating",
        "completed",
        "uploading",
        "needs_review",
    ):
        raise HTTPException(
            status_code=409,
            detail="This draft already has a video or an active video operation",
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
    db.add(attempt)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        concurrent = repository.active_attempt_for_draft(db, draft_id)
        if concurrent is None:
            raise
        if concurrent.user_id != user_id or concurrent.business_id != business_id:
            raise HTTPException(status_code=404, detail="Draft not found")
        if concurrent.request_fingerprint == fingerprint:
            return _response(concurrent)
        raise HTTPException(
            status_code=409,
            detail="A different HeyGen generation attempt is already active",
        )
    db.refresh(attempt)
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
        raise HTTPException(status_code=404, detail="Draft not found")

    attempt = repository.latest_attempt_for_draft(
        db,
        user_id=user_id,
        business_id=business_id,
        draft_id=draft_id,
    )
    if attempt is None:
        raise HTTPException(status_code=404, detail="No HeyGen generation attempt found")
    if not attempt.provider_video_id:
        return _response(attempt)

    try:
        provider_status = get_video_status(attempt.provider_video_id)
    except (httpx.HTTPError, HeyGenConfigurationError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail="HeyGen status is temporarily unavailable; the saved attempt is unchanged",
        ) from exc

    status = str(provider_status.get("status", "")).lower()
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
    if mapped_status and mapped_status != attempt.status:
        attempt = _update_attempt(
            db,
            attempt.id,
            status=mapped_status,
            expected_status=attempt.status,
            expected_updated_at=attempt.updated_at,
            expected_lease_until=attempt.submission_lease_until,
            provider_video_id=attempt.provider_video_id,
        )
    return _response(attempt)


def has_active_generation(db: Session, draft_id: str) -> bool:
    return repository.has_active_attempt(db, draft_id)
