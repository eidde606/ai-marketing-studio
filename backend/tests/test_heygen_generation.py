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
    assert calls[0]["aspect_ratio"] == attempt.aspect_ratio
    assert calls[0]["resolution"] == attempt.resolution


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
        lambda _video_id: {"status": "completed"},
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
    assert draft.video_status == "needs_review"


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
        return {"status": "processing"}

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
        assert draft.video_status == "needs_review"


def test_status_recovers_persisted_attempt_and_does_not_claim_video_is_stored(
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
        lambda video_id: {"video_id": video_id, "status": "completed"},
    )

    status = client.get(GENERATION_PATH)

    assert status.status_code == 200
    assert status.json()["attempt_id"] == generated.json()["attempt_id"]
    assert status.json()["status"] == "COMPLETED"
    with Session(engine) as db:
        attempt = db.get(HeyGenGenerationAttempt, status.json()["attempt_id"])
        draft = db.get(Draft, "draft-1")
        assert attempt.provider_video_id == "provider-video-5"
        assert draft.video_status == "needs_review"
        assert draft.video_url is None


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
    )

    assert result == {"video_id": "provider-video"}
    assert captured["url"] == "https://api.heygen.com/v3/videos"
    assert captured["headers"]["Idempotency-Key"] == "persisted-attempt-key"
    assert captured["headers"]["X-Api-Key"] == "test-only-heygen-key"
    assert captured["payload"]["aspect_ratio"] == "9:16"
    assert captured["payload"]["resolution"] == "1080p"


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
        )
