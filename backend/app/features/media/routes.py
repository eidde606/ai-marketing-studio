"""Authenticated HeyGen asset endpoints."""
import json
import os
import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from app.errors import ApplicationError, ErrorKind
from app.http_errors import http_error
from app.heygen_service import HeyGenConfigurationError
from . import service
from . import generation_service
from . import workflows_service
from .schemas import (
    AvatarLook,
    AvatarLookPage,
    AvatarOwnership,
    AvatarType,
    HeyGenGenerationRequest,
    HeyGenGenerationResponse,
    HeyGenVoice,
    HeyGenVoicePage,
    ImageRevisionRequest,
    VoiceType,
)

router = APIRouter(dependencies=[Depends(verify_token)])
webhook_router = APIRouter()


@router.post("/drafts/{draft_id}/upload-video")
def upload_draft_video(
    draft_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    try:
        draft = workflows_service.prepare_manual_video_upload(db, draft_id)
        if file.content_type != "video/mp4":
            raise http_error(
                ApplicationError(
                    ErrorKind.UNSUPPORTED_MEDIA,
                    "Only MP4 videos are supported",
                )
            )
        video_bytes = file.file.read(workflows_service.MAX_MANUAL_VIDEO_SIZE + 1)
        if len(video_bytes) > workflows_service.MAX_MANUAL_VIDEO_SIZE:
            raise http_error(
                ApplicationError(
                    ErrorKind.TOO_LARGE,
                    "Video exceeds the 100 MB limit",
                )
            )
        return workflows_service.save_manual_video_upload(
            db,
            draft,
            video_bytes,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/drafts/{draft_id}/video-preview")
def get_draft_video_preview(
    draft_id: str,
    db: Session = Depends(get_db),
):
    try:
        return workflows_service.video_preview(db, draft_id)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/drafts/{draft_id}/generate-image")
def generate_draft_image(
    draft_id: str,
    db: Session = Depends(get_db),
):
    try:
        return workflows_service.generate_image(db, draft_id)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/drafts/{draft_id}/image")
def get_draft_image(
    draft_id: str,
    db: Session = Depends(get_db),
):
    try:
        return workflows_service.image_preview(db, draft_id)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/drafts/{draft_id}/reset-image")
def reset_stuck_image(
    draft_id: str,
    db: Session = Depends(get_db),
):
    try:
        return workflows_service.reset_image(db, draft_id)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post(
    "/drafts/{draft_id}/image-revisions",
    status_code=201,
)
def create_image_revision(
    draft_id: str,
    request: ImageRevisionRequest,
    db: Session = Depends(get_db),
):
    try:
        return workflows_service.create_image_revision(
            db,
            draft_id,
            request.instructions,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.get("/drafts/{draft_id}/image-revisions")
def list_image_revisions(
    draft_id: str,
    db: Session = Depends(get_db),
):
    try:
        return workflows_service.list_image_revisions(db, draft_id)
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/drafts/{draft_id}/image-revisions/{revision_id}/accept")
def accept_image_revision(
    draft_id: str,
    revision_id: str,
    db: Session = Depends(get_db),
):
    try:
        return workflows_service.accept_image_revision(
            db,
            draft_id,
            revision_id,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


@router.post("/drafts/{draft_id}/image-revisions/{revision_id}/reject")
def reject_image_revision(
    draft_id: str,
    revision_id: str,
    db: Session = Depends(get_db),
):
    try:
        return workflows_service.reject_image_revision(
            db,
            draft_id,
            revision_id,
        )
    except ApplicationError as exc:
        raise http_error(exc) from exc


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
