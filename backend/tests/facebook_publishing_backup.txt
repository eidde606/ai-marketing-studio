from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import verify_token
from app.database import get_db
from app.main import app
from app.models import Base, Business, Draft, SocialAccount


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
        db.add(
            SocialAccount(
                business_id=business.id,
                platform="facebook",
                platform_account_id="fake_page_123",
                account_name="Test Facebook Page",
                encrypted_access_token="encrypted_fake_token",
                connection_status="connected",
            )
        )
        db.commit()
        draft_id = draft.id

    def override_get_db():
        with Session(engine) as db:
            yield db

    # Bypass authentication only inside this test.
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}
    monkeypatch.setattr("app.main.decrypt_token", lambda value: "fake_token")

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