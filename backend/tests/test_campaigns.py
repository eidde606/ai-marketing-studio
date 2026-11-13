from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import auth
from app.auth import verify_token
from app.database import get_db
from app.main import app
from app.models import Base, Business, Campaign, Draft


@pytest.fixture
def campaign_client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine) as db:
        businesses = [Business(name="Ángela A"), Business(name="Ángela B")]
        db.add_all(businesses)
        db.flush()
        drafts = [Draft(business_id=b.id, title="Contenido", caption="Original", platform="facebook", status="pending") for b in businesses]
        db.add_all(drafts)
        db.commit()
        business_ids = [b.id for b in businesses]
        draft_ids = [d.id for d in drafts]

    def override_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[verify_token] = lambda: {"sub": "test"}
    try:
        with TestClient(app) as client:
            yield client, engine, business_ids, draft_ids
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def create(client, business_id, **kwargs):
    response = client.post(f"/businesses/{business_id}/campaigns", json={
        "name": " Campaña de verano ", "objective": " Aumentar las visitas ", **kwargs,
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_create_read_edit_archive_and_persistence(campaign_client):
    client, engine, businesses, _ = campaign_client
    root = f"/businesses/{businesses[0]}/campaigns"
    assert client.get(root).json() == []
    campaign = create(client, businesses[0], start_date="2026-06-01", end_date="2026-06-30")
    assert campaign["name"] == "Campaña de verano"
    assert campaign["objective"] == "Aumentar las visitas"
    assert campaign["progress"] == campaign["total_count"] == 0
    url = f'{root}/{campaign["id"]}'
    assert client.get(url).json() == campaign
    assert client.get(root).json() == [campaign]
    for status in ["active", "paused", "completed", "archived", "draft"]:
        response = client.patch(url, json={"status": status})
        assert response.status_code == 200
        assert response.json()["status"] == status
    response = client.patch(url, json={"name": "Nueva", "objective": "Ventas", "start_date": None, "end_date": None})
    assert response.status_code == 200
    with Session(engine) as db:
        saved = db.get(Campaign, campaign["id"])
        assert saved.name == "Nueva" and saved.objective == "Ventas"
        assert saved.start_date is None and saved.end_date is None
        assert saved.business_id == businesses[0]


@pytest.mark.parametrize("payload", [
    {"name": "  "}, {"objective": ""}, {"status": "published"},
    {"name": "x" * 121}, {"objective": "x" * 2001},
    {"name": None}, {"objective": None}, {"status": None},
    {"start_date": "invalid"}, {"start_date": "2026-07-01", "end_date": "2026-06-01"},
])
def test_invalid_inputs(campaign_client, payload):
    client, _, businesses, _ = campaign_client
    root = f"/businesses/{businesses[0]}/campaigns"
    assert client.post(root, json={"name": "Test", "objective": "Test", **payload}).status_code == 422
    campaign = create(client, businesses[0])
    assert client.patch(f'{root}/{campaign["id"]}', json=payload).status_code == 422


def test_partial_date_validation(campaign_client):
    client, _, businesses, _ = campaign_client
    campaign = create(client, businesses[0], start_date="2026-06-01", end_date="2026-06-30")
    url = f'/businesses/{businesses[0]}/campaigns/{campaign["id"]}'
    assert client.patch(url, json={"start_date": "2026-07-01"}).status_code == 422
    assert client.patch(url, json={"end_date": "2026-05-01"}).status_code == 422
    assert client.get(url).json()["start_date"] == "2026-06-01"
    assert client.patch(url, json={"end_date": None}).status_code == 200


def test_business_isolation_and_missing_resources(campaign_client):
    client, _, businesses, drafts = campaign_client
    campaign = create(client, businesses[0])
    own = f'/businesses/{businesses[0]}/campaigns/{campaign["id"]}'
    other = f'/businesses/{businesses[1]}/campaigns/{campaign["id"]}'
    assert client.get(f'/businesses/{businesses[1]}/campaigns').json() == []
    assert client.get(other).status_code == 404
    assert client.patch(other, json={"name": "Intrusion"}).status_code == 404
    for method in ["PATCH", "DELETE"]:
        assert client.request(method, f'{other}/drafts/{drafts[0]}').status_code == 404
        assert client.request(method, f'{own}/drafts/{drafts[1]}').status_code == 404
        assert client.request(method, f'{own}/drafts/missing').status_code == 404
    assert client.get('/businesses/missing/campaigns').status_code == 404
    assert client.post('/businesses/missing/campaigns', json={"name": "a", "objective": "b"}).status_code == 404
    assert client.get(f'/businesses/{businesses[0]}/campaigns/missing').status_code == 404


def test_delete_campaign_unlinks_drafts_and_preserves_content_history(campaign_client):
    client, engine, businesses, drafts = campaign_client
    campaign = create(client, businesses[0])
    root = f'/businesses/{businesses[0]}/campaigns'
    assert client.patch(f'{root}/{campaign["id"]}/drafts/{drafts[0]}').status_code == 200
    with Session(engine) as db:
        published = db.get(Draft, drafts[0])
        published.status = "approved"
        published.facebook_publish_status = "published"
        published.facebook_post_id = "historical-post"
        published.published_at = datetime.now(timezone.utc)
        approval = Draft(
            business_id=businesses[0], campaign_id=campaign["id"],
            title="Aprobado", caption="Conservar", platform="facebook",
            status="approved",
        )
        db.add(approval)
        db.commit()
        approval_id = approval.id
        published_at = published.published_at

    response = client.delete(f'{root}/{campaign["id"]}')
    assert response.status_code == 200
    assert response.json() == {"message": "Campaña eliminada correctamente."}
    assert client.get(root).json() == []
    assert client.get(f'{root}/{campaign["id"]}').status_code == 404
    with Session(engine) as db:
        assert db.get(Campaign, campaign["id"]) is None
        published = db.get(Draft, drafts[0])
        approval = db.get(Draft, approval_id)
        assert published is not None
        assert published.campaign_id is None
        assert published.status == "approved"
        assert published.facebook_publish_status == "published"
        assert published.facebook_post_id == "historical-post"
        assert published.published_at == published_at
        assert approval is not None
        assert approval.campaign_id is None
        assert approval.status == "approved"
        assert approval.title == "Aprobado" and approval.caption == "Conservar"
    assert client.delete(f'{root}/{campaign["id"]}').status_code == 404


def test_delete_campaign_rejects_cross_business_request(campaign_client):
    client, engine, businesses, drafts = campaign_client
    campaign = create(client, businesses[0])
    root = f'/businesses/{businesses[0]}/campaigns'
    assert client.patch(f'{root}/{campaign["id"]}/drafts/{drafts[0]}').status_code == 200

    response = client.delete(
        f'/businesses/{businesses[1]}/campaigns/{campaign["id"]}',
    )
    assert response.status_code == 404
    with Session(engine) as db:
        assert db.get(Campaign, campaign["id"]) is not None
        assert db.get(Draft, drafts[0]).campaign_id == campaign["id"]


def test_associate_detach_preserves_workflow_and_archive(campaign_client):
    client, engine, businesses, drafts = campaign_client
    campaign = create(client, businesses[0])
    second = create(client, businesses[0], name="Segunda")
    root = f'/businesses/{businesses[0]}/campaigns'
    url = f'{root}/{campaign["id"]}/drafts/{drafts[0]}'
    for _ in range(2):
        response = client.patch(url)
        assert response.status_code == 200
        assert response.json()["total_count"] == 1
    assert client.patch(f'{root}/{second["id"]}/drafts/{drafts[0]}').status_code == 409
    assert client.patch(f'/drafts/{drafts[0]}', json={"title": "Editado", "caption": "Texto"}).status_code == 200
    assert client.patch(f'/drafts/{drafts[0]}/approve').status_code == 200
    assert client.patch(f'{root}/{campaign["id"]}', json={"status": "archived"}).json()["total_count"] == 1
    with Session(engine) as db:
        draft = db.get(Draft, drafts[0])
        assert draft.campaign_id == campaign["id"]
        assert draft.title == "Editado" and draft.caption == "Texto"
        assert draft.status == "approved" and draft.facebook_publish_status == "not_published"
    assert client.delete(url).json()["total_count"] == 0
    assert client.patch(f'{root}/{second["id"]}/drafts/{drafts[0]}').status_code == 200
    with Session(engine) as db:
        assert db.get(Draft, drafts[0]).status == "approved"


def test_progress_requires_confirmed_platform_record(campaign_client):
    client, engine, businesses, _ = campaign_client
    campaign = create(client, businesses[0])
    now = datetime.now(timezone.utc)
    cases = [
        {"status": "pending"},
        {"status": "approved"},  # Manual downloads/copies do not record publication.
        {"status": "rejected"},
        {"facebook_publish_status": "publishing", "facebook_post_id": "processing"},
        {"facebook_publish_status": "needs_review", "facebook_post_id": "uncertain"},
        {"facebook_publish_status": "published"},  # Missing publication ID.
        {"tiktok_publish_status": "published"},
        {"published_at": now},  # Timestamp alone is insufficient.
        {"facebook_post_id": "id-only"},
        {"facebook_publish_status": "published", "facebook_post_id": "fb"},
        {"tiktok_publish_status": "published", "tiktok_publish_id": "tt"},
        {"facebook_publish_status": "published", "facebook_post_id": "both-fb", "tiktok_publish_status": "published", "tiktok_publish_id": "both-tt"},
        {"deleted_at": now, "facebook_publish_status": "published", "facebook_post_id": "history"},
        {"deleted_at": now, "tiktok_publish_status": "published", "tiktok_publish_id": "history-tt"},
        {"deleted_at": now, "status": "pending"},
        {"deleted_at": now, "status": "rejected"},
        {"deleted_at": now, "published_at": now},
        {"deleted_at": now, "facebook_publish_status": "published"},
    ]
    with Session(engine) as db:
        for i, fields in enumerate(cases):
            db.add(Draft(business_id=businesses[0], campaign_id=campaign["id"], title=f"Case {i}", caption="Test", platform="facebook", **fields))
        db.commit()
    result = client.get(f'/businesses/{businesses[0]}/campaigns/{campaign["id"]}').json()
    assert result["total_count"] == 14
    assert result["published_count"] == 5  # Dual-platform content counts once.
    assert result["pending_count"] == 9
    assert result["rejected_count"] == 1
    assert result["progress"] == 35.7
    assert len(result["drafts"]) == 14
    assert client.get(f'/businesses/{businesses[0]}/campaigns').json()[0] == result


def test_soft_delete_updates_progress_without_losing_publications(campaign_client):
    client, engine, businesses, drafts = campaign_client
    campaign = create(client, businesses[0])
    root = f'/businesses/{businesses[0]}/campaigns/{campaign["id"]}'
    assert client.patch(f'{root}/drafts/{drafts[0]}').status_code == 200
    assert client.delete(f'/drafts/{drafts[0]}').status_code == 200
    assert client.get(root).json()["total_count"] == 0
    assert client.patch(f'{root}/drafts/{drafts[0]}').status_code == 404
    with Session(engine) as db:
        draft = db.get(Draft, drafts[0])
        draft.facebook_publish_status = "published"
        draft.facebook_post_id = "historical-post"
        db.commit()
    result = client.get(root).json()
    assert result["published_count"] == 1 and result["progress"] == 100
    assert client.delete(f'{root}/drafts/{drafts[0]}').status_code == 200
    with Session(engine) as db:
        draft = db.get(Draft, drafts[0])
        assert draft.deleted_at and draft.facebook_post_id == "historical-post"


def test_all_campaign_endpoints_require_auth(campaign_client, monkeypatch):
    client, _, businesses, drafts = campaign_client
    campaign = create(client, businesses[0])
    root = f'/businesses/{businesses[0]}/campaigns'
    detail = f'{root}/{campaign["id"]}'
    del app.dependency_overrides[verify_token]
    operations = [
        ("GET", root, None), ("POST", root, {"name": "Test", "objective": "Test"}),
        ("GET", detail, None), ("PATCH", detail, {"status": "active"}),
        ("DELETE", detail, None),
        ("PATCH", f'{detail}/drafts/{drafts[0]}', None),
        ("DELETE", f'{detail}/drafts/{drafts[0]}', None),
    ]
    monkeypatch.setattr(auth.jwks_client, "get_signing_key_from_jwt", lambda token: SimpleNamespace(key="fake"))
    monkeypatch.setattr(auth.jwt, "decode", lambda *args, **kwargs: {"sub": "unauthorized"})
    for method, url, body in operations:
        assert client.request(method, url, json=body).status_code == 401
        assert client.request(method, url, json=body, headers={"Authorization": "Bearer fake"}).status_code == 403
    monkeypatch.setattr(auth.jwt, "decode", lambda *args, **kwargs: {"sub": auth.ALLOWED_USER_ID})
    assert client.get(root, headers={"Authorization": "Bearer fake"}).status_code == 200


def test_existing_facebook_workflow_updates_campaign_progress(campaign_client, monkeypatch):
    from unittest.mock import AsyncMock
    from app.models import SocialAccount

    client, engine, businesses, drafts = campaign_client
    campaign = create(client, businesses[0])
    root = f'/businesses/{businesses[0]}/campaigns/{campaign["id"]}'
    assert client.patch(f'{root}/drafts/{drafts[0]}').status_code == 200
    with Session(engine) as db:
        db.add(SocialAccount(
            business_id=businesses[0], platform="facebook", platform_account_id="page",
            account_name="Test page", encrypted_access_token="fake",
        ))
        db.commit()
    monkeypatch.setattr(
        "app.features.facebook.publishing_service.decrypt_token",
        lambda value: "fake",
    )
    publish = AsyncMock(return_value={"id": "confirmed-post"})
    monkeypatch.setattr(
        "app.features.facebook.publishing_service.publish_text_post",
        publish,
    )
    assert client.patch(f'/drafts/{drafts[0]}/approve').status_code == 200
    assert client.get(root).json()["progress"] == 0
    assert client.post(f'/drafts/{drafts[0]}/publish-facebook').status_code == 200
    publish.assert_awaited_once()
    result = client.get(root).json()
    assert result["progress"] == 100 and result["published_count"] == 1
    assert client.delete(f'/drafts/{drafts[0]}').status_code == 200
    assert client.get(root).json()["progress"] == 100
    with Session(engine) as db:
        draft = db.get(Draft, drafts[0])
        assert draft.campaign_id == campaign["id"]
        assert draft.facebook_post_id == "confirmed-post"


def test_response_shape_ordering_and_cross_business_content_filter(campaign_client):
    client, engine, businesses, _ = campaign_client
    first = create(client, businesses[0], name="Primera")
    second = create(client, businesses[0], name="Segunda")
    same_time = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with Session(engine) as db:
        for campaign_id in (first["id"], second["id"]):
            db.get(Campaign, campaign_id).created_at = same_time
        for draft_id, title, business_id in [
            ("draft-z", "beta", businesses[0]),
            ("draft-b", "Alpha", businesses[0]),
            ("draft-a", "alpha", businesses[0]),
            ("other-business", "Invisible", businesses[1]),
        ]:
            db.add(Draft(id=draft_id, business_id=business_id, campaign_id=first["id"],
                         title=title, caption="Original", platform="facebook"))
        db.commit()
    response = client.get(f'/businesses/{businesses[0]}/campaigns')
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == sorted([first["id"], second["id"]])
    detail = client.get(f'/businesses/{businesses[0]}/campaigns/{first["id"]}').json()
    assert set(detail) == {
        "id", "business_id", "name", "objective", "status", "start_date", "end_date",
        "created_at", "updated_at", "total_count", "published_count", "pending_count",
        "rejected_count", "progress", "drafts",
    }
    assert detail["start_date"] is None and detail["end_date"] is None
    assert [item["id"] for item in detail["drafts"]] == ["draft-a", "draft-b", "draft-z"]
    assert detail["total_count"] == detail["pending_count"] == 3
    for item in detail["drafts"]:
        assert set(item) == {"id", "title", "status", "platform", "published", "deleted_at"}
        assert item["published"] is False and item["deleted_at"] is None


def test_campaign_error_details_are_preserved(campaign_client):
    client, _, businesses, drafts = campaign_client
    first = create(client, businesses[0])
    second = create(client, businesses[0], name="Otra")
    root = f'/businesses/{businesses[0]}/campaigns'
    first_draft = f'{root}/{first["id"]}/drafts/{drafts[0]}'
    assert client.patch(first_draft).status_code == 200
    cases = [
        ("GET", "/businesses/missing/campaigns", None, 404, "Negocio no encontrado."),
        ("GET", f"{root}/missing", None, 404, "Campaña no encontrada para este negocio."),
        ("PATCH", f'{root}/{first["id"]}/drafts/{drafts[1]}', None, 404, "Contenido no encontrado para este negocio."),
        ("PATCH", f'{root}/{second["id"]}/drafts/{drafts[0]}', None, 409,
         "Desvincula el contenido de su campaña actual antes de asociarlo."),
        ("DELETE", f'{root}/{second["id"]}/drafts/{drafts[0]}', None, 404,
         "El contenido no pertenece a esta campaña."),
        ("PATCH", f'{root}/{first["id"]}', {"start_date": "2026-07-01", "end_date": "2026-06-01"},
         422, "La fecha final no puede ser anterior a la inicial."),
    ]
    for method, url, payload, status, message in cases:
        response = client.request(method, url, json=payload)
        assert response.status_code == status
        assert response.json() == {"detail": message}


def test_failed_delete_commit_keeps_campaign_and_association(campaign_client, monkeypatch):
    client, engine, businesses, drafts = campaign_client
    campaign = create(client, businesses[0])
    url = f'/businesses/{businesses[0]}/campaigns/{campaign["id"]}'
    assert client.patch(f'{url}/drafts/{drafts[0]}').status_code == 200

    def fail_commit(_session):
        raise RuntimeError("Simulated commit failure")

    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", fail_commit)
        with pytest.raises(RuntimeError, match="Simulated commit failure"):
            client.delete(url)
    # Closing the request session must roll back the unlink together with deletion.
    with Session(engine) as db:
        assert db.get(Campaign, campaign["id"]) is not None
        draft = db.get(Draft, drafts[0])
        assert draft.campaign_id == campaign["id"]
        assert draft.caption == "Original"
        assert draft.status == "pending"
