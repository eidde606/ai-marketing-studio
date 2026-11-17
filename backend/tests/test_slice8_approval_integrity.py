"""Approval freezes current content and rejects unresolved media operations."""
import pytest
from sqlalchemy.orm import Session
from app.models import Business, Draft, ImageRevision
from tests.tenancy_fixtures import grant_test_owner


@pytest.fixture
def pending(isolated_client):
    client, engine = isolated_client
    with Session(engine) as db:
        db.add(Business(id="a", name="A"))
        db.flush()
        grant_test_owner(db, ["a"])
        db.add(Draft(id="draft", business_id="a", title="Original", caption="Caption", platform="facebook"))
        db.commit()
    return client, engine


@pytest.mark.parametrize("field,state", [
    ("image_status", "generating"), ("image_status", "needs_review"),
    ("video_status", "generating"), ("video_status", "uploading"), ("video_status", "needs_review"),
])
def test_unresolved_media_blocks_approval(pending, field, state):
    client, engine = pending
    with Session(engine) as db:
        setattr(db.get(Draft, "draft"), field, state)
        db.commit()
    assert client.patch("/drafts/draft/approve").status_code == 409
    with Session(engine) as db:
        assert db.get(Draft, "draft").status == "pending"


def test_active_revision_blocks_approval(pending):
    client, engine = pending
    with Session(engine) as db:
        db.add(ImageRevision(draft_id="draft", original_image_path="original", instructions="Edit", status="generating"))
        db.commit()
    assert client.patch("/drafts/draft/approve").status_code == 409


def test_approved_content_and_destinations_are_immutable(pending):
    client, engine = pending
    assert client.patch("/drafts/draft/approve").status_code == 200
    assert client.patch("/drafts/draft", json={"title": "Changed", "caption": "Changed"}).status_code == 409
    assert client.patch("/drafts/draft/destinations", json={"destinations": ["tiktok"]}).status_code == 409
    with Session(engine) as db:
        draft = db.get(Draft, "draft")
        assert draft.title == "Original"
        assert draft.status == "approved"
        assert draft.published_at is None
        assert draft.facebook_post_id is None


@pytest.mark.parametrize("destinations", [["instagram"], ["facebook", "facebook"]])
def test_invalid_persisted_destinations_cannot_be_approved(pending, destinations):
    client, engine = pending
    with Session(engine) as db:
        db.get(Draft, "draft").publish_destinations = destinations
        db.commit()
    assert client.patch("/drafts/draft/approve").status_code == 409


def test_manual_content_rejects_unsupported_platform_and_client_approval(pending):
    client, _ = pending
    payload = {"business_id": "a", "title": "Title", "caption": "Caption", "platform": "unknown"}
    assert client.post("/drafts", json=payload).status_code == 400
    assert client.post("/drafts", json={**payload, "platform": "Facebook", "status": "approved"}).status_code == 422


def test_manual_approval_needs_no_social_connection_and_does_not_publish(pending):
    client, engine = pending
    saved = client.patch("/drafts/draft/destinations", json={"destinations": []})
    assert saved.status_code == 200
    assert saved.json()["publish_destinations"] == []
    assert client.patch("/drafts/draft/approve").status_code == 200
    with Session(engine) as db:
        draft = db.get(Draft, "draft")
        assert draft.status == "approved"
        assert draft.publish_destinations == []
        assert draft.facebook_post_id is None
        assert draft.tiktok_publish_id is None
        assert draft.published_at is None
