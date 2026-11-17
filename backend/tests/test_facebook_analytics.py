import asyncio
import logging
import json

import httpx

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import get_authenticated_principal, verify_token
from app.database import get_db
from app.features.facebook import publishing_provider
from app.main import app
from app.models import Base, Business, Draft, SocialAccount

from unittest.mock import AsyncMock

from app.models import SocialAccount
from tests.tenancy_fixtures import grant_test_owner

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
            principal = grant_test_owner(db, [business.id])

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
        app.dependency_overrides[get_authenticated_principal] = lambda: principal

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
            principal = grant_test_owner(db, [business.id])

            draft = Draft(
                business_id=business.id,
                title="Published Post",
                caption="Testing Edian",
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
        app.dependency_overrides[get_authenticated_principal] = lambda: principal

        monkeypatch.setattr(
            "app.features.analytics.service.decrypt_token",
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
            "app.features.analytics.service.get_post_insights",
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
            media_type="text",
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
            principal = grant_test_owner(db, [business.id])

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
        app.dependency_overrides[get_authenticated_principal] = lambda: principal

        monkeypatch.setattr(
            "app.features.analytics.service.decrypt_token",
            lambda token: "fake_access_token",
        )

        fake_insights = AsyncMock(
            side_effect=httpx.ConnectError("Simulated Facebook connection failure")
        )

        monkeypatch.setattr(
            "app.features.analytics.service.get_post_insights",
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


def test_facebook_analytics_does_not_use_another_business_account(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Draft business")
        other_business = Business(name="Other business")
        db.add_all([business, other_business])
        db.flush()
        grant_test_owner(db, [business.id])
        draft = Draft(
            business_id=business.id,
            title="Published Post",
            caption="Published",
            platform="facebook",
            status="approved",
            facebook_publish_status="published",
            facebook_post_id="post-a",
        )
        account = SocialAccount(
            business_id=other_business.id,
            platform="facebook",
            platform_account_id="page-b",
            account_name="Other Page",
            encrypted_access_token="fake_encrypted_token",
            connection_status="connected",
        )
        db.add_all([draft, account])
        db.commit()
        draft_id = draft.id

    insights = AsyncMock()
    monkeypatch.setattr(
        "app.features.analytics.service.get_post_insights",
        insights,
    )
    response = client.get(f"/drafts/{draft_id}/analytics/facebook")

    assert response.status_code == 409
    assert response.json() == {"detail": "Connect a Facebook Page to this business first"}
    insights.assert_not_awaited()


def test_facebook_analytics_preserves_real_zero_counts_and_statuses(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Zero metrics business")
        db.add(business)
        db.flush()
        grant_test_owner(db, [business.id])
        draft = Draft(
            business_id=business.id,
            title="Zero engagement",
            caption="Published",
            platform="facebook",
            status="approved",
            facebook_publish_status="published",
            facebook_post_id="post-zero",
        )
        account = SocialAccount(
            business_id=business.id,
            platform="facebook",
            platform_account_id="page-zero",
            account_name="Zero metrics Page",
            encrypted_access_token="fake_encrypted_token",
            connection_status="connected",
        )
        db.add_all([draft, account])
        db.commit()
        draft_id = draft.id

    monkeypatch.setattr(
        "app.features.analytics.service.decrypt_token",
        lambda _token: "fake-access-token",
    )
    monkeypatch.setattr(
        "app.features.analytics.service.get_post_insights",
        AsyncMock(
            return_value={
                "reactions": {"summary": {"total_count": 0}},
                "comments": {"summary": {"total_count": 0}},
                "shares": {"count": 0},
                "metric_status": {
                    "reactions": "available",
                    "comments": "available",
                    "shares": "available",
                },
                "post_status": "available",
                "authorization_status": "connected",
            },
        ),
    )

    response = client.get(f"/drafts/{draft_id}/analytics/facebook")

    assert response.status_code == 200
    assert response.json()["reactions"] == 0
    assert response.json()["comments"] == 0
    assert response.json()["shares"] == 0
    assert response.json()["metric_status"] == {
        "reactions": "available",
        "comments": "available",
        "shares": "available",
    }


def test_facebook_analytics_reports_missing_engagement_permission(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Permission business")
        db.add(business)
        db.flush()
        grant_test_owner(db, [business.id])
        draft = Draft(
            business_id=business.id,
            title="Permission-limited post",
            caption="Published",
            platform="facebook",
            status="approved",
            facebook_publish_status="published",
            facebook_post_id="post-permission",
        )
        account = SocialAccount(
            business_id=business.id,
            platform="facebook",
            platform_account_id="page-permission",
            account_name="Permission Page",
            encrypted_access_token="fake_encrypted_token",
            connection_status="connected",
        )
        db.add_all([draft, account])
        db.commit()
        draft_id = draft.id

    monkeypatch.setattr(
        "app.features.analytics.service.decrypt_token",
        lambda _token: "fake-access-token",
    )
    monkeypatch.setattr(
        "app.features.analytics.service.get_post_insights",
        AsyncMock(
            return_value={
                "metric_status": {
                    "reactions": "permission_required",
                    "comments": "available",
                    "shares": "unavailable",
                },
                "authorization_status": "permission_required",
                "post_status": "available",
            },
        ),
    )

    response = client.get(f"/drafts/{draft_id}/analytics/facebook")

    assert response.status_code == 200
    assert response.json()["reactions"] is None
    assert response.json()["authorization_status"] == "permission_required"
    assert response.json()["metric_status"]["reactions"] == "permission_required"
    assert response.json()["metric_status"]["comments"] == "available"


def test_facebook_analytics_provider_error_has_stable_code(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Provider error business")
        db.add(business)
        db.flush()
        grant_test_owner(db, [business.id])
        draft = Draft(
            business_id=business.id,
            title="Provider failure",
            caption="Published",
            platform="facebook",
            status="approved",
            facebook_publish_status="published",
            facebook_post_id="post-failure",
        )
        account = SocialAccount(
            business_id=business.id,
            platform="facebook",
            platform_account_id="page-failure",
            account_name="Provider error Page",
            encrypted_access_token="fake_encrypted_token",
            connection_status="connected",
        )
        db.add_all([draft, account])
        db.commit()
        draft_id = draft.id

    monkeypatch.setattr(
        "app.features.analytics.service.decrypt_token",
        lambda _token: "fake-access-token",
    )
    request = httpx.Request("GET", "https://graph.facebook.test/post")
    response = httpx.Response(500, request=request)
    monkeypatch.setattr(
        "app.features.analytics.service.get_post_insights",
        AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "provider failure", request=request, response=response,
            ),
        ),
    )

    result = client.get(f"/drafts/{draft_id}/analytics/facebook")

    assert result.status_code == 502
    assert result.headers["x-error-code"] == "facebook_provider_error"
    assert result.json() == {"detail": "Unable to retrieve Facebook analytics"}


def test_facebook_provider_returns_metric_status_and_distinguishes_zero(
    monkeypatch,
):
    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url, *, params, **_kwargs):
            fields = params["fields"]
            values = {
                "id": (200, {"id": "post-1"}),
                "id,reactions.limit(0).summary(true)": (
                    200,
                    {"id": "post-1", "reactions": {"summary": {"total_count": 0}}},
                ),
                "id,comments.limit(0).summary(true)": (
                    200,
                    {"id": "post-1", "comments": {"summary": {"total_count": 0}}},
                ),
                "id,shares": (200, {"id": "post-1", "shares": {"count": 0}}),
                "id,permalink_url": (
                    200,
                    {"id": "post-1", "permalink_url": "https://facebook.test/post"},
                ),
            }
            status, body = values[fields]
            return httpx.Response(
                status,
                json=body,
                request=httpx.Request("GET", "https://graph.facebook.test/post"),
            )

    monkeypatch.setattr(
        "app.features.facebook.publishing_provider.httpx.AsyncClient",
        FakeAsyncClient,
    )

    result = asyncio.run(
        publishing_provider.get_post_insights("post-1", "test-token"),
    )

    assert result["metric_status"] == {
        "reactions": "available",
        "comments": "available",
        "shares": "available",
    }
    assert result["reactions"]["summary"]["total_count"] == 0
    assert result["comments"]["summary"]["total_count"] == 0
    assert result["shares"]["count"] == 0


def test_facebook_provider_classifies_permission_errors(
    monkeypatch,
):
    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url, *, params, **_kwargs):
            if params["fields"] == "id,reactions.limit(0).summary(true)":
                return httpx.Response(
                    403,
                    json={"error": {"code": 200, "type": "OAuthException"}},
                    request=httpx.Request(
                        "GET", "https://graph.facebook.test/post",
                    ),
                )
            return httpx.Response(
                200,
                json={"id": "post-1"},
                request=httpx.Request("GET", "https://graph.facebook.test/post"),
            )

    monkeypatch.setattr(
        "app.features.facebook.publishing_provider.httpx.AsyncClient",
        FakeAsyncClient,
    )

    result = asyncio.run(
        publishing_provider.get_post_insights("post-1", "test-token"),
    )

    assert result["authorization_status"] == "permission_required"
    assert result["metric_status"]["reactions"] == "permission_required"
    assert result["metric_status"]["comments"] == "unavailable"
    assert result["post_status"] == "available"


def test_facebook_reach_returns_lifetime_unique_media_viewers(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Test Business")
        db.add(business)
        db.flush()
        grant_test_owner(db, [business.id])
        draft = Draft(
            business_id=business.id,
            title="Published Post",
            caption="Reach",
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

    monkeypatch.setattr(
        "app.features.analytics.service.decrypt_token",
        lambda token: "fake-access-token",
    )
    reach = AsyncMock(
        return_value={
            "data": [
                {
                    "name": "post_impressions",
                    "period": "lifetime",
                    "values": [{"value": 500}],
                },
                {
                    "name": "post_total_media_view_unique",
                    "period": "day",
                    "values": [{"value": 12}],
                },
                {
                    "name": "post_total_media_view_unique",
                    "period": "lifetime",
                    "values": [{"value": 42}],
                },
            ],
        }
    )
    monkeypatch.setattr("app.features.analytics.service.get_post_reach", reach)

    response = client.get(
        f"/drafts/{draft_id}/analytics/facebook/reach",
    )

    assert response.status_code == 200
    assert response.json() == {"unique_media_viewers": 42}
    reach.assert_awaited_once_with("123456_789012", "fake-access-token")


def test_facebook_analytics_logs_error_metadata_without_provider_body(
    monkeypatch, caplog,
):
    sensitive_body = json.dumps({
        "error": {
            "code": 190,
            "type": "OAuthException",
            "message": "PRIVATE_PROVIDER_BODY",
        },
    })
    error_response = httpx.Response(
        403,
        text=sensitive_body,
        request=httpx.Request("GET", "https://graph.facebook.test/post/likes"),
    )
    successful_response = httpx.Response(
        200,
        json={"id": "post-1"},
        request=httpx.Request("GET", "https://graph.facebook.test/post"),
    )

    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url, **_kwargs):
            return error_response if url.endswith("/likes") else successful_response

    monkeypatch.setattr(
        "app.features.facebook.publishing_provider.httpx.AsyncClient",
        FakeAsyncClient,
    )

    with caplog.at_level(
        logging.WARNING,
        logger="app.features.facebook.publishing_provider",
    ):
        result = asyncio.run(
            publishing_provider.get_post_insights(
                "post-1", "test-token", media_type="video",
            )
        )

    assert "PRIVATE_PROVIDER_BODY" not in caplog.text
    assert "status=403 code=190 type=OAuthException" in caplog.text
    assert result["authorization_status"] == "reauthorization_required"
    assert result["post_status"] == "available"
