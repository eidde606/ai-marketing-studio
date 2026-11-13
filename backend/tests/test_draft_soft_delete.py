from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import auth
from app.auth import verify_token, get_authenticated_principal
from tests.tenancy_fixtures import grant_test_owner
from app.database import get_db
from app.main import app
from app.models import Base, Business, Draft, SocialAccount, User


@pytest.fixture
def drafts_client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        business = Business(name="Test")
        db.add(business)
        db.flush()
        drafts = [Draft(business_id=business.id, title=status, caption="Keep me", platform="facebook", status=status)
                  for status in ["pending", "approved", "rejected"]]
        drafts[1].facebook_publish_status = "published"
        drafts[1].facebook_post_id = "page_post"
        drafts[1].published_at = datetime.now(timezone.utc)
        drafts[1].image_url = "retained-image"
        db.add_all(drafts)
        db.add(SocialAccount(business_id=business.id, platform="facebook", platform_account_id="page",
                             account_name="Page", encrypted_access_token="fake", connection_status="connected"))
        db.commit()
        ids = [draft.id for draft in drafts]
        business_id = business.id
        principal = grant_test_owner(db, [business_id], subject="test")
        db.commit()

    def override_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    app.dependency_overrides[verify_token] = lambda: {"sub": "test"}
    try:
        with TestClient(app) as client:
            yield client, engine, business_id, ids
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_soft_delete_preserves_records_and_history(drafts_client):
    client, engine, business_id, ids = drafts_client
    for draft_id in ids:
        response = client.delete(f"/drafts/{draft_id}")
        assert response.status_code == 200, response.text
        assert response.json()["deleted_at"]
        assert client.delete(f"/drafts/{draft_id}").json()["deleted_at"] == response.json()["deleted_at"]
    # A new request/session after deletion still excludes the items.
    assert client.get("/drafts", params={"business_id": business_id}).json() == []
    history = client.get("/drafts", params={"business_id": business_id, "include_deleted_published": True}).json()
    assert [draft["id"] for draft in history] == [ids[1]]
    with Session(engine) as db:
        for draft_id, status in zip(ids, ["pending", "approved", "rejected"]):
            assert db.get(Draft, draft_id).status == status
        published = db.get(Draft, ids[1])
        assert published.facebook_post_id == "page_post"
        assert published.facebook_publish_status == "published"
        assert published.published_at is not None
        assert published.image_url == "retained-image"
    assert client.delete("/drafts/missing").status_code == 404


@pytest.mark.parametrize("method,path,payload", [
    ("patch", "approve", None), ("patch", "reject", None),
    ("patch", "", {"title": "Changed", "caption": "Changed"}),
    ("patch", "destinations", {"destinations": ["facebook"]}),
    ("post", "publish-facebook", None),
    ("post", "publish-tiktok", {"account_id": "fake", "privacy_level": "SELF_ONLY", "disable_comment": False,
                                 "disable_duet": False, "disable_stitch": False}),
    ("post", "generate-image", None),
])
def test_deleted_draft_cannot_start_actions(drafts_client, method, path, payload):
    client, _, _, ids = drafts_client
    assert client.delete(f"/drafts/{ids[0]}").status_code == 200
    url = f"/drafts/{ids[0]}" + (f"/{path}" if path else "")
    assert client.request(method, url, json=payload).status_code == 404


@pytest.mark.parametrize("field,value", [("facebook_publish_status", "publishing"),
    ("tiktok_publish_status", "publishing"), ("image_status", "generating"), ("video_status", "uploading")])
def test_busy_draft_cannot_be_deleted(drafts_client, field, value):
    client, engine, _, ids = drafts_client
    with Session(engine) as db:
        setattr(db.get(Draft, ids[0]), field, value)
        db.commit()
    assert client.delete(f"/drafts/{ids[0]}").status_code == 409
    with Session(engine) as db:
        assert db.get(Draft, ids[0]).deleted_at is None


