"""Instagram publication behavior using provider mocks only."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from PIL import Image
from sqlalchemy.orm import Session
from io import BytesIO

from app.errors import ApplicationError, ErrorKind
from app.models import (
    Business,
    BusinessMembership,
    Draft,
    InstagramConnection,
    SocialAccount,
)
from tests.tenancy_fixtures import grant_test_owner


def valid_jpeg_bytes():
    output = BytesIO()
    Image.new("RGB", (640, 480), "blue").save(output, format="JPEG")
    return output.getvalue()


@pytest.fixture
def instagram_case(isolated_client, monkeypatch):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Instagram Test Business")
        db.add(business)
        db.flush()
        grant_test_owner(db, [business.id])
        draft = Draft(
            business_id=business.id,
            title="Approved image",
            caption="An approved caption",
            platform="instagram",
            status="approved",
            publish_destinations=["instagram"],
            media_type="image",
            image_status="completed",
            image_url=f"businesses/{business.id}/approved.jpg",
        )
        db.add(draft)
        db.add(
            SocialAccount(
                business_id=business.id,
                platform="facebook",
                platform_account_id="test-page-id",
                account_name="Test Page",
                encrypted_access_token="encrypted-page-token",
                connection_status="connected",
            )
        )
        db.add(
            InstagramConnection(
                business_id=business.id,
                instagram_account_id="test-instagram-id",
                username="test_account",
                facebook_page_id="test-page-id",
                encrypted_access_token="encrypted-instagram-token",
                token_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
                granted_permissions=[
                    "instagram_basic",
                    "instagram_content_publish",
                ],
                status="connected_and_authorized",
            )
        )
        db.commit()
        business_id, draft_id = business.id, draft.id

    calls = {
        "create": AsyncMock(return_value="container-id"),
        "status": AsyncMock(return_value="FINISHED"),
        "publish": AsyncMock(return_value="instagram-media-id"),
        "permalink": AsyncMock(
            return_value="https://www.instagram.com/p/test-post/"
        ),
    }
    monkeypatch.setattr(
        "app.features.instagram.publishing_service.decrypt_token",
        lambda _: "mock-access-token",
    )
    monkeypatch.setattr(
        "app.features.instagram.publishing_service.download_marketing_image",
        Mock(return_value=valid_jpeg_bytes()),
    )
    monkeypatch.setattr(
        "app.features.instagram.publishing_service.get_marketing_image_url",
        Mock(return_value="https://media.example.com/signed-image.jpg"),
    )
    monkeypatch.setattr(
        "app.features.instagram.publishing_provider.create_image_container",
        calls["create"],
    )
    monkeypatch.setattr(
        "app.features.instagram.publishing_provider.get_container_status",
        calls["status"],
    )
    monkeypatch.setattr(
        "app.features.instagram.publishing_provider.publish_container",
        calls["publish"],
    )
    monkeypatch.setattr(
        "app.features.instagram.publishing_provider.get_media_permalink",
        calls["permalink"],
    )
    monkeypatch.setattr(
        "app.features.instagram.publishing_service.CONTAINER_POLL_INTERVAL_SECONDS",
        0,
    )
    return SimpleNamespace(
        client=client,
        engine=engine,
        business_id=business_id,
        draft_id=draft_id,
        url=f"/drafts/{draft_id}/publish-instagram",
        calls=calls,
    )


def saved_publication(case):
    with Session(case.engine) as db:
        return db.get(Draft, case.draft_id)


def test_approved_jpeg_publishes_and_persists_instagram_only(instagram_case):
    case = instagram_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.facebook_publish_status = "published"
        draft.facebook_post_id = "existing-facebook-post"
        db.commit()

    response = case.client.post(case.url)

    assert response.status_code == 200
    assert response.json() == {
        "status": "published",
        "instagram_media_id": "instagram-media-id",
        "instagram_permalink": "https://www.instagram.com/p/test-post/",
    }
    case.calls["create"].assert_awaited_once_with(
        "test-instagram-id",
        "mock-access-token",
        "https://media.example.com/signed-image.jpg",
        "An approved caption",
    )
    case.calls["status"].assert_awaited_once_with(
        "container-id", "mock-access-token"
    )
    case.calls["publish"].assert_awaited_once_with(
        "test-instagram-id", "container-id", "mock-access-token"
    )
    saved = saved_publication(case)
    assert saved.instagram_publish_status == "published"
    assert saved.instagram_media_id == "instagram-media-id"
    assert saved.instagram_permalink == "https://www.instagram.com/p/test-post/"
    assert saved.instagram_published_at is not None
    assert saved.facebook_publish_status == "published"
    assert saved.facebook_post_id == "existing-facebook-post"
    assert saved.publish_destinations == ["instagram"]
    assert case.client.post(case.url).status_code == 409
    case.calls["publish"].assert_awaited_once()


@pytest.mark.parametrize(
    "change, expected_detail",
    [
        ("pending", "Only approved content can be published"),
        ("permission", "Instagram publishing permission is missing. Reconnect Instagram"),
        ("expired", "Instagram authorization expired. Reconnect Instagram before publishing"),
    ],
)
def test_approval_permission_and_expiry_are_checked_before_provider(
    instagram_case, change, expected_detail
):
    case = instagram_case
    with Session(case.engine) as db:
        if change == "pending":
            db.get(Draft, case.draft_id).status = "pending"
        elif change == "permission":
            db.get(InstagramConnection, case.business_id).granted_permissions = [
                "instagram_basic"
            ]
        else:
            db.get(InstagramConnection, case.business_id).token_expires_at = (
                datetime.now(timezone.utc) - timedelta(minutes=1)
            )
        db.commit()

    response = case.client.post(case.url)

    assert response.status_code == 409
    assert response.json() == {"detail": expected_detail}
    case.calls["create"].assert_not_awaited()
    case.calls["publish"].assert_not_awaited()
    assert saved_publication(case).instagram_publish_status == "not_published"


@pytest.mark.parametrize(
    "media_type,image_status,image_url",
    [
        ("video", "completed", "businesses/example/image.jpg"),
        ("image", "not_started", None),
        ("image", "generating", "businesses/example/image.jpg"),
        ("image", "completed", None),
        ("image", "completed", "businesses/example/image.png"),
        ("image", "completed", "businesses/example/image.webp"),
    ],
)
def test_ineligible_media_is_rejected_before_provider_submission(
    instagram_case, media_type, image_status, image_url
):
    case = instagram_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.media_type = media_type
        draft.image_status = image_status
        draft.image_url = image_url
        db.commit()

    response = case.client.post(case.url)

    assert response.status_code == 409
    assert response.json() == {
        "detail": (
            "Instagram publishing requires an approved JPEG image and a caption of "
            "2,200 characters or fewer"
        )
    }
    case.calls["create"].assert_not_awaited()
    assert saved_publication(case).instagram_publish_status == "not_published"


def test_member_cannot_publish(instagram_case):
    case = instagram_case
    with Session(case.engine) as db:
        db.query(BusinessMembership).filter_by(
            business_id=case.business_id
        ).one().role = "member"
        db.commit()

    response = case.client.post(case.url)

    assert response.status_code == 403
    assert response.json() == {"detail": "Operation not permitted"}
    case.calls["create"].assert_not_awaited()
    assert saved_publication(case).instagram_publish_status == "not_published"


def test_other_tenant_draft_is_not_found(instagram_case):
    case = instagram_case
    with Session(case.engine) as db:
        other_business = Business(name="Other Tenant")
        db.add(other_business)
        db.flush()
        other_draft = Draft(
            business_id=other_business.id,
            title="Other tenant image",
            caption="Private",
            platform="instagram",
            status="approved",
            publish_destinations=["instagram"],
        )
        db.add(other_draft)
        db.commit()
        other_draft_id = other_draft.id

    response = case.client.post(
        f"/drafts/{other_draft_id}/publish-instagram"
    )

    assert response.status_code == 404
    case.calls["create"].assert_not_awaited()


def test_instagram_connection_cannot_use_another_tenants_facebook_page(
    instagram_case,
):
    case = instagram_case
    with Session(case.engine) as db:
        other_business = Business(name="Page Owner")
        db.add(other_business)
        db.flush()
        db.add(
            SocialAccount(
                business_id=other_business.id,
                platform="facebook",
                platform_account_id="other-tenant-page",
                account_name="Other Tenant Page",
                encrypted_access_token="other-page-token",
                connection_status="connected",
            )
        )
        db.get(InstagramConnection, case.business_id).facebook_page_id = (
            "other-tenant-page"
        )
        db.commit()

    response = case.client.post(case.url)

    assert response.status_code == 409
    assert response.json() == {
        "detail": "The Facebook Page linked to Instagram is no longer connected"
    }
    case.calls["create"].assert_not_awaited()


@pytest.mark.parametrize(
    "image_bytes,image_url",
    [
        (b"not-jpeg", "https://media.example.com/image.jpg"),
        (valid_jpeg_bytes(), "http://127.0.0.1/image.jpg"),
    ],
)
def test_invalid_or_nonpublic_media_never_contacts_meta(
    instagram_case, monkeypatch, image_bytes, image_url
):
    case = instagram_case
    monkeypatch.setattr(
        "app.features.instagram.publishing_service.download_marketing_image",
        Mock(return_value=image_bytes),
    )
    monkeypatch.setattr(
        "app.features.instagram.publishing_service.get_marketing_image_url",
        Mock(return_value=image_url),
    )

    response = case.client.post(case.url)

    assert response.status_code == 400
    assert response.json() == {
        "detail": (
            "Instagram requires an accessible JPEG image smaller than 8 MB"
            if image_bytes == b"not-jpeg"
            else "Instagram media must be available from a public HTTPS URL"
        )
    }
    case.calls["create"].assert_not_awaited()
    assert saved_publication(case).instagram_publish_status == "not_published"


def test_container_failure_is_retryable_without_publishing(instagram_case):
    case = instagram_case
    case.calls["status"].side_effect = ["ERROR", "FINISHED"]

    response = case.client.post(case.url)

    assert response.status_code == 502
    assert saved_publication(case).instagram_publish_status == "failed"
    case.calls["publish"].assert_not_awaited()
    retry = case.client.post(case.url)
    assert retry.status_code == 200
    assert case.calls["publish"].await_count == 1


def test_container_polling_is_bounded_and_timeout_remains_retryable(instagram_case):
    case = instagram_case
    case.calls["status"].return_value = "IN_PROGRESS"

    response = case.client.post(case.url)

    assert response.status_code == 502
    assert case.calls["status"].await_count == 5
    case.calls["publish"].assert_not_awaited()
    assert saved_publication(case).instagram_publish_status == "failed"


def test_rate_limit_failure_is_safely_retryable(instagram_case, monkeypatch):
    from app.features.instagram.publishing_provider import (
        InstagramPublishingProviderError,
    )

    case = instagram_case
    case.calls["publish"].side_effect = InstagramPublishingProviderError(429, 4)

    response = case.client.post(case.url)

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Instagram is rate limited. Wait and retry publication"
    }
    assert saved_publication(case).instagram_publish_status == "failed"
    case.calls["publish"].assert_awaited_once()


@pytest.mark.parametrize(
    "error_code, expected_status",
    [(190, "reauthorization_required"), (10, "permission_error")],
)
def test_meta_credential_and_permission_errors_update_connection_safely(
    instagram_case, error_code, expected_status
):
    from app.features.instagram.publishing_provider import (
        InstagramPublishingProviderError,
    )

    case = instagram_case
    case.calls["create"].side_effect = InstagramPublishingProviderError(
        400, error_code
    )

    response = case.client.post(case.url)

    assert response.status_code == 502
    with Session(case.engine) as db:
        connection = db.get(InstagramConnection, case.business_id)
        assert connection.status == expected_status
        assert connection.encrypted_access_token == "encrypted-instagram-token"
    assert saved_publication(case).instagram_publish_status == "failed"
    case.calls["publish"].assert_not_awaited()


def test_ambiguous_publish_failure_is_not_retried_and_logs_are_sanitized(
    instagram_case, caplog
):
    case = instagram_case
    case.calls["publish"].side_effect = httpx.ReadTimeout(
        "mock-access-token https://media.example.com/private-signed-url"
    )

    with caplog.at_level(logging.WARNING):
        response = case.client.post(case.url)

    assert response.status_code == 502
    assert saved_publication(case).instagram_publish_status == "needs_review"
    assert case.client.post(case.url).status_code == 409
    case.calls["publish"].assert_awaited_once()
    assert "mock-access-token" not in caplog.text
    assert "private-signed-url" not in caplog.text
    assert "Instagram may have published this post" in response.json()["detail"]


def test_membership_revocation_before_publish_prevents_provider_submission(
    instagram_case, monkeypatch
):
    from app.features.instagram import publishing_service

    case = instagram_case
    original = publishing_service.access.require_draft_permission
    checks = 0

    def revoke(db, principal, draft_id, permission, **kwargs):
        nonlocal checks
        checks += 1
        if checks == 3:
            raise ApplicationError(ErrorKind.NOT_FOUND, "Draft not found")
        return original(db, principal, draft_id, permission, **kwargs)

    monkeypatch.setattr(publishing_service.access, "require_draft_permission", revoke)

    response = case.client.post(case.url)

    assert response.status_code == 404
    assert saved_publication(case).instagram_publish_status == "failed"
    case.calls["create"].assert_awaited_once()
    case.calls["publish"].assert_not_awaited()


def test_graph_adapter_uses_authorization_header_and_never_puts_token_in_url(
    monkeypatch,
):
    from app.features.instagram import publishing_provider, provider

    requests = []

    class MockClient:
        def __init__(self, *, timeout):
            assert timeout == 20.0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def request(self, method, url, **kwargs):
            requests.append((method, url, kwargs))
            request = httpx.Request(method, url)
            return httpx.Response(200, json={"id": "container-id"}, request=request)

    monkeypatch.setattr(publishing_provider.httpx, "AsyncClient", MockClient)

    result = asyncio.run(
        publishing_provider.create_image_container(
            "instagram-account",
            "mock-private-access-token",
            "https://media.example.com/signed.jpg",
            "Caption",
        )
    )

    assert result == "container-id"
    assert len(requests) == 1
    method, url, kwargs = requests[0]
    assert method == "POST"
    assert url == f"{provider.GRAPH_API_URL}/instagram-account/media"
    assert "mock-private-access-token" not in url
    assert kwargs["params"] is None
    assert kwargs["headers"]["Authorization"].endswith(
        "mock-private-access-token"
    )
    assert kwargs["data"]["image_url"] == "https://media.example.com/signed.jpg"
