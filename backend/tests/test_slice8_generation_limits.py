"""Attempt limits are durable, tenant-scoped and applied before paid I/O."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import json
from unittest.mock import Mock

import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access.principal import Principal
from app.features.access.service import resolve_principal
from app.features.media import generation_service
from app.features.media.schemas import HeyGenGenerationRequest
from app.models import Draft, HeyGenGenerationAttempt
from tests.test_heygen_generation import create_draft, GENERATION_PATH, REQUEST
from tests.test_tenant_foundation_postgres import postgres_database
from app.auth import SUPABASE_ISSUER, ALLOWED_USER_ID


def configure(monkeypatch, **overrides):
    limits = {"max_generations": 1, "max_script_characters": 5000, "max_concurrent_jobs": 1, **overrides}
    monkeypatch.setenv("HEYGEN_BUSINESS_ALLOWANCES", json.dumps({"business-1": limits}))


@pytest.mark.parametrize("configuration,status", [
    ("{}", 429), ("not-json", 503), ("[]", 503),
    ('{"business-1":{"max_generations":true}}', 503),
])
def test_missing_or_invalid_allowance_never_calls_provider(isolated_client, monkeypatch, configuration, status):
    client, engine = isolated_client
    create_draft(engine)
    monkeypatch.setenv("HEYGEN_BUSINESS_ALLOWANCES", configuration)
    provider = Mock()
    monkeypatch.setattr(generation_service, "generate_video", provider)
    assert client.post(GENERATION_PATH, json=REQUEST).status_code == status
    provider.assert_not_called()
    with Session(engine) as db:
        assert db.scalar(select(HeyGenGenerationAttempt.id)) is None
        assert db.get(Draft, "draft-1").video_status == "not_started"


@pytest.mark.parametrize("confirmed", [None, False, "true", 1])
def test_new_generation_requires_explicit_boolean_confirmation(isolated_client, monkeypatch, confirmed):
    client, engine = isolated_client
    create_draft(engine)
    configure(monkeypatch)
    provider = Mock()
    monkeypatch.setattr(generation_service, "generate_video", provider)
    request = {**REQUEST, "confirmed_paid_generation": confirmed}
    if confirmed is None:
        request.pop("confirmed_paid_generation")
    assert client.post(GENERATION_PATH, json=request).status_code in {400, 422}
    provider.assert_not_called()


def test_allowance_recovery_and_usage_do_not_duplicate_charges(isolated_client, monkeypatch):
    client, engine = isolated_client
    create_draft(engine)
    configure(monkeypatch)
    provider = Mock(return_value={"video_id": "paid-job"})
    monkeypatch.setattr(generation_service, "generate_video", provider)
    monkeypatch.setattr(generation_service, "get_video_status", lambda video_id: {"id": video_id, "status": "processing"})
    first = client.post(GENERATION_PATH, json=REQUEST)
    assert first.status_code == 200
    usage = client.get("/businesses/business-1/heygen/usage").json()
    assert usage["attempts_used"] == usage["active_jobs"] == 1
    assert usage["remaining_generations"] == 0
    assert client.get("/businesses/foreign/heygen/usage").status_code == 404
    monkeypatch.delenv("HEYGEN_BUSINESS_ALLOWANCES")
    assert client.get(GENERATION_PATH).status_code == 200
    repeated = client.post(GENERATION_PATH, json=REQUEST)
    assert repeated.status_code == 200
    assert repeated.json()["attempt_id"] == first.json()["attempt_id"]
    provider.assert_called_once()
    assert client.get("/businesses/business-1/heygen/usage").json()["configured"] is False


def second_draft(engine):
    with Session(engine) as db:
        db.add(Draft(id="draft-2", business_id="business-1", title="Second", caption="Caption",
                     platform="facebook", video_status="not_started"))
        db.commit()


@pytest.mark.parametrize("limits", [{"max_generations": 0}, {"max_script_characters": 2}])
def test_zero_allowance_and_script_cap_block_before_io(isolated_client, monkeypatch, limits):
    client, engine = isolated_client
    create_draft(engine)
    configure(monkeypatch, **limits)
    provider = Mock()
    monkeypatch.setattr(generation_service, "generate_video", provider)
    assert client.post(GENERATION_PATH, json=REQUEST).status_code == 429
    provider.assert_not_called()


def test_failed_attempts_remain_counted(isolated_client, monkeypatch):
    client, engine = isolated_client
    create_draft(engine)
    second_draft(engine)
    configure(monkeypatch)
    provider = Mock(return_value={"video_id": "paid-job"})
    monkeypatch.setattr(generation_service, "generate_video", provider)
    assert client.post(GENERATION_PATH, json=REQUEST).status_code == 200
    with Session(engine) as db:
        db.scalar(select(HeyGenGenerationAttempt)).status = "FAILED"
        db.commit()
    assert client.post(GENERATION_PATH.replace("draft-1", "draft-2"), json=REQUEST).status_code == 429
    assert client.get("/businesses/business-1/heygen/usage").json()["attempts_used"] == 1
    provider.assert_called_once()


@pytest.mark.parametrize("limits", [
    {"max_generations": 1, "max_concurrent_jobs": 10},
    {"max_generations": 10, "max_concurrent_jobs": 1},
])
def test_concurrent_drafts_cannot_exceed_business_allowance(postgres_database, monkeypatch, limits):
    engine, migrate = postgres_database
    migrate("head")
    create_draft(engine)
    second_draft(engine)
    configure(monkeypatch, **limits)
    provider = Mock(return_value={"video_id": "one-paid-job"})
    monkeypatch.setattr(generation_service, "generate_video", provider)
    barrier = Barrier(2)
    def submit(draft_id):
        with Session(engine) as db:
            actor = resolve_principal(db, Principal(SUPABASE_ISSUER, ALLOWED_USER_ID))
            barrier.wait(timeout=10)
            try:
                return generation_service.submit_generation(db, principal=actor, business_id="business-1",
                    draft_id=draft_id, request=HeyGenGenerationRequest(**REQUEST))["status"]
            except ApplicationError as error:
                assert not db.in_transaction()
                return error.kind
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(submit, ["draft-1", "draft-2"]))
    assert results.count("PROCESSING") == 1
    assert results.count(ErrorKind.LIMIT_EXCEEDED) == 1
    provider.assert_called_once()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(HeyGenGenerationAttempt)) == 1
