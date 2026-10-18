from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import verify_token
from app.database import get_db
from app.main import app
from app.models import Base, Business, Draft


def test_pending_draft_cannot_be_published(monkeypatch):
    # Create an isolated in-memory test database.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    Base.metadata.create_all(engine)

    # Add a fake business and an unapproved draft.
    with Session(engine) as db:
        business = Business(name="Test Business")
        db.add(business)
        db.flush()

        draft = Draft(
            business_id=business.id,
            title="Test Post",
            caption="This should not be published.",
            platform="facebook",
            status="pending",
        )
        db.add(draft)
        db.commit()
        draft_id = draft.id

    def override_get_db():
        with Session(engine) as db:
            yield db

    # Bypass authentication only inside this test.
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}

    # Replace Facebook publishing with a mock.
    fake_publish = AsyncMock(return_value={"id": "fake_post_123"})
    monkeypatch.setattr(
        "app.main.publish_text_post",
        fake_publish,
    )

    try:
        with TestClient(app) as client:
            response = client.post(
                f"/drafts/{draft_id}/publish-facebook"
            )

        assert response.status_code == 409
        fake_publish.assert_not_awaited()

        with Session(engine) as db:
            saved_draft = db.get(Draft, draft_id)
            assert saved_draft.facebook_publish_status == "not_published"

    finally:
        app.dependency_overrides.clear()
        engine.dispose()

def test_approved_draft_publishes_successfully(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    Base.metadata.create_all(engine)

    with Session(engine) as db:
        business = Business(name="Test Business")
        db.add(business)
        db.flush()

        draft = Draft(
            business_id=business.id,
            title="Approved Post",
            caption="Ready for Facebook!",
            platform="facebook",
            status="approved",
        )
        db.add(draft)
        db.commit()
        draft_id = draft.id

    def override_get_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}

    monkeypatch.setenv("FACEBOOK_PAGE_ID", "fake_page_123")
    monkeypatch.setenv("FACEBOOK_PAGE_ACCESS_TOKEN", "fake_token")

    fake_publish = AsyncMock(return_value={"id": "fake_post_123"})
    monkeypatch.setattr("app.main.publish_text_post", fake_publish)

    try:
        with TestClient(app) as client:
            response = client.post(
                f"/drafts/{draft_id}/publish-facebook"
            )

        assert response.status_code == 200
        assert response.json()["facebook_post_id"] == "fake_post_123"

        fake_publish.assert_awaited_once()

        with Session(engine) as db:
            saved_draft = db.get(Draft, draft_id)

            assert saved_draft.facebook_publish_status == "published"
            assert saved_draft.facebook_post_id == "fake_post_123"
            assert saved_draft.published_at is not None

    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_published_draft_cannot_be_published_again(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        business = Business(name="Test Business")
        db.add(business)
        db.flush()

        draft = Draft(
            business_id=business.id,
            title="Already Published",
            caption="This post was already published.",
            platform="facebook",
            status="approved",
            facebook_publish_status="published",
            facebook_post_id="existing_post_123",
        )
        db.add(draft)
        db.commit()
        draft_id = draft.id

    def override_get_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}

    fake_publish = AsyncMock(return_value={"id": "another_post"})
    monkeypatch.setattr("app.main.publish_text_post", fake_publish)

    try:
        with TestClient(app) as client:
            response = client.post(
                f"/drafts/{draft_id}/publish-facebook"
            )

        assert response.status_code == 409
        fake_publish.assert_not_awaited()

        with Session(engine) as db:
            saved_draft = db.get(Draft, draft_id)
            assert saved_draft.facebook_post_id == "existing_post_123"
            assert saved_draft.facebook_publish_status == "published"

    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_facebook_failure_requires_review(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        business = Business(name="Test Business")
        db.add(business)
        db.flush()

        draft = Draft(
            business_id=business.id,
            title="Failed Publication",
            caption="Testing a failed Facebook request.",
            platform="facebook",
            status="approved",
        )
        db.add(draft)
        db.commit()
        draft_id = draft.id

    def override_get_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}

    monkeypatch.setenv("FACEBOOK_PAGE_ID", "fake_page_123")
    monkeypatch.setenv("FACEBOOK_PAGE_ACCESS_TOKEN", "fake_token")

    fake_publish = AsyncMock(
        side_effect=RuntimeError("Simulated Facebook connection failure")
    )
    monkeypatch.setattr("app.main.publish_text_post", fake_publish)

    try:
        with TestClient(app) as client:
            response = client.post(
                f"/drafts/{draft_id}/publish-facebook"
            )

        assert response.status_code == 502
        fake_publish.assert_awaited_once()

        with Session(engine) as db:
            saved_draft = db.get(Draft, draft_id)
            assert saved_draft.facebook_publish_status == "needs_review"
            assert saved_draft.facebook_post_id is None
            assert saved_draft.published_at is None

    finally:
        app.dependency_overrides.clear()
        engine.dispose()

def test_approved_draft_publishes_image_and_caption(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        business = Business(name="Image Test Business")
        db.add(business)
        db.flush()

        draft = Draft(
            business_id=business.id,
            title="Image Post",
            caption="Check out our new products!",
            platform="facebook",
            status="approved",
            image_url=f"{business.id}/marketing/test-image.png",
        )
        db.add(draft)
        db.commit()
        draft_id = draft.id
        business_id = business.id

    def override_get_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}

    monkeypatch.setenv("FACEBOOK_PAGE_ID", "fake_page_123")
    monkeypatch.setenv("FACEBOOK_PAGE_ACCESS_TOKEN", "fake_token")

    fake_image = bytes.fromhex("89504e470d0a1a0a") + b"fake-image-bytes"

    from unittest.mock import Mock

    fake_download = Mock(return_value=fake_image)
    fake_publish_image = AsyncMock(
        return_value={"id": "fake_photo_123", "post_id": "fake_post_456"}
    )
    fake_publish_text = AsyncMock()

    monkeypatch.setattr(
        "app.main.download_marketing_image",
        fake_download,
    )
    monkeypatch.setattr(
        "app.main.publish_image_post",
        fake_publish_image,
    )
    monkeypatch.setattr(
        "app.main.publish_text_post",
        fake_publish_text,
    )

    try:
        with TestClient(app) as client:
            response = client.post(
                f"/drafts/{draft_id}/publish-facebook"
            )

        assert response.status_code == 200, response.text
        assert response.json()["facebook_post_id"] == "fake_post_456"

        fake_download.assert_called_once_with(
            f"{business_id}/marketing/test-image.png",
            business_id,
        )

        fake_publish_image.assert_awaited_once_with(
            page_id="fake_page_123",
            access_token="fake_token",
            message="Check out our new products!",
            image_bytes=fake_image,
        )

        fake_publish_text.assert_not_awaited()

        with Session(engine) as db:
            saved_draft = db.get(Draft, draft_id)

            assert saved_draft.facebook_publish_status == "published"
            assert saved_draft.facebook_post_id == "fake_post_456"
            assert saved_draft.published_at is not None

    finally:
        app.dependency_overrides.clear()
        engine.dispose()