def test_delete_enforces_real_authorization(drafts_client, monkeypatch):
    client, engine, _, ids = drafts_client
    del app.dependency_overrides[verify_token]
    del app.dependency_overrides[get_authenticated_principal]
    assert client.delete(f"/drafts/{ids[0]}").status_code == 401
    monkeypatch.setattr(auth.jwks_client, "get_signing_key_from_jwt", lambda token: SimpleNamespace(key="fake"))
    monkeypatch.setattr(auth.jwt, "decode", lambda *args, **kwargs: {"sub": "unauthorized"})
    assert client.delete(f"/drafts/{ids[0]}", headers={"Authorization": "Bearer fake"}).status_code == 403
    with Session(engine) as db:
        assert db.get(Draft, ids[0]).deleted_at is None
    monkeypatch.setattr(auth.jwt, "decode", lambda *args, **kwargs: {
        "sub": auth.ALLOWED_USER_ID, "iss": auth.SUPABASE_ISSUER,
    })
    assert client.delete(f"/drafts/{ids[0]}", headers={"Authorization": "Bearer fake"}).status_code == 403
    with Session(engine) as db:
        assert db.get(Draft, ids[0]).deleted_at is None
        grant_test_owner(db, [db.get(Draft, ids[0]).business_id])
        db.commit()
    assert client.delete(f"/drafts/{ids[0]}", headers={"Authorization": "Bearer fake"}).status_code == 200


def test_deleted_publication_keeps_analytics(drafts_client, monkeypatch):
    client, _, _, ids = drafts_client
    monkeypatch.setattr(
        "app.features.analytics.service.decrypt_token",
        lambda token: "fake",
    )
    insights = AsyncMock(return_value={"reactions": {"summary": {"total_count": 25}},
                                      "comments": {"summary": {"total_count": 8}}, "shares": {"count": 4}})
    reach = AsyncMock(return_value={"data": [{"name": "post_total_media_view_unique", "period": "lifetime", "values": [{"value": 42}]}]})
    publish = AsyncMock()
    monkeypatch.setattr(
        "app.features.analytics.service.get_post_insights",
        insights,
    )
    monkeypatch.setattr(
        "app.features.analytics.service.get_post_reach",
        reach,
    )
    monkeypatch.setattr(
        "app.features.facebook.publishing_service.decrypt_token",
        lambda token: "fake",
    )
    monkeypatch.setattr(
        "app.features.facebook.publishing_service.publish_text_post",
        publish,
    )
    before = client.get(f"/drafts/{ids[1]}/analytics/facebook")
    before_reach = client.get(f"/drafts/{ids[1]}/analytics/facebook/reach")
    assert client.delete(f"/drafts/{ids[1]}").status_code == 200
    after = client.get(f"/drafts/{ids[1]}/analytics/facebook")
    after_reach = client.get(f"/drafts/{ids[1]}/analytics/facebook/reach")
    assert before.status_code == after.status_code == 200
    assert before.json() == after.json()
    assert before_reach.status_code == after_reach.status_code == 200
    assert before_reach.json() == after_reach.json() == {"unique_media_viewers": 42}
    publish.assert_not_awaited()


@pytest.mark.parametrize("decision,status", [("approve", "approved"), ("reject", "rejected")])
def test_active_approval_decisions_still_work(drafts_client, decision, status):
    client, _, _, ids = drafts_client
    response = client.patch(f"/drafts/{ids[0]}/{decision}")
    assert response.status_code == 200
    assert response.json()["status"] == status
    assert response.json()["deleted_at"] is None


def test_deleted_tiktok_publication_stays_in_history(drafts_client):
    client, engine, business_id, ids = drafts_client
    with Session(engine) as db:
        draft = db.get(Draft, ids[1])
        draft.facebook_publish_status = "not_published"
        draft.facebook_post_id = None
        draft.tiktok_publish_status = "published"
        draft.tiktok_publish_id = "tiktok-post"
        db.commit()
    assert client.delete(f"/drafts/{ids[1]}").status_code == 200
    active = client.get("/drafts", params={"business_id": business_id}).json()
    assert ids[1] not in [draft["id"] for draft in active]
    history = client.get("/drafts", params={"business_id": business_id, "include_deleted_published": True}).json()
    published = next(draft for draft in history if draft["id"] == ids[1])
    assert published["tiktok_publish_id"] == "tiktok-post"
    assert published["tiktok_publish_status"] == "published"


def test_browser_can_call_delete(drafts_client):
    client, _, _, ids = drafts_client
    response = client.options(f"/drafts/{ids[0]}", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "DELETE",
        "Access-Control-Request-Headers": "Authorization",
    })
    assert response.status_code == 200
    assert "DELETE" in response.headers["access-control-allow-methods"]
