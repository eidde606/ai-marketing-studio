"""Authenticated HeyGen asset endpoints."""
import json
import os
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from app.heygen_service import HeyGenConfigurationError
from . import service
from . import generation_service
from .schemas import (
    AvatarLook,
    AvatarLookPage,
    AvatarOwnership,
    AvatarType,
    HeyGenGenerationRequest,
    HeyGenGenerationResponse,
    HeyGenVoice,
    HeyGenVoicePage,
    VoiceType,
)

router = APIRouter(dependencies=[Depends(verify_token)])
webhook_router = APIRouter()


def _raise_provider_error(exc: Exception) -> None:
    if isinstance(exc, HeyGenConfigurationError):
        raise HTTPException(
            status_code=503,
            detail="HeyGen is not configured",
        ) from exc
    if isinstance(exc, httpx.HTTPStatusError):
        raise HTTPException(
            status_code=502,
            detail="HeyGen could not return the requested assets",
        ) from exc
    if isinstance(exc, httpx.RequestError):
        raise HTTPException(
            status_code=502,
            detail="HeyGen connection failed",
        ) from exc
    raise HTTPException(
        status_code=502,
        detail="HeyGen returned an invalid asset response",
    ) from exc


@router.get("/heygen/avatars")
def list_legacy_avatars():
    try:
        return service.legacy_avatar_looks()
    except (httpx.HTTPError, HeyGenConfigurationError, ValueError) as exc:
        _raise_provider_error(exc)


@router.get("/heygen/voices")
def list_legacy_voices():
    try:
        return service.legacy_voices()
    except (httpx.HTTPError, HeyGenConfigurationError, ValueError) as exc:
        _raise_provider_error(exc)


@router.get("/heygen/assets/avatars", response_model=AvatarLookPage)
def list_avatar_assets(
    avatar_type: AvatarType | None = None,
    ownership: AvatarOwnership = "private",
    limit: int = Query(default=20, ge=1, le=50),
    token: str | None = Query(default=None, min_length=1, max_length=4096),
):
    try:
        return service.avatar_looks(
            avatar_type=avatar_type,
            ownership=ownership,
            limit=limit,
            token=token,
        )
    except (httpx.HTTPError, HeyGenConfigurationError, ValueError) as exc:
        _raise_provider_error(exc)


@router.get("/heygen/assets/voices", response_model=HeyGenVoicePage)
def list_voice_assets(
    voice_type: VoiceType = Query(default="private", alias="type"),
    limit: int = Query(default=20, ge=1, le=100),
    token: str | None = Query(default=None, min_length=1, max_length=4096),
):
    try:
        return service.voices(
            voice_type=voice_type,
            limit=limit,
            token=token,
        )
    except (httpx.HTTPError, HeyGenConfigurationError, ValueError) as exc:
        _raise_provider_error(exc)


@router.post(
    "/businesses/{business_id}/drafts/{draft_id}/heygen-generation",
    response_model=HeyGenGenerationResponse,
)
def submit_video_generation(
    business_id: str,
    draft_id: str,
    request: HeyGenGenerationRequest,
    user: dict = Depends(verify_token),
    db: Session = Depends(get_db),
):
    return generation_service.submit_generation(
        db,
        user_id=user["sub"],
        business_id=business_id,
        draft_id=draft_id,
        request=request,
    )


@router.get(
    "/businesses/{business_id}/drafts/{draft_id}/heygen-generation",
    response_model=HeyGenGenerationResponse,
)
def get_video_generation_status(
    business_id: str,
    draft_id: str,
    user: dict = Depends(verify_token),
    db: Session = Depends(get_db),
):
    return generation_service.get_latest_generation(
        db,
        user_id=user["sub"],
        business_id=business_id,
        draft_id=draft_id,
    )


@router.post(
    "/businesses/{business_id}/drafts/{draft_id}/heygen-generation/reconcile",
    response_model=HeyGenGenerationResponse,
)
def reconcile_video_generation(
    business_id: str,
    draft_id: str,
    user: dict = Depends(verify_token),
    db: Session = Depends(get_db),
):
    return generation_service.get_latest_generation(
        db,
        user_id=user["sub"],
        business_id=business_id,
        draft_id=draft_id,
    )


@webhook_router.post("/webhooks/heygen", status_code=202)
async def receive_heygen_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    body_chunks = []
    body_size = 0
    async for chunk in request.stream():
        body_size += len(chunk)
        if body_size > 64 * 1024:
            raise HTTPException(status_code=413, detail="Webhook payload is too large")
        body_chunks.append(chunk)
    raw_body = b"".join(body_chunks)
    if not generation_service.verify_webhook_signature(
        raw_body,
        request.headers.get("signature"),
    ):
        if not os.getenv("HEYGEN_WEBHOOK_SECRET"):
            raise HTTPException(status_code=503, detail="HeyGen webhook is not configured")
        raise HTTPException(status_code=401, detail="Invalid HeyGen webhook signature")

    try:
        event = json.loads(raw_body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook JSON") from exc

    event_type = event.get("event_type") if isinstance(event, dict) else None
    event_data = event.get("event_data") if isinstance(event, dict) else None
    video_id = event_data.get("video_id") if isinstance(event_data, dict) else None
    callback_id = event_data.get("callback_id") if isinstance(event_data, dict) else None
    if (
        event_type not in {"avatar_video.success", "avatar_video.fail"}
        or not isinstance(video_id, str)
        or not video_id
        or len(video_id) > 255
        or (
            callback_id is not None
            and (not isinstance(callback_id, str) or len(callback_id) > 36)
        )
    ):
        raise HTTPException(status_code=400, detail="Unsupported HeyGen video event")

    delivery = generation_service.record_webhook_delivery(
        db,
        event_type=event_type,
        provider_video_id=video_id,
        callback_id=callback_id,
    )
    background_tasks.add_task(
        generation_service.process_webhook_delivery,
        delivery.id,
    )
    return {"accepted": True}
