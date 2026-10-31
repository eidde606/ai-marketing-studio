from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import verify_token
from app.database import get_db
from app.main import app
from app.models import Base, Business, Draft

from unittest.mock import AsyncMock

from app.models import SocialAccount

import httpx


def test_unpublished_draft_has_no_analytics():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    Base.metadata.create_all(engine)

    try:
        with Session(engine) as db:
            business = Business(name="Test Business")
            db.add(business)
            db.flush()

            draft = Draft(
                business_id=business.id,
                title="Unpublished Post",
                caption="Testing analytics",
                platform="facebook",
                status="pending",
            )

            db.add(draft)
            db.commit()
            draft_id = draft.id

        def override_get_db():
            with Session(engine) as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}

        with TestClient(app) as client:
            response = client.get(f"/drafts/{draft_id}/analytics/facebook")

        assert response.status_code == 409

    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_published_draft_returns_facebook_analytics(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    Base.metadata.create_all(engine)

    try:
        with Session(engine) as db:
            business = Business(name="Test Business")
            db.add(business)
            db.flush()

            draft = Draft(
                business_id=business.id,
                title="Published Post",
                caption="Testing Mía",
                platform="facebook",
                status="approved",
                facebook_publish_status="published",
                facebook_post_id="123456_789012",
            )

            account = SocialAccount(
                business_id=business.id,
                platform="facebook",
                platform_account_id="123456",
                account_name="Test Facebook Page",
                encrypted_access_token="fake_encrypted_token",
                connection_status="connected",
            )

            db.add_all([draft, account])
            db.commit()
            draft_id = draft.id

        def override_get_db():
            with Session(engine) as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}

        monkeypatch.setattr(
            "app.main.decrypt_token",
            lambda token: "fake_access_token",
        )

        fake_insights = AsyncMock(
            return_value={
                "id": "123456_789012",
                "reactions": {"summary": {"total_count": 25}},
                "comments": {"summary": {"total_count": 8}},
                "shares": {"count": 4},
                "permalink_url": "https://www.facebook.com/example",
            }
        )

        monkeypatch.setattr(
            "app.main.get_post_insights",
            fake_insights,
        )

        with TestClient(app) as client:
            response = client.get(f"/drafts/{draft_id}/analytics/facebook")

        assert response.status_code == 200, response.text

        data = response.json()

        assert data["reactions"] == 25
        assert data["comments"] == 8
        assert data["shares"] == 4
        assert data["platform"] == "facebook"

        fake_insights.assert_awaited_once_with(
            post_id="123456_789012",
            access_token="fake_access_token",
        )

    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_facebook_analytics_api_failure(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    Base.metadata.create_all(engine)

    try:
        with Session(engine) as db:
            business = Business(name="Test Business")
            db.add(business)
            db.flush()

            draft = Draft(
                business_id=business.id,
                title="Published Post",
                caption="Testing Facebook failure",
                platform="facebook",
                status="approved",
                facebook_publish_status="published",
                facebook_post_id="123456_789012",
            )

            account = SocialAccount(
                business_id=business.id,
                platform="facebook",
                platform_account_id="123456",
                account_name="Test Facebook Page",
                encrypted_access_token="fake_encrypted_token",
                connection_status="connected",
            )

            db.add_all([draft, account])
            db.commit()
            draft_id = draft.id

        def override_get_db():
            with Session(engine) as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}

        monkeypatch.setattr(
            "app.main.decrypt_token",
            lambda token: "fake_access_token",
        )

        fake_insights = AsyncMock(
            side_effect=httpx.ConnectError("Simulated Facebook connection failure")
        )

        monkeypatch.setattr(
            "app.main.get_post_insights",
            fake_insights,
        )

        with TestClient(app) as client:
            response = client.get(f"/drafts/{draft_id}/analytics/facebook")

        assert response.status_code == 502
        assert response.json()["detail"] == (
            "Facebook analytics service is unavailable"
        )

        fake_insights.assert_awaited_once()

    finally:
        app.dependency_overrides.clear()
        engine.dispose()
