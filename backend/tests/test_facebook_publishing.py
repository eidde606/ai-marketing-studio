"""Characterize publication state changes without sending anything to Facebook."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.main import app
from app.models import Business, BusinessMembership, Draft, SocialAccount
from tests.tenancy_fixtures import grant_test_owner


@pytest.fixture
def publishing_case(isolated_client, monkeypatch):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Test Business")
        db.add(business)
        db.flush()
        grant_test_owner(db, [business.id])
        draft = Draft(
            business_id=business.id, title="Test Post", caption="Texto de prueba",
            platform="facebook", status="approved",
        )
        db.add(draft)
        db.add(SocialAccount(
            business_id=business.id, platform="facebook",
            platform_account_id="fake_page_123", account_name="Test Page",
            encrypted_access_token="encrypted_fake_token", connection_status="connected",
        ))
        db.commit()
        draft_id, business_id = draft.id, business.id

    publishers = {
        media: AsyncMock(return_value={"id": "fake_post_123"})
        for media in ("text", "image", "video")
    }
    for media, publisher in publishers.items():
        monkeypatch.setattr(
            f"app.features.facebook.publishing_service.publish_{media}_post",
            publisher,
        )
    monkeypatch.setattr(
        "app.features.facebook.publishing_service.decrypt_token",
        lambda _: "fake_token",
    )
    download = Mock(return_value=b"\x89PNG\r\n\x1a\nmock-image")
    monkeypatch.setattr(
        "app.features.facebook.publishing_service.download_marketing_image",
        download,
    )
    monkeypatch.setattr(
        "app.features.facebook.publishing_service.get_marketing_image_url",
        Mock(return_value="https://media.test.invalid/video.mp4"),
    )
    return SimpleNamespace(
        client=client, engine=engine, draft_id=draft_id, business_id=business_id,
        url=f"/drafts/{draft_id}/publish-facebook", publishers=publishers, download=download,
    )


def set_media(case, media):
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.media_type = media
        if media == "image":
            draft.image_url = f"businesses/{case.business_id}/image.png"
        elif media == "video":
            draft.video_url = f"businesses/{case.business_id}/video.mp4"
            draft.video_status = "completed"
        db.commit()


def assert_saved_state(case, status, post_id=None, published=False):
    # Read through a new session: an HTTP response alone does not prove persistence.
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        assert draft.facebook_publish_status == status
        assert draft.facebook_post_id == post_id
        assert (draft.published_at is not None) is published
        assert draft.caption == "Texto de prueba"
        assert draft.deleted_at is None


def test_pending_draft_cannot_be_published(publishing_case):
    case = publishing_case
    with Session(case.engine) as db:
        db.get(Draft, case.draft_id).status = "pending"
        db.commit()
    assert case.client.post(case.url).status_code == 409
    for publisher in case.publishers.values():
        publisher.assert_not_awaited()
    assert_saved_state(case, "not_published")


def test_approved_draft_publishes_successfully(publishing_case):
    case = publishing_case
    response = case.client.post(case.url)
    assert response.status_code == 200
    assert response.json() == {"status": "published", "facebook_post_id": "fake_post_123"}
    case.publishers["text"].assert_awaited_once_with(
        page_id="fake_page_123", access_token="fake_token", message="Texto de prueba",
    )
    case.publishers["image"].assert_not_awaited()
    case.publishers["video"].assert_not_awaited()
    assert_saved_state(case, "published", "fake_post_123", published=True)
    with Session(case.engine) as db:
        assert db.get(Draft, case.draft_id).status == "approved"
    # A repeated click must not submit another post.
    assert case.client.post(case.url).status_code == 409
    case.publishers["text"].assert_awaited_once()
    assert_saved_state(case, "published", "fake_post_123", published=True)


@pytest.mark.parametrize("provider_response,expected_id", [
    ({"post_id": "feed-post", "id": "photo-object"}, "feed-post"),
    ({"id": "photo-object"}, "photo-object"),
])
def test_image_publication_saves_supported_provider_id(publishing_case, provider_response, expected_id):
    case = publishing_case
    set_media(case, "image")
    case.publishers["image"].return_value = provider_response
    response = case.client.post(case.url)
    assert response.status_code == 200
    assert response.json() == {"status": "published", "facebook_post_id": expected_id}
    case.publishers["image"].assert_awaited_once_with(
        page_id="fake_page_123", access_token="fake_token", message="Texto de prueba",
        image_bytes=case.download.return_value,
    )
    case.publishers["text"].assert_not_awaited()
    assert_saved_state(case, "published", expected_id, published=True)


@pytest.mark.parametrize("media", ["text", "image", "video"])
@pytest.mark.parametrize("failure", ["timeout", "missing_id", 429, 500, 503])
def test_uncertain_outcome_requires_review_and_blocks_resubmission(publishing_case, media, failure):
    case = publishing_case
    set_media(case, media)
    publisher = case.publishers[media]
    if failure == "timeout":
        publisher.side_effect = httpx.ReadTimeout("Simulated timeout after submission")
    elif failure == "missing_id":
        publisher.return_value = {}
    else:
        request = httpx.Request("POST", "https://facebook.test.invalid/publish")
        publisher.side_effect = httpx.HTTPStatusError(
            "Simulated provider error", request=request,
            response=httpx.Response(failure, request=request),
        )
    response = case.client.post(case.url)
    assert response.status_code == 502
    expected_detail = "Facebook publishing outcome requires review"
    if media == "video":
        expected_detail = (
            "Facebook video submission requires review" if isinstance(failure, int)
            else "Check Facebook before retrying the video"
        )
    assert response.json() == {"detail": expected_detail}
    assert_saved_state(case, "needs_review")
    assert case.client.post(case.url).status_code == 409
    publisher.assert_awaited_once()
    for other_media, other_publisher in case.publishers.items():
        if other_media != media:
            other_publisher.assert_not_awaited()
    assert_saved_state(case, "needs_review")


@pytest.mark.parametrize("media", ["text", "image", "video"])
@pytest.mark.parametrize("status_code", [400, 401, 403])
def test_explicit_provider_rejection_releases_publication_claim(publishing_case, media, status_code):
    case = publishing_case
    set_media(case, media)
    publisher = case.publishers[media]
    request = httpx.Request("POST", "https://facebook.test.invalid/publish")
    publisher.side_effect = httpx.HTTPStatusError(
        "Simulated rejection", request=request,
        response=httpx.Response(status_code, request=request),
    )
    response = case.client.post(case.url)
    assert response.status_code == 502
    assert response.json() == {"detail": (
        "Facebook rejected the video request" if media == "video" else
        "Facebook rejected the request. Check Page token, permissions and image format."
    )}
    publisher.assert_awaited_once()
    assert_saved_state(case, "not_published")


@pytest.mark.parametrize("failure", ["storage_failure", "invalid_image"])
def test_image_preparation_failure_never_contacts_facebook(publishing_case, failure):
    case = publishing_case
    set_media(case, "image")
    if failure == "storage_failure":
        case.download.side_effect = ValueError("Simulated storage failure")
    else:
        case.download.return_value = b"not an image"
    response = case.client.post(case.url)
    assert response.status_code == 502
    assert response.json() == {"detail": "Unable to prepare the marketing image"}
    assert_saved_state(case, "not_published")
    for publisher in case.publishers.values():
        publisher.assert_not_awaited()


def test_video_submission_is_processing_until_verified(publishing_case, monkeypatch):
    case = publishing_case
    set_media(case, "video")
    response = case.client.post(case.url)
    assert response.status_code == 200
    assert response.json() == {"status": "processing", "facebook_post_id": "fake_post_123"}
    assert_saved_state(case, "needs_review", "fake_post_123")
    assert case.client.post(case.url).status_code == 409
    case.publishers["video"].assert_awaited_once()

    status = AsyncMock(side_effect=[
        {"status": {"video_status": "processing"}},
        {"status": {"video_status": "ready"}},
    ])
    monkeypatch.setattr(
        "app.features.facebook.publishing_service.get_video_status",
        status,
    )
    url = f"/drafts/{case.draft_id}/verify-facebook-video"
    assert case.client.post(url).json()["status"] == "processing"
    assert_saved_state(case, "needs_review", "fake_post_123")
    verified = case.client.post(url)
    assert verified.status_code == 200
    assert verified.json() == {"status": "published", "facebook_post_id": "fake_post_123"}
    assert_saved_state(case, "published", "fake_post_123", published=True)
    status.assert_awaited_with(video_id="fake_post_123", access_token="fake_token")
    # Verification is idempotent once confirmed, too.
    assert case.client.post(url).json()["status"] == "published"
    assert status.await_count == 2


def test_facebook_manual_reset_requires_confirmation_and_review_state(
    publishing_case,
):
    case = publishing_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.facebook_publish_status = "needs_review"
        db.commit()
    url = f"/drafts/{case.draft_id}/reset-facebook-publishing"

    unconfirmed = case.client.post(
        url,
        json={"confirmed_not_published": False},
    )
    assert unconfirmed.status_code == 400
    assert unconfirmed.json() == {
        "detail": "Confirm the post is absent on Facebook",
    }
    assert_saved_state(case, "needs_review")

    confirmed = case.client.post(
        url,
        json={"confirmed_not_published": True},
    )
    assert confirmed.status_code == 200
    assert confirmed.json() == {"status": "not_published"}
    assert_saved_state(case, "not_published")
    assert case.client.post(
        url,
        json={"confirmed_not_published": True},
    ).status_code == 409


def test_facebook_publishing_requires_authentication(publishing_case):
    case = publishing_case
    del app.dependency_overrides[verify_token]

    response = case.client.post(case.url)

    assert response.status_code == 401


def test_facebook_member_cannot_publish_or_change_publication_state(publishing_case):
    case = publishing_case
    with Session(case.engine) as db:
        membership = db.query(BusinessMembership).filter_by(
            business_id=case.business_id,
        ).one()
        membership.role = "member"
        db.commit()

    response = case.client.post(case.url)

    assert response.status_code == 403
    assert response.json() == {"detail": "Operation not permitted"}
    for publisher in case.publishers.values():
        publisher.assert_not_awaited()
    assert_saved_state(case, "not_published")


def test_facebook_revocation_after_media_preparation_releases_claim(
    publishing_case, monkeypatch,
):
    from app.errors import ApplicationError, ErrorKind
    from app.features.facebook import publishing_service

    case = publishing_case
    set_media(case, "image")
    original = publishing_service.access.require_draft_permission
    checks = 0

    def revoke_before_submission(db, principal, draft_id, permission, **kwargs):
        nonlocal checks
        checks += 1
        if checks == 3:
            raise ApplicationError(ErrorKind.NOT_FOUND, "Draft not found")
        return original(db, principal, draft_id, permission, **kwargs)

    monkeypatch.setattr(
        publishing_service.access,
        "require_draft_permission",
        revoke_before_submission,
    )

    response = case.client.post(case.url)

    assert response.status_code == 404
    assert response.json() == {"detail": "Draft not found"}
    case.publishers["image"].assert_not_awaited()
    assert_saved_state(case, "not_published")


def test_facebook_publication_hides_drafts_from_other_tenants(publishing_case):
    case = publishing_case
    with Session(case.engine) as db:
        other_business = Business(name="Other Facebook business")
        db.add(other_business)
        db.flush()
        draft = Draft(
            business_id=other_business.id,
            title="Other tenant",
            caption="Must not publish",
            platform="facebook",
            status="approved",
        )
        db.add(draft)
        db.add(SocialAccount(
            business_id=other_business.id,
            platform="facebook",
            platform_account_id="other-page",
            account_name="Other Page",
            encrypted_access_token="other-token",
            connection_status="connected",
        ))
        db.commit()
        draft_id = draft.id

    response = case.client.post(f"/drafts/{draft_id}/publish-facebook")

    assert response.status_code == 404
    assert response.json() == {"detail": "Draft not found"}
    for publisher in case.publishers.values():
        publisher.assert_not_awaited()
