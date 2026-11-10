from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


GENERATION_PATH = "/businesses/business-1/drafts/draft-1/heygen-generation"
REQUEST = {
    "avatar_id": "selected-avatar",
    "voice_id": "selected-voice",
    "script": "Guion de prueba",
}


def create_draft(engine):
    from app.models import Business, Draft

    with Session(engine) as db:
        db.add(Business(id="business-1", name="Negocio de prueba"))
        db.add(
            Draft(
                id="draft-1",
                business_id="business-1",
                title="Video de prueba",
                caption="Descripción",
                platform="facebook",
                status="pending",
                media_type="text",
                video_status="not_started",
            )
        )
        db.commit()


def get_attempt(engine):
    from app.models import HeyGenGenerationAttempt

    with Session(engine) as db:
        return db.scalar(select(HeyGenGenerationAttempt))


def test_repeated_request_reuses_attempt_and_conflicting_payload_is_rejected(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service
    from app.models import Draft

    client, engine = isolated_client
    create_draft(engine)
    calls = []

    def generate(**kwargs):
        calls.append(kwargs)
        return {"video_id": "provider-video-1"}

    monkeypatch.setattr(generation_service, "generate_video", generate)

    first = client.post(GENERATION_PATH, json=REQUEST)
    repeated = client.post(GENERATION_PATH, json=REQUEST)
    changed = client.post(
        GENERATION_PATH,
        json={**REQUEST, "script": "Un guion diferente"},
    )

    assert first.status_code == repeated.status_code == 200
    assert first.json()["attempt_id"] == repeated.json()["attempt_id"]
    assert first.json()["status"] == "PROCESSING"
    assert changed.status_code == 409
    assert len(calls) == 1
    attempt = get_attempt(engine)
    assert attempt.request_fingerprint
    assert attempt.idempotency_key
    assert attempt.provider_video_id == "provider-video-1"
    assert attempt.aspect_ratio == "9:16"
    assert attempt.resolution == "1080p"
    assert calls[0]["idempotency_key"] == attempt.idempotency_key
    assert calls[0]["callback_id"] == attempt.id
    assert calls[0]["aspect_ratio"] == attempt.aspect_ratio
    assert calls[0]["resolution"] == attempt.resolution
    with Session(engine) as db:
        saved_draft = db.get(Draft, "draft-1")
        assert saved_draft.status == "pending"
        assert saved_draft.published_at is None


def test_missing_generation_attempt_is_distinct_from_missing_draft(isolated_client):
    client, engine = isolated_client
    create_draft(engine)

    for response in (
        client.get(GENERATION_PATH),
        client.post(f"{GENERATION_PATH}/reconcile"),
    ):
        assert response.status_code == 404
        assert response.json()["detail"] == "No HeyGen generation attempt found"

    inaccessible = client.get(
        "/businesses/another-business/drafts/draft-1/heygen-generation"
    )
    assert inaccessible.status_code == 404
    assert inaccessible.json()["detail"] == "Draft not found"


def test_same_request_during_submission_returns_reserved_attempt_without_resubmitting(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service

    client, engine = isolated_client
    create_draft(engine)
    calls = []
    nested_responses = []

    def generate(**kwargs):
        calls.append(kwargs)
        nested_responses.append(client.post(GENERATION_PATH, json=REQUEST))
        return {"video_id": "provider-video-2"}

    monkeypatch.setattr(generation_service, "generate_video", generate)

    response = client.post(GENERATION_PATH, json=REQUEST)

    assert response.status_code == 200
    assert nested_responses[0].status_code == 200
    assert nested_responses[0].json()["status"] == "SUBMITTING"
    assert nested_responses[0].json()["attempt_id"] == response.json()["attempt_id"]
    assert len(calls) == 1


def test_ambiguous_timeout_keeps_attempt_blocked_after_idempotency_window(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service

    client, engine = isolated_client
    create_draft(engine)
    calls = []

    def timeout(**kwargs):
        calls.append(kwargs)
        raise httpx.ReadTimeout("response timed out")

    monkeypatch.setattr(generation_service, "generate_video", timeout)
    first = client.post(GENERATION_PATH, json=REQUEST)
    assert first.status_code == 200
    assert first.json()["status"] == "UNKNOWN"

    attempt = get_attempt(engine)
    original_key = attempt.idempotency_key
    with Session(engine) as db:
        saved = db.get(type(attempt), attempt.id)
        saved.first_submitted_at = datetime.now(timezone.utc) - timedelta(hours=25)
        saved.submission_lease_until = None
        db.commit()

    recovered = client.post(GENERATION_PATH, json=REQUEST)
    assert recovered.status_code == 200
    assert recovered.json()["attempt_id"] == first.json()["attempt_id"]
    assert recovered.json()["status"] == "UNKNOWN"
    assert get_attempt(engine).idempotency_key == original_key
    assert len(calls) == 1


def test_safe_retry_before_window_reuses_exact_persisted_idempotency_key(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service

    client, engine = isolated_client
    create_draft(engine)
    keys = []

    def provider(**kwargs):
        keys.append(kwargs["idempotency_key"])
        if len(keys) == 1:
            raise httpx.ConnectTimeout("ambiguous connection timeout")
        return {"video_id": "provider-video-3"}

    monkeypatch.setattr(generation_service, "generate_video", provider)
    first = client.post(GENERATION_PATH, json=REQUEST)
    attempt = get_attempt(engine)
    with Session(engine) as db:
        saved = db.get(type(attempt), attempt.id)
        saved.submission_lease_until = None
        db.commit()

    retried = client.post(GENERATION_PATH, json=REQUEST)
    assert first.json()["status"] == "UNKNOWN"
    assert retried.json()["status"] == "PROCESSING"
    assert keys == [attempt.idempotency_key, attempt.idempotency_key]
    assert retried.json()["attempt_id"] == first.json()["attempt_id"]


def test_heygen_409_in_flight_is_unknown_and_does_not_create_new_key(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service
    from app.heygen_service import HeyGenRequestInProgress

    client, engine = isolated_client
    create_draft(engine)
    calls = []

    def in_progress(**kwargs):
        calls.append(kwargs)
        raise HeyGenRequestInProgress(
            "in progress",
            status_code=409,
            code="request_in_progress",
        )

    monkeypatch.setattr(generation_service, "generate_video", in_progress)
    first = client.post(GENERATION_PATH, json=REQUEST)
    second = client.post(GENERATION_PATH, json=REQUEST)

    assert first.json()["status"] == second.json()["status"] == "UNKNOWN"
    assert first.json()["attempt_id"] == second.json()["attempt_id"]
    assert len(calls) == 1
    assert get_attempt(engine).idempotency_key == calls[0]["idempotency_key"]


def test_provider_5xx_is_ambiguous_and_retains_attempt(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service
    from app.heygen_service import HeyGenProviderError

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: (_ for _ in ()).throw(
            HeyGenProviderError("provider unavailable", status_code=503)
        ),
    )

    response = client.post(GENERATION_PATH, json=REQUEST)

    assert response.status_code == 200
    assert response.json()["status"] == "UNKNOWN"
    assert get_attempt(engine).status == "UNKNOWN"


@pytest.mark.parametrize(
    "provider_error",
    [
        {"status_code": 429, "code": "rate_limited"},
        {"status_code": 503, "code": "temporarily_unavailable"},
        {"status_code": None, "code": "provider_error"},
    ],
)
def test_potentially_billable_provider_errors_never_open_a_new_attempt(
    isolated_client, monkeypatch, provider_error,
):
    from app.features.media import generation_service
    from app.heygen_service import HeyGenProviderError

    client, engine = isolated_client
    create_draft(engine)
    calls = []

    def provider(**kwargs):
        calls.append(kwargs["idempotency_key"])
        raise HeyGenProviderError(
            "ambiguous provider response",
            status_code=provider_error["status_code"],
            code=provider_error["code"],
        )

    monkeypatch.setattr(generation_service, "generate_video", provider)
    first = client.post(GENERATION_PATH, json=REQUEST)
    attempt = get_attempt(engine)
    with Session(engine) as db:
        saved = db.get(type(attempt), attempt.id)
        saved.submission_lease_until = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    retry = client.post(GENERATION_PATH, json=REQUEST)

    assert first.json()["status"] == retry.json()["status"] == "UNKNOWN"
    assert first.json()["attempt_id"] == retry.json()["attempt_id"]
    assert get_attempt(engine).idempotency_key == attempt.idempotency_key
    assert calls == [attempt.idempotency_key, attempt.idempotency_key]


def test_definitive_provider_failure_releases_attempt_only_for_explicit_new_request(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service
    from app.heygen_service import HeyGenProviderError

    client, engine = isolated_client
    create_draft(engine)
    calls = []

    def provider(**kwargs):
        calls.append(kwargs["idempotency_key"])
        if len(calls) == 1:
            raise HeyGenProviderError("invalid input", status_code=400)
        return {"video_id": "provider-video-4"}

    monkeypatch.setattr(generation_service, "generate_video", provider)
    failed = client.post(GENERATION_PATH, json=REQUEST)
    retried = client.post(GENERATION_PATH, json=REQUEST)

    assert failed.json()["status"] == "FAILED"
    assert retried.json()["status"] == "PROCESSING"
    assert failed.json()["attempt_id"] != retried.json()["attempt_id"]
    assert calls[0] != calls[1]


def test_terminal_attempt_does_not_transition_back_to_processing_or_unknown(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service
    from app.models import Draft, HeyGenGenerationAttempt

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: {"video_id": "provider-video-terminal"},
    )
    generated = client.post(GENERATION_PATH, json=REQUEST)
    monkeypatch.setattr(
        generation_service,
        "get_video_status",
        lambda _video_id: {
            "id": "provider-video-terminal",
            "status": "completed",
            "video_url": "https://files.heygen.ai/video.mp4",
        },
    )
    monkeypatch.setattr(
        generation_service,
        "download_generated_video",
        lambda _url: b"\x00\x00\x00\x18ftypisom",
    )
    monkeypatch.setattr(
        generation_service,
        "upload_marketing_video",
        lambda _video, _business, **kwargs: kwargs["storage_path"],
    )
    completed = client.get(GENERATION_PATH)
    assert completed.json()["status"] == "COMPLETED"

    with Session(engine) as db:
        attempt = db.get(HeyGenGenerationAttempt, generated.json()["attempt_id"])
        terminal_updated_at = attempt.updated_at
        generation_service._update_attempt(
            db,
            attempt.id,
            status="PROCESSING",
            expected_status="COMPLETED",
            expected_updated_at=terminal_updated_at,
        )
        generation_service._update_attempt(
            db,
            attempt.id,
            status="UNKNOWN",
            expected_status="COMPLETED",
            expected_updated_at=terminal_updated_at,
        )
        db.refresh(attempt)
        draft = db.get(Draft, "draft-1")

    assert attempt.status == "COMPLETED"
    assert draft.video_status == "completed"


def test_stale_status_response_cannot_overwrite_newer_terminal_state(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service
    from app.models import HeyGenGenerationAttempt

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: {"video_id": "provider-video-stale"},
    )
    generated = client.post(GENERATION_PATH, json=REQUEST)
    with Session(engine) as db:
        attempt = db.get(HeyGenGenerationAttempt, generated.json()["attempt_id"])
        attempt.status = "UNKNOWN"
        attempt.updated_at = datetime.now(timezone.utc)
        db.commit()

    update_attempt = generation_service._update_attempt
    advanced = False

    def update_with_newer_status(db, attempt_id, **kwargs):
        nonlocal advanced
        if kwargs.get("status") == "PROCESSING" and not advanced:
            advanced = True
            update_attempt(
                db,
                attempt_id,
                status="PROCESSING",
                expected_status="UNKNOWN",
            )
            update_attempt(
                db,
                attempt_id,
                status="COMPLETED",
                expected_status="PROCESSING",
            )
        return update_attempt(db, attempt_id, **kwargs)

    monkeypatch.setattr(
        generation_service,
        "_update_attempt",
        update_with_newer_status,
    )

    def stale_processing_response(_video_id):
        return {
            "id": "provider-video-stale",
            "status": "processing",
        }

    monkeypatch.setattr(
        generation_service,
        "get_video_status",
        stale_processing_response,
    )

    response = client.get(GENERATION_PATH)

    assert response.status_code == 200
    assert response.json()["status"] == "COMPLETED"
    assert get_attempt(engine).status == "COMPLETED"


def test_late_submission_response_cannot_regress_newer_terminal_state(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service
    from app.models import Draft, HeyGenGenerationAttempt

    client, engine = isolated_client
    create_draft(engine)

    update_attempt = generation_service._update_attempt
    advanced = False

    def update_with_newer_submission(db, attempt_id, **kwargs):
        nonlocal advanced
        if kwargs.get("status") == "PROCESSING" and not advanced:
            advanced = True
            update_attempt(
                db,
                attempt_id,
                status="PROCESSING",
                provider_video_id="provider-video-newer",
            )
            update_attempt(
                db,
                attempt_id,
                status="COMPLETED",
                provider_video_id="provider-video-newer",
            )
        return update_attempt(db, attempt_id, **kwargs)

    monkeypatch.setattr(
        generation_service,
        "_update_attempt",
        update_with_newer_submission,
    )
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: {"video_id": "provider-video-stale"},
    )

    response = client.post(GENERATION_PATH, json=REQUEST)

    assert response.status_code == 200
    assert response.json()["status"] == "COMPLETED"
    assert response.json()["provider_video_id"] == "provider-video-newer"
    with Session(engine) as db:
        attempt = db.scalar(select(HeyGenGenerationAttempt))
        draft = db.get(Draft, "draft-1")
        assert attempt.status == "COMPLETED"
        assert attempt.provider_video_id == "provider-video-newer"
        assert draft.video_status == "uploading"


def test_status_recovers_persisted_attempt_and_stores_private_video(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service
    from app.models import Draft, HeyGenGenerationAttempt

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: {"video_id": "provider-video-5"},
    )
    generated = client.post(GENERATION_PATH, json=REQUEST)
    monkeypatch.setattr(
        generation_service,
        "get_video_status",
        lambda video_id: {
            "id": video_id,
            "status": "completed",
            "video_url": "https://files.heygen.ai/video.mp4",
        },
    )
    monkeypatch.setattr(
        generation_service,
        "download_generated_video",
        lambda _url: b"\x00\x00\x00\x18ftypisom",
    )
    uploads = []

    def upload(video_bytes, business_id, **kwargs):
        uploads.append((video_bytes, business_id, kwargs))
        return kwargs["storage_path"]

    monkeypatch.setattr(
        generation_service,
        "upload_marketing_video",
        upload,
    )

    status = client.get(GENERATION_PATH)

    assert status.status_code == 200
    assert status.json()["attempt_id"] == generated.json()["attempt_id"]
    assert status.json()["status"] == "COMPLETED"
    assert status.json()["storage_status"] == "STORED"
    assert len(uploads) == 1
    with Session(engine) as db:
        attempt = db.get(HeyGenGenerationAttempt, status.json()["attempt_id"])
        draft = db.get(Draft, "draft-1")
        assert attempt.provider_video_id == "provider-video-5"
        assert attempt.storage_path.startswith(
            f"businesses/business-1/heygen/{attempt.id}/"
        )
        assert draft.video_status == "completed"
        assert draft.video_url == attempt.storage_path


def test_duplicate_completion_polling_uploads_video_only_once(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: {"video_id": "provider-video-duplicate"},
    )
    client.post(GENERATION_PATH, json=REQUEST)
    monkeypatch.setattr(
        generation_service,
        "get_video_status",
        lambda _video_id: {
            "id": "provider-video-duplicate",
            "status": "completed",
            "video_url": "https://files.heygen.ai/video.mp4",
        },
    )
    monkeypatch.setattr(
        generation_service,
        "download_generated_video",
        lambda _url: b"\x00\x00\x00\x18ftypisom",
    )
    uploads = []
    monkeypatch.setattr(
        generation_service,
        "upload_marketing_video",
        lambda video, business, **kwargs: (
            uploads.append((video, business, kwargs)) or kwargs["storage_path"]
        ),
    )

    first = client.get(GENERATION_PATH)
    second = client.post(f"{GENERATION_PATH}/reconcile")

    assert first.status_code == second.status_code == 200
    assert first.json()["storage_status"] == second.json()["storage_status"] == "STORED"
    assert len(uploads) == 1
    assert uploads[0][2]["upsert"] is False
    assert uploads[0][2]["storage_path"].endswith(".mp4")


def test_storage_failure_is_retried_without_new_generation_and_with_isolated_path(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service

    client, engine = isolated_client
    create_draft(engine)
    generation_calls = []
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: (
            generation_calls.append("paid submission")
            or {"video_id": "provider-video-retry-storage"}
        ),
    )
    client.post(GENERATION_PATH, json=REQUEST)
    monkeypatch.setattr(
        generation_service,
        "get_video_status",
        lambda _video_id: {
            "id": "provider-video-retry-storage",
            "status": "completed",
            "video_url": "https://files.heygen.ai/video.mp4",
        },
    )
    monkeypatch.setattr(
        generation_service,
        "download_generated_video",
        lambda _url: b"\x00\x00\x00\x18ftypisom",
    )
    upload_paths = []

    def upload(_video, _business, **kwargs):
        upload_paths.append(kwargs["storage_path"])
        if len(upload_paths) == 1:
            raise RuntimeError("storage unavailable")
        return kwargs["storage_path"]

    monkeypatch.setattr(generation_service, "upload_marketing_video", upload)

    failed = client.post(f"{GENERATION_PATH}/reconcile")
    recovered = client.post(f"{GENERATION_PATH}/reconcile")

    assert failed.status_code == 502
    assert recovered.status_code == 200
    assert recovered.json()["storage_status"] == "STORED"
    assert len(generation_calls) == 1
    assert upload_paths[0] != upload_paths[1]
    with Session(engine) as db:
        from app.models import Draft

        assert db.get(Draft, "draft-1").video_url == upload_paths[1]


def test_expired_signed_video_url_is_refetched_from_heygen(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: {"video_id": "provider-video-expiring-url"},
    )
    client.post(GENERATION_PATH, json=REQUEST)
    provider_calls = []

    def provider_status(video_id):
        provider_calls.append(video_id)
        url = (
            "https://files.heygen.ai/expired.mp4"
            if len(provider_calls) == 1
            else "https://files.heygen.ai/refreshed.mp4"
        )
        return {
            "id": video_id,
            "status": "completed",
            "video_url": url,
        }

    monkeypatch.setattr(generation_service, "get_video_status", provider_status)
    download_urls = []

    def download(url):
        download_urls.append(url)
        if len(download_urls) == 1:
            request = httpx.Request("GET", url)
            response = httpx.Response(403, request=request)
            raise httpx.HTTPStatusError(
                "expired URL",
                request=request,
                response=response,
            )
        return b"\x00\x00\x00\x18ftypisom"

    monkeypatch.setattr(generation_service, "download_generated_video", download)
    monkeypatch.setattr(
        generation_service,
        "upload_marketing_video",
        lambda _video, _business, **kwargs: kwargs["storage_path"],
    )

    response = client.post(f"{GENERATION_PATH}/reconcile")

    assert response.status_code == 200
    assert response.json()["storage_status"] == "STORED"
    assert download_urls == [
        "https://files.heygen.ai/expired.mp4",
        "https://files.heygen.ai/refreshed.mp4",
    ]
    assert provider_calls == ["provider-video-expiring-url"] * 2


def test_webhook_rejects_invalid_signature_without_persisting_delivery(
    isolated_client, monkeypatch,
):
    import json

    client, engine = isolated_client
    monkeypatch.setenv("HEYGEN_WEBHOOK_SECRET", "test-webhook-secret")
    response = client.post(
        "/webhooks/heygen",
        content=json.dumps({
            "event_type": "avatar_video.success",
            "event_data": {"video_id": "provider-video-invalid"},
        }),
        headers={"signature": "0" * 64, "content-type": "application/json"},
    )

    assert response.status_code == 401
    with Session(engine) as db:
        from app.models import HeyGenWebhookDelivery

        assert db.scalars(select(HeyGenWebhookDelivery)).all() == []


def test_signed_webhook_is_deduplicated_and_uses_authoritative_provider_url(
    isolated_client, monkeypatch,
):
    import hashlib
    import hmac
    import json
    from sqlalchemy.orm import sessionmaker

    from app import database
    from app.features.media import generation_service
    from app.models import HeyGenWebhookDelivery

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: {"video_id": "provider-video-webhook"},
    )
    client.post(GENERATION_PATH, json=REQUEST)
    monkeypatch.setattr(
        database,
        "SessionLocal",
        sessionmaker(bind=engine, class_=Session, autoflush=False),
    )
    monkeypatch.setenv("HEYGEN_WEBHOOK_SECRET", "test-webhook-secret")
    provider_urls = []
    monkeypatch.setattr(
        generation_service,
        "get_video_status",
        lambda video_id: {
            "id": video_id,
            "status": "completed",
            "video_url": "https://files.heygen.ai/authoritative.mp4",
        },
    )
    monkeypatch.setattr(
        generation_service,
        "download_generated_video",
        lambda url: (
            provider_urls.append(url) or b"\x00\x00\x00\x18ftypisom"
        ),
    )
    monkeypatch.setattr(
        generation_service,
        "upload_marketing_video",
        lambda _video, _business, **kwargs: kwargs["storage_path"],
    )

    raw_body = json.dumps({
        "event_type": "avatar_video.success",
        "event_data": {
            "video_id": "provider-video-webhook",
            "url": "https://attacker.example/fake.mp4",
            "status": "failed",
        },
    }).encode()
    signature = hmac.new(
        b"test-webhook-secret",
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    headers = {
        "signature": signature,
        "content-type": "application/json",
    }

    first = client.post("/webhooks/heygen", content=raw_body, headers=headers)
    duplicate = client.post("/webhooks/heygen", content=raw_body, headers=headers)

    assert first.status_code == duplicate.status_code == 202
    assert provider_urls == ["https://files.heygen.ai/authoritative.mp4"]
    with Session(engine) as db:
        deliveries = db.scalars(select(HeyGenWebhookDelivery)).all()
        from app.models import Draft

        assert len(deliveries) == 1
        assert deliveries[0].processed_at is not None
        assert db.get(Draft, "draft-1").video_status == "completed"


def test_webhook_callback_id_recovers_attempt_missing_submission_response(
    isolated_client, monkeypatch,
):
    import hashlib
    import hmac
    import json
    from sqlalchemy.orm import sessionmaker

    from app import database
    from app.features.media import generation_service
    from app.models import HeyGenGenerationAttempt

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: (_ for _ in ()).throw(httpx.ReadTimeout("response lost")),
    )
    initial = client.post(GENERATION_PATH, json=REQUEST)
    assert initial.json()["status"] == "UNKNOWN"
    with Session(engine) as db:
        attempt = db.get(HeyGenGenerationAttempt, initial.json()["attempt_id"])
        assert attempt.provider_video_id is None

    monkeypatch.setattr(
        database,
        "SessionLocal",
        sessionmaker(bind=engine, class_=Session, autoflush=False),
    )
    monkeypatch.setenv("HEYGEN_WEBHOOK_SECRET", "test-webhook-secret")
    provider_calls = []
    monkeypatch.setattr(
        generation_service,
        "get_video_status",
        lambda video_id: (
            provider_calls.append(video_id)
            or {
                "id": video_id,
                "status": "completed",
                "video_url": "https://files.heygen.ai/callback-video.mp4",
            }
        ),
    )
    monkeypatch.setattr(
        generation_service,
        "download_generated_video",
        lambda _url: b"\x00\x00\x00\x18ftypisom",
    )
    monkeypatch.setattr(
        generation_service,
        "upload_marketing_video",
        lambda _video, _business, **kwargs: kwargs["storage_path"],
    )
    raw_body = json.dumps({
        "event_type": "avatar_video.success",
        "event_data": {
            "video_id": "provider-video-recovered",
            "callback_id": attempt.id,
            "url": "https://untrusted.example/ignored.mp4",
        },
    }).encode()
    signature = hmac.new(
        b"test-webhook-secret",
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    response = client.post(
        "/webhooks/heygen",
        content=raw_body,
        headers={
            "signature": signature,
            "content-type": "application/json",
        },
    )

    assert response.status_code == 202
    assert provider_calls == ["provider-video-recovered"]
    with Session(engine) as db:
        recovered = db.get(HeyGenGenerationAttempt, attempt.id)
        assert recovered.provider_video_id == "provider-video-recovered"
        assert recovered.status == "COMPLETED"
        assert recovered.storage_status == "STORED"


def test_authenticated_reconcile_resumes_persisted_callback_after_restart(
    isolated_client, monkeypatch,
):
    from sqlalchemy.orm import sessionmaker

    from app import database
    from app.features.media import generation_service
    from app.models import HeyGenGenerationAttempt, HeyGenWebhookDelivery

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: (_ for _ in ()).throw(httpx.ReadTimeout("response lost")),
    )
    initial = client.post(GENERATION_PATH, json=REQUEST)
    assert initial.json()["status"] == "UNKNOWN"

    monkeypatch.setattr(
        database,
        "SessionLocal",
        sessionmaker(bind=engine, class_=Session, autoflush=False),
    )
    with Session(engine) as db:
        attempt = db.get(HeyGenGenerationAttempt, initial.json()["attempt_id"])
        attempt_id = attempt.id
        delivery = generation_service.record_webhook_delivery(
            db,
            event_type="avatar_video.success",
            provider_video_id="provider-video-restart",
            callback_id=attempt_id,
        )
        delivery_id = delivery.id

    monkeypatch.setattr(
        generation_service,
        "get_video_status",
        lambda video_id: {
            "id": video_id,
            "status": "completed",
            "video_url": "https://files.heygen.ai/recovered.mp4",
        },
    )
    monkeypatch.setattr(
        generation_service,
        "download_generated_video",
        lambda _url: b"\x00\x00\x00\x18ftypisom",
    )
    monkeypatch.setattr(
        generation_service,
        "upload_marketing_video",
        lambda _video, _business, **kwargs: kwargs["storage_path"],
    )

    reconciled = client.post(f"{GENERATION_PATH}/reconcile")

    assert reconciled.status_code == 200
    assert reconciled.json()["status"] == "COMPLETED"
    assert reconciled.json()["storage_status"] == "STORED"
    with Session(engine) as db:
        saved = db.get(HeyGenGenerationAttempt, attempt_id)
        saved_delivery = db.get(HeyGenWebhookDelivery, delivery_id)
        assert saved.provider_video_id == "provider-video-restart"
        assert saved_delivery.processed_at is not None


def test_concurrent_completion_claim_does_not_start_second_upload(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service

    client, _engine = isolated_client
    create_draft(_engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: {"video_id": "provider-video-concurrent"},
    )
    client.post(GENERATION_PATH, json=REQUEST)
    monkeypatch.setattr(
        generation_service,
        "get_video_status",
        lambda _video_id: {
            "id": "provider-video-concurrent",
            "status": "completed",
            "video_url": "https://files.heygen.ai/concurrent.mp4",
        },
    )
    download_count = []
    nested_results = []

    def download(_url):
        download_count.append("download")
        nested_results.append(client.get(GENERATION_PATH))
        return b"\x00\x00\x00\x18ftypisom"

    monkeypatch.setattr(generation_service, "download_generated_video", download)
    monkeypatch.setattr(
        generation_service,
        "upload_marketing_video",
        lambda _video, _business, **kwargs: kwargs["storage_path"],
    )

    response = client.get(GENERATION_PATH)

    assert response.status_code == 200
    assert nested_results[0].status_code == 200
    assert nested_results[0].json()["storage_status"] == "PROCESSING"
    assert len(download_count) == 1


def test_attempt_and_status_are_scoped_to_account_business_and_draft(
    isolated_client, monkeypatch,
):
    from app import main
    from app.auth import verify_token
    from app.features.media import generation_service

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: {"video_id": "provider-video-6"},
    )
    created = client.post(GENERATION_PATH, json=REQUEST)
    assert created.status_code == 200
    assert client.get(
        "/businesses/another-business/drafts/draft-1/heygen-generation"
    ).status_code == 404
    assert client.get(
        "/businesses/business-1/drafts/another-draft/heygen-generation"
    ).status_code == 404

    previous = main.app.dependency_overrides[verify_token]
    main.app.dependency_overrides[verify_token] = lambda: {"sub": "another-account"}
    try:
        response = client.get(GENERATION_PATH)
    finally:
        main.app.dependency_overrides[verify_token] = previous
    assert response.status_code == 404


def test_manual_upload_remains_available_but_is_blocked_while_attempt_is_unknown(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **_kwargs: (_ for _ in ()).throw(httpx.ReadTimeout("timeout")),
    )
    client.post(GENERATION_PATH, json=REQUEST)

    upload = client.post(
        "/drafts/draft-1/upload-video",
        files={"file": ("video.mp4", b"video", "video/mp4")},
    )
    assert upload.status_code == 409


def test_manual_mp4_upload_still_completes_draft_without_generation_attempt(
    isolated_client, monkeypatch,
):
    from app import main

    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setattr(
        main,
        "upload_marketing_video",
        lambda *, video_bytes, business_id: f"businesses/{business_id}/video.mp4",
    )

    upload = client.post(
        "/drafts/draft-1/upload-video",
        files={"file": ("video.mp4", b"video", "video/mp4")},
    )

    assert upload.status_code == 200
    assert upload.json()["video_status"] == "completed"
    with Session(engine) as db:
        from app.models import Draft

        draft = db.get(Draft, "draft-1")
        assert draft.video_url == "businesses/business-1/video.mp4"


def test_database_index_allows_only_one_active_attempt_per_draft(isolated_client):
    from app.models import HeyGenGenerationAttempt

    _, engine = isolated_client
    create_draft(engine)
    now = datetime.now(timezone.utc)

    def attempt(attempt_id, status):
        return HeyGenGenerationAttempt(
            id=attempt_id,
            user_id="test-authorized-user",
            business_id="business-1",
            draft_id="draft-1",
            request_fingerprint="fingerprint",
            idempotency_key=f"key-{attempt_id}",
            avatar_id="avatar",
            voice_id="voice",
            script="script",
            aspect_ratio="9:16",
            resolution="1080p",
            status=status,
            first_submitted_at=now,
            created_at=now,
            updated_at=now,
        )

    with Session(engine) as db:
        db.add(attempt("attempt-1", "UNKNOWN"))
        db.commit()
        db.add(attempt("attempt-2", "SUBMITTING"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        db.add(attempt("attempt-3", "FAILED"))
        db.commit()


def test_provider_client_sends_persisted_idempotency_key(monkeypatch):
    from app import heygen_service

    captured = {}

    class MockClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, url, *, headers, json):
            captured.update(url=url, headers=headers, payload=json)
            return httpx.Response(
                200,
                json={"data": {"video_id": "provider-video"}},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(heygen_service.httpx, "Client", MockClient)
    monkeypatch.setenv("HEYGEN_API_KEY", "test-only-heygen-key")

    result = heygen_service.generate_video(
        "avatar",
        "voice",
        "script",
        idempotency_key="persisted-attempt-key",
        callback_id="attempt-callback-id",
    )

    assert result == {"video_id": "provider-video"}
    assert captured["url"] == "https://api.heygen.com/v3/videos"
    assert captured["headers"]["Idempotency-Key"] == "persisted-attempt-key"
    assert captured["headers"]["X-Api-Key"] == "test-only-heygen-key"
    assert captured["payload"]["aspect_ratio"] == "9:16"
    assert captured["payload"]["resolution"] == "1080p"
    assert captured["payload"]["callback_id"] == "attempt-callback-id"


def test_provider_client_classifies_409_as_in_flight(monkeypatch):
    from app import heygen_service
    from app.heygen_service import HeyGenRequestInProgress

    class MockClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, url, **_kwargs):
            return httpx.Response(
                409,
                json={"error": {"code": "request_in_progress"}},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(heygen_service.httpx, "Client", MockClient)
    monkeypatch.setenv("HEYGEN_API_KEY", "test-only-heygen-key")

    with pytest.raises(HeyGenRequestInProgress):
        heygen_service.generate_video(
            "avatar",
            "voice",
            "script",
            idempotency_key="persisted-attempt-key",
            callback_id="attempt-callback-id",
        )


def test_video_downloader_validates_each_https_redirect(monkeypatch):
    from app import heygen_service

    requests = []

    class MockStream:
        def __init__(self, response):
            self.response = response

        def __enter__(self):
            return self.response

        def __exit__(self, *_args):
            return False

    class MockClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def stream(self, _method, url):
            requests.append(url)
            request = httpx.Request("GET", url)
            if len(requests) == 1:
                return MockStream(
                    httpx.Response(
                        302,
                        headers={"location": "https://attacker.example/file.mp4"},
                        request=request,
                    )
                )
            raise AssertionError("Untrusted redirect target was contacted.")

    monkeypatch.setattr(heygen_service.httpx, "Client", MockClient)

    with pytest.raises(ValueError, match="Untrusted"):
        heygen_service.download_generated_video(
            "https://files.heygen.ai/video.mp4"
        )

    assert requests == ["https://files.heygen.ai/video.mp4"]


def test_video_downloader_follows_valid_redirect_and_enforces_size_limit(monkeypatch):
    from app import heygen_service

    requests = []
    video_bytes = b"\x00\x00\x00\x18ftypisom"

    class MockStream:
        def __init__(self, response):
            self.response = response

        def __enter__(self):
            return self.response

        def __exit__(self, *_args):
            return False

    class MockClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def stream(self, _method, url):
            requests.append(url)
            request = httpx.Request("GET", url)
            if len(requests) == 1:
                return MockStream(
                    httpx.Response(
                        302,
                        headers={"location": "https://resource.heygen.ai/video.mp4"},
                        request=request,
                    )
                )
            return MockStream(
                httpx.Response(200, content=video_bytes, request=request)
            )

    monkeypatch.setattr(heygen_service.httpx, "Client", MockClient)

    assert heygen_service.download_generated_video(
        "https://files.heygen.ai/redirect.mp4"
    ) == video_bytes
    assert requests == [
        "https://files.heygen.ai/redirect.mp4",
        "https://resource.heygen.ai/video.mp4",
    ]

    class OversizedClient(MockClient):
        def stream(self, _method, url):
            request = httpx.Request("GET", url)
            return MockStream(
                httpx.Response(
                    200,
                    headers={"content-length": str(100 * 1024 * 1024 + 1)},
                    request=request,
                )
            )

    monkeypatch.setattr(heygen_service.httpx, "Client", OversizedClient)
    with pytest.raises(ValueError, match="100 MB"):
        heygen_service.download_generated_video(
            "https://files.heygen.ai/oversized.mp4"
        )


def test_storage_service_uploads_generated_video_to_stable_private_path(monkeypatch):
    from types import SimpleNamespace
    from uuid import uuid4

    from app import storage_service

    business_id = str(uuid4())
    storage_path = f"businesses/{business_id}/heygen/attempt-1.mp4"
    captured = {}

    class Bucket:
        def upload(self, **kwargs):
            captured.update(kwargs)

    class Storage:
        def from_(self, bucket_name):
            captured["bucket"] = bucket_name
            return Bucket()

    monkeypatch.setattr(
        storage_service,
        "get_storage_client",
        lambda: SimpleNamespace(storage=Storage()),
    )
    monkeypatch.setenv("SUPABASE_STORAGE_BUCKET", "private-test-bucket")

    result = storage_service.upload_marketing_video(
        b"\x00\x00\x00\x18ftypisom",
        business_id,
        storage_path=storage_path,
        upsert=True,
    )

    assert result == storage_path
    assert captured["bucket"] == "private-test-bucket"
    assert captured["path"] == storage_path
    assert captured["file_options"] == {
        "content-type": "video/mp4",
        "upsert": "true",
    }

    with pytest.raises(ValueError, match="Invalid video storage path"):
        storage_service.upload_marketing_video(
            b"\x00\x00\x00\x18ftypisom",
            business_id,
            storage_path="businesses/another-business/attempt.mp4",
            upsert=True,
        )


@pytest.fixture
def completed_provider(isolated_client, monkeypatch):
    from app.features.media import generation_service as service

    client, engine = isolated_client
    create_draft(engine)
    submissions = []

    def generate(**_kwargs):
        submissions.append(True)
        return {"video_id": "race-video"}

    monkeypatch.setattr(service, "generate_video", generate)
    assert client.post(GENERATION_PATH, json=REQUEST).status_code == 200
    monkeypatch.setattr(service, "get_video_status", lambda video_id: {
        "id": video_id, "status": "completed",
        "video_url": "https://files.heygen.ai/race.mp4",
    })
    monkeypatch.setattr(service, "download_generated_video", lambda _url: b"mp4")
    monkeypatch.setattr(service, "upload_marketing_video",
                        lambda _bytes, _business, **kw: kw["storage_path"])
    yield client, engine, service
    assert len(submissions) == 1


@pytest.mark.parametrize("phase", ["provider", "download", "upload"])
@pytest.mark.parametrize("changes", [
    {"status": "approved"}, {"status": "rejected"}, {"status": "published"},
    {"deleted_at": datetime(2026, 1, 1, tzinfo=timezone.utc)},
    {"facebook_publish_status": "publishing"},
    {"tiktok_publish_status": "published"},
    {"published_at": datetime(2026, 1, 1, tzinfo=timezone.utc)},
    {"video_generation_id": "replacement-job"},
    {"video_url": "businesses/business-1/replacement.mp4", "video_status": "completed"},
    {"media_type": "image", "image_url": "replacement.png"},
    {"video_status": "not_started"},
    {"image_status": "generating"},
])
def test_completion_preserves_ineligible_draft(
    completed_provider, monkeypatch, phase, changes,
):
    from app.models import Draft

    client, engine, service = completed_provider
    snapshots = []
    fields = ("status", "media_type", "video_url", "video_status",
              "video_generation_id", "image_url")

    def change_draft():
        with Session(engine) as db:
            draft = db.get(Draft, "draft-1")
            for name, value in changes.items():
                setattr(draft, name, value)
            db.commit()
            snapshots.append(tuple(getattr(draft, name) for name in fields))

    if phase == "provider":
        original = service.get_video_status

        def status(video_id):
            change_draft()
            return original(video_id)

        monkeypatch.setattr(service, "get_video_status", status)
    elif phase == "download":
        def download(_url):
            change_draft()
            return b"mp4"

        monkeypatch.setattr(service, "download_generated_video", download)
    else:
        def upload(_bytes, _business, **kwargs):
            change_draft()
            return kwargs["storage_path"]

        monkeypatch.setattr(service, "upload_marketing_video", upload)

    response = client.post(f"{GENERATION_PATH}/reconcile")
    assert response.status_code == 200
    assert response.json()["storage_status"] == "FAILED"
    with Session(engine) as db:
        draft = db.get(Draft, "draft-1")
        assert tuple(getattr(draft, name) for name in fields) == snapshots[0]
    assert get_attempt(engine).storage_path is None


@pytest.mark.parametrize("old_worker_fails", [False, True])
def test_expired_worker_cannot_overwrite_successor_or_regress_state(
    completed_provider, monkeypatch, old_worker_fails,
):
    from app.models import Draft

    client, engine, service = completed_provider
    clock = [datetime.now(timezone.utc)]
    monkeypatch.setattr(service, "_now", lambda: clock[0])
    objects, paths, winners = {}, [], []

    def upload(video, _business, **kwargs):
        path = kwargs["storage_path"]
        assert kwargs["upsert"] is False
        paths.append(path)
        if len(paths) == 1:
            # A second request claims completion while this upload is in flight.
            clock[0] += service.COMPLETION_LEASE + timedelta(seconds=1)
            result = client.post(f"{GENERATION_PATH}/reconcile")
            assert result.status_code == 200
            assert result.json()["storage_status"] == "STORED"
            winners.append(get_attempt(engine).storage_path)
            if old_worker_fails:
                raise RuntimeError("late upload failure")
        assert path not in objects, "A worker must not replace an existing object"
        objects[path] = video
        return path

    monkeypatch.setattr(service, "upload_marketing_video", upload)
    result = client.post(f"{GENERATION_PATH}/reconcile")
    assert result.status_code == (502 if old_worker_fails else 200)
    assert len(paths) == 2 and paths[0] != paths[1]
    attempt = get_attempt(engine)
    assert attempt.storage_status == "STORED"
    assert attempt.storage_path == winners[0] == paths[1]
    assert attempt.completion_lease_until is None
    with Session(engine) as db:
        draft = db.get(Draft, "draft-1")
        assert draft.video_url == winners[0]
        assert draft.video_status == "completed"
    assert client.get(GENERATION_PATH).json()["storage_status"] == "STORED"
    assert len(paths) == 2


def test_expired_completion_without_successor_requires_fresh_claim(
    completed_provider, monkeypatch,
):
    from app.models import Draft

    client, engine, service = completed_provider
    clock = [datetime.now(timezone.utc)]
    monkeypatch.setattr(service, "_now", lambda: clock[0])
    paths = []

    def upload(_bytes, _business, **kwargs):
        paths.append(kwargs["storage_path"])
        if len(paths) == 1:
            clock[0] += service.COMPLETION_LEASE
        return kwargs["storage_path"]

    monkeypatch.setattr(service, "upload_marketing_video", upload)
    assert client.get(GENERATION_PATH).json()["storage_status"] == "RETRY"
    with Session(engine) as db:
        assert db.get(Draft, "draft-1").video_url is None
    assert client.get(GENERATION_PATH).json()["storage_status"] == "STORED"
    assert len(paths) == 2 and paths[0] != paths[1]


def test_completion_cannot_attach_superseded_attempt(completed_provider, monkeypatch):
    from app.models import HeyGenGenerationAttempt, Draft

    client, engine, service = completed_provider

    def download(_url):
        with Session(engine) as db:
            original = db.scalar(select(HeyGenGenerationAttempt))
            values = {column.name: getattr(original, column.name)
                      for column in HeyGenGenerationAttempt.__table__.columns}
            values.update(id="new-attempt", idempotency_key="new-key",
                          provider_video_id="new-video", status="FAILED",
                          created_at=original.created_at + timedelta(seconds=1))
            db.add(HeyGenGenerationAttempt(**values))
            db.commit()
        return b"mp4"

    monkeypatch.setattr(service, "download_generated_video", download)
    result = client.get(GENERATION_PATH)
    assert result.json()["storage_status"] == "FAILED"
    with Session(engine) as db:
        assert db.get(Draft, "draft-1").video_url is None


@pytest.mark.parametrize("first", ["image", "video"])
def test_media_reservations_block_other_provider_while_first_is_pending(
    isolated_client, monkeypatch, first,
):
    """Overlap requests during provider I/O, after reservation commit."""
    from app import main
    from app.features.media import generation_service
    from app.models import Draft

    client, engine = isolated_client
    create_draft(engine)
    with Session(engine) as db:
        db.get(Draft, "draft-1").image_prompt = "Una imagen"
        db.commit()
    calls = []
    blocked = []

    def image_provider(**_kwargs):
        calls.append("image")
        blocked.append(client.post(GENERATION_PATH, json=REQUEST).status_code)
        return "businesses/business-1/image.png"

    def video_provider(**_kwargs):
        calls.append("video")
        blocked.append(client.post("/drafts/draft-1/generate-image").status_code)
        return {"video_id": "exclusive-video"}

    monkeypatch.setattr(main, "get_marketing_image_url", lambda *_args, **_kw: "https://storage.test/signed-image")
    monkeypatch.setattr(main, "generate_marketing_image", image_provider)
    monkeypatch.setattr(generation_service, "generate_video", video_provider)
    if first == "image":
        result = client.post("/drafts/draft-1/generate-image")
    else:
        result = client.post(GENERATION_PATH, json=REQUEST)
    assert result.status_code == 200
    assert blocked == [409]
    assert calls == [first]


@pytest.mark.parametrize("video_status", ["generating", "uploading", "needs_review", "completed"])
def test_image_generation_rejects_reserved_or_stored_video(
    isolated_client, monkeypatch, video_status,
):
    from app import main
    from app.models import Draft
    client, engine = isolated_client
    create_draft(engine)
    with Session(engine) as db:
        draft = db.get(Draft, "draft-1")
        draft.image_prompt = "Una imagen"
        draft.video_status = video_status
        db.commit()
    def forbidden(**_kwargs):
        pytest.fail("Conflicting paid image generation")
    monkeypatch.setattr(main, "generate_marketing_image", forbidden)
    assert client.post("/drafts/draft-1/generate-image").status_code == 409


@pytest.mark.parametrize("provider_error", ["offline", "missing"])
@pytest.mark.parametrize("action", ["read", "reconcile"])
def test_stored_video_restores_without_provider(
    completed_provider, monkeypatch, provider_error, action,
):
    client, engine, service = completed_provider
    assert client.get(GENERATION_PATH).json()["storage_status"] == "STORED"
    from unittest.mock import Mock
    error = httpx.ConnectError("offline") if provider_error == "offline" else httpx.HTTPStatusError(
        "missing", request=httpx.Request("GET", "https://api.heygen.com/v3/videos/mock"),
        response=httpx.Response(404),
    )
    provider = Mock(side_effect=error)
    monkeypatch.setattr(service, "get_video_status", provider)
    response = client.get(GENERATION_PATH) if action == "read" else client.post(f"{GENERATION_PATH}/reconcile")
    assert response.status_code == 200
    assert response.json()["status"] == "COMPLETED"
    assert response.json()["storage_status"] == "STORED"
    provider.assert_not_called()
    assert client.get("/businesses/other/drafts/draft-1/heygen-generation").status_code == 404


def test_stored_video_does_not_bypass_attempt_user_scope(completed_provider, monkeypatch):
    from app.main import app
    from app.auth import verify_token
    client, _engine, service = completed_provider
    assert client.get(GENERATION_PATH).json()["storage_status"] == "STORED"
    monkeypatch.setattr(service, "get_video_status", lambda _id: pytest.fail("Provider must not be called"))
    app.dependency_overrides[verify_token] = lambda: {"sub": "other-user"}
    assert client.get(GENERATION_PATH).status_code == 404


@pytest.mark.parametrize("first", ["image", "video"])
def test_simultaneous_image_and_video_reservations_share_draft_lock(isolated_client, monkeypatch, first):
    """Model PostgreSQL row-lock scheduling around real reservation SQL.

    SQLite ignores FOR UPDATE. The event hook supplies only that missing lock;
    both routes, transaction boundaries, and provider-call decisions stay real.
    """
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Event, Lock
    from sqlalchemy import event
    from app import main
    from app.features.media import generation_service
    from app.models import Draft

    client, engine = isolated_client
    create_draft(engine)
    with Session(engine) as db:
        db.get(Draft, "draft-1").image_prompt = "Una imagen"
        db.commit()
    image_lock = main.require_pending_draft
    video_lock = generation_service.repository.lock_draft_for_generation

    def identify_image(db, draft_id):
        db.info["reservation_kind"] = "image"
        return image_lock(db, draft_id)

    def identify_video(db, **kwargs):
        db.info["reservation_kind"] = "video"
        return video_lock(db, **kwargs)

    monkeypatch.setattr(main, "require_pending_draft", identify_image)
    monkeypatch.setattr(generation_service.repository, "lock_draft_for_generation", identify_video)
    contenders = Barrier(2)
    first_acquired = Event()
    row_lock = Lock()
    loser_finished = Event()
    paid_calls = []

    def simulate_row_lock(execution):
        statement = execution.statement
        if not execution.is_select or getattr(statement, "_for_update_arg", None) is None:
            return
        if not any(getattr(table, "name", None) == "drafts" for table in statement.get_final_froms()):
            return
        session = execution.session
        if session.info.get("held_draft_lock"):
            return
        if not session.info.get("visited_reservation"):
            session.info["visited_reservation"] = True
            contenders.wait(timeout=5)
            if session.info["reservation_kind"] != first:
                assert first_acquired.wait(timeout=5)
        assert row_lock.acquire(timeout=5)
        session.info["held_draft_lock"] = True
        first_acquired.set()

    def release_row_lock(session, transaction):
        if transaction.parent is None and session.info.pop("held_draft_lock", False):
            row_lock.release()

    def provider(kind, result):
        paid_calls.append(kind)
        assert loser_finished.wait(timeout=5)
        return result

    monkeypatch.setattr(main, "get_marketing_image_url", lambda *_args, **_kw: "https://storage.test/signed-image")
    monkeypatch.setattr(main, "generate_marketing_image", lambda **_kw: provider("image", "businesses/business-1/image.png"))
    monkeypatch.setattr(generation_service, "generate_video", lambda **_kw: provider("video", {"video_id": "concurrent-video"}))

    def request(kind):
        response = client.post("/drafts/draft-1/generate-image") if kind == "image" else client.post(GENERATION_PATH, json=REQUEST)
        if response.status_code == 409:
            loser_finished.set()
        return response.status_code

    event.listen(Session, "do_orm_execute", simulate_row_lock)
    event.listen(Session, "after_transaction_end", release_row_lock)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            image = pool.submit(request, "image")
            video = pool.submit(request, "video")
            assert sorted([image.result(timeout=10), video.result(timeout=10)]) == [200, 409]
    finally:
        event.remove(Session, "do_orm_execute", simulate_row_lock)
        event.remove(Session, "after_transaction_end", release_row_lock)
    assert paid_calls == [first]
