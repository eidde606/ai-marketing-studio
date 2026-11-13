from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.main import app
from app.models import Business, Draft, SocialAccount

MIN_VIDEO_SIZE = 5 * 1024 * 1024
VIDEO_BYTES = b"\x00\x00\x00\x18ftyp" + b"x" * (MIN_VIDEO_SIZE - 8)


@pytest.fixture
def tiktok_case(isolated_client, monkeypatch):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="TikTok publishing business")
        db.add(business)
        db.flush()
        draft = Draft(
            business_id=business.id,
            title="TikTok video",
            caption="Video caption",
            platform="tiktok",
            status="approved",
            publish_destinations=["tiktok"],
            media_type="video",
            video_url=f"businesses/{business.id}/video.mp4",
            video_status="completed",
        )
        account = SocialAccount(
            business_id=business.id,
            platform="tiktok",
            platform_account_id="tiktok-open-id",
            account_name="TikTok account",
            encrypted_access_token="encrypted-access",
            encrypted_refresh_token="encrypted-refresh",
            connection_status="connected",
        )
        db.add_all([draft, account])
        db.commit()
        draft_id, business_id, account_id = draft.id, business.id, account.id

    storage = Mock()
    storage.storage.from_.return_value.download.return_value = VIDEO_BYTES
    monkeypatch.setattr(
        "app.features.tiktok.publishing_service.get_storage_client",
        lambda: storage,
    )
    monkeypatch.setattr(
        "app.features.tiktok.service.get_valid_access_token",
        AsyncMock(return_value="access-token"),
    )
    creator_info = AsyncMock(return_value={"privacy_level_options": ["PUBLIC_TO_EVERYONE"]})
    publisher = AsyncMock(return_value={"publish_id": "publish-id"})
    status_lookup = AsyncMock(return_value={"status": "PROCESSING_UPLOAD"})
    monkeypatch.setattr(
        "app.features.tiktok.publishing_provider.get_creator_info",
        creator_info,
    )
    monkeypatch.setattr(
        "app.features.tiktok.publishing_provider.publish_tiktok_video_file",
        publisher,
    )
    monkeypatch.setattr(
        "app.features.tiktok.publishing_provider.get_tiktok_publish_status",
        status_lookup,
    )

    return SimpleNamespace(
        client=client,
        engine=engine,
        draft_id=draft_id,
        business_id=business_id,
        account_id=account_id,
        storage=storage,
        creator_info=creator_info,
        publisher=publisher,
        status_lookup=status_lookup,
        publish_url=f"/drafts/{draft_id}/publish-tiktok",
        verify_url=f"/drafts/{draft_id}/verify-tiktok",
    )


def publish(case, **overrides):
    request = {
        "account_id": case.account_id,
        "privacy_level": "PUBLIC_TO_EVERYONE",
        "disable_comment": False,
        "disable_duet": False,
        "disable_stitch": False,
    }
    request.update(overrides)
    return case.client.post(case.publish_url, json=request)


def read_draft(case) -> Draft:
    with Session(case.engine) as db:
        return db.get(Draft, case.draft_id)


def test_tiktok_video_publication_saves_uncertain_state_and_blocks_duplicate(
    tiktok_case,
):
    case = tiktok_case

    response = publish(case)

    assert response.status_code == 200
    assert response.json() == {
        "status": "processing",
        "tiktok_publish_id": "publish-id",
    }
    case.storage.storage.from_.assert_called_once_with("test-only-bucket")
    case.creator_info.assert_awaited_once_with("access-token")
    case.publisher.assert_awaited_once_with(
        access_token="access-token",
        video_bytes=VIDEO_BYTES,
        caption="Video caption",
        privacy_level="PUBLIC_TO_EVERYONE",
        disable_comment=False,
        disable_duet=False,
        disable_stitch=False,
    )
    draft = read_draft(case)
    assert draft.tiktok_publish_id == "publish-id"
    assert draft.tiktok_publish_status == "needs_review"
    assert draft.tiktok_account_id == case.account_id
    assert draft.facebook_publish_status == "not_published"

    repeated = publish(case)
    assert repeated.status_code == 409
    assert repeated.json() == {
        "detail": "Draft is not eligible for TikTok publishing",
    }
    case.publisher.assert_awaited_once()


def test_tiktok_video_submission_timeout_requires_review_and_blocks_retry(
    tiktok_case,
):
    case = tiktok_case
    case.publisher.side_effect = httpx.ReadTimeout("submission outcome unknown")

    response = publish(case)

    assert response.status_code == 502
    assert response.json() == {
        "detail": "TikTok publishing outcome requires review",
    }
    draft = read_draft(case)
    assert draft.tiktok_publish_status == "needs_review"
    assert draft.tiktok_publish_id is None
    assert draft.tiktok_account_id == case.account_id
    assert publish(case).status_code == 409
    case.publisher.assert_awaited_once()


def test_tiktok_creator_settings_uses_business_scoped_connected_account(
    tiktok_case,
):
    case = tiktok_case
    response = case.client.get(
        f"/drafts/{case.draft_id}/tiktok-creator-info",
        params={"account_id": case.account_id},
    )

    assert response.status_code == 200
    assert response.json() == {
        "privacy_level_options": ["PUBLIC_TO_EVERYONE"],
    }
    case.creator_info.assert_awaited_once_with("access-token")

    missing = case.client.get(
        f"/drafts/{case.draft_id}/tiktok-creator-info",
        params={"account_id": "not-this-business"},
    )
    assert missing.status_code == 409
    assert missing.json() == {"detail": "Connect TikTok first"}


@pytest.mark.parametrize(
    ("changes", "expected_status", "expected_detail"),
    [
        (
            {"publish_destinations": ["facebook"]},
            409,
            "TikTok is not selected for this draft",
        ),
        (
            {"video_status": "generating"},
            409,
            "A completed video is required",
        ),
        (
            {"video_url": "https://external.test/video.mp4"},
            400,
            "Invalid media storage path",
        ),
        (
            {"video_url": "businesses/another-business/video.mp4"},
            400,
            "Invalid media storage path",
        ),
    ],
)
def test_tiktok_invalid_draft_media_is_rejected_before_provider_submission(
    tiktok_case,
    changes,
    expected_status,
    expected_detail,
):
    case = tiktok_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        for field, value in changes.items():
            setattr(draft, field, value)
        db.commit()

    response = publish(case)

    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}
    case.publisher.assert_not_awaited()


def test_tiktok_account_must_belong_to_draft_business(tiktok_case):
    case = tiktok_case
    with Session(case.engine) as db:
        other_business = Business(name="Other TikTok business")
        db.add(other_business)
        db.flush()
        other_account = SocialAccount(
            business_id=other_business.id,
            platform="tiktok",
            platform_account_id="other-open-id",
            account_name="Other account",
            encrypted_access_token="encrypted-other",
            connection_status="connected",
        )
        db.add(other_account)
        db.commit()
        other_account_id = other_account.id

    response = publish(case, account_id=other_account_id)

    assert response.status_code == 409
    assert response.json() == {"detail": "Connect TikTok first"}
    case.publisher.assert_not_awaited()


def test_tiktok_photo_publishing_remains_disabled_before_claim(tiktok_case):
    case = tiktok_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.media_type = "image"
        draft.video_url = None
        draft.video_status = "not_started"
        draft.image_url = f"businesses/{case.business_id}/image.png"
        db.commit()

    response = publish(case)

    assert response.status_code == 409
    assert response.json() == {
        "detail": (
            "TikTok photo publishing requires a verified media URL; "
            "not configured yet"
        ),
    }
    assert read_draft(case).tiktok_publish_status == "not_published"
    case.publisher.assert_not_awaited()


@pytest.mark.parametrize(
    ("video_bytes", "expected_status", "expected_detail"),
    [
        (b"not an mp4", 400, "Invalid MP4 video"),
        (b"\x00\x00\x00\x18ftyp" + b"x" * (MIN_VIDEO_SIZE - 9), 409,
         "Video must be 5–64 MiB for current TikTok uploader"),
        (b"\x00\x00\x00\x18ftyp" + b"x" * (MIN_VIDEO_SIZE + 1), 200, None),
    ],
)
def test_tiktok_video_bytes_are_validated_before_submission(
    tiktok_case,
    video_bytes,
    expected_status,
    expected_detail,
):
    case = tiktok_case
    case.storage.storage.from_.return_value.download.return_value = video_bytes

    response = publish(case)

    assert response.status_code == expected_status
    if expected_detail is not None:
        assert response.json() == {"detail": expected_detail}
        case.publisher.assert_not_awaited()
    else:
        case.publisher.assert_awaited_once()


def test_tiktok_storage_failure_is_reported_without_claiming_draft(tiktok_case):
    case = tiktok_case
    case.storage.storage.from_.return_value.download.side_effect = ValueError(
        "storage unavailable",
    )

    response = publish(case)

    assert response.status_code == 502
    assert response.json() == {"detail": "Unable to download TikTok video"}
    case.publisher.assert_not_awaited()
    assert read_draft(case).tiktok_publish_status == "not_published"


def test_tiktok_creator_info_errors_and_disallowed_privacy_do_not_claim_draft(
    tiktok_case,
):
    case = tiktok_case
    case.creator_info.side_effect = httpx.ConnectError("unavailable")

    failed_lookup = publish(case)

    assert failed_lookup.status_code == 502
    assert failed_lookup.json() == {
        "detail": "Unable to validate TikTok settings",
    }
    assert read_draft(case).tiktok_publish_status == "not_published"
    case.publisher.assert_not_awaited()

    case.creator_info.side_effect = None
    case.creator_info.return_value = {"privacy_level_options": ["SELF_ONLY"]}
    rejected = publish(case)
    assert rejected.status_code == 422
    assert rejected.json() == {
        "detail": "Privacy option not permitted by TikTok",
    }
    assert read_draft(case).tiktok_publish_status == "not_published"
    case.publisher.assert_not_awaited()


@pytest.mark.parametrize(
    ("result", "expected_response", "expected_saved_status"),
    [
        (
            {"status": "PUBLISH_COMPLETE"},
            {"status": "published"},
            "published",
        ),
        (
            {"status": "FAILED"},
            {"status": "failed"},
            "needs_review",
        ),
        (
            {"status": "PROCESSING_UPLOAD"},
            {"status": "processing", "tiktok_status": "PROCESSING_UPLOAD"},
            "needs_review",
        ),
    ],
)
def test_tiktok_verification_maps_provider_status(
    tiktok_case,
    result,
    expected_response,
    expected_saved_status,
):
    case = tiktok_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.tiktok_publish_id = "publish-id"
        draft.tiktok_publish_status = "needs_review"
        draft.tiktok_account_id = case.account_id
        db.commit()
    case.status_lookup.return_value = result

    response = case.client.post(case.verify_url)

    assert response.status_code == 200
    assert response.json() == expected_response
    case.status_lookup.assert_awaited_once_with(
        access_token="access-token",
        publish_id="publish-id",
    )
    draft = read_draft(case)
    assert draft.tiktok_publish_status == expected_saved_status
    assert (draft.published_at is not None) is (
        result["status"] == "PUBLISH_COMPLETE"
    )


def test_tiktok_verification_requires_publication_and_connected_account(tiktok_case):
    case = tiktok_case
    missing_publication = case.client.post(case.verify_url)
    assert missing_publication.status_code == 409
    assert missing_publication.json() == {
        "detail": "No TikTok publication to verify",
    }

    with Session(case.engine) as db:
        disconnected_account = SocialAccount(
            business_id=case.business_id,
            platform="tiktok",
            platform_account_id="disconnected-open-id",
            account_name="Disconnected account",
            encrypted_access_token="encrypted-disconnected",
            connection_status="disconnected",
        )
        db.add(disconnected_account)
        db.flush()
        draft = db.get(Draft, case.draft_id)
        draft.tiktok_publish_id = "publish-id"
        draft.tiktok_account_id = disconnected_account.id
        db.commit()
    disconnected = case.client.post(case.verify_url)
    assert disconnected.status_code == 409
    assert disconnected.json() == {"detail": "TikTok is not connected"}
    case.status_lookup.assert_not_awaited()


def test_tiktok_verification_provider_failure_is_reported(tiktok_case):
    case = tiktok_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.tiktok_publish_id = "publish-id"
        draft.tiktok_publish_status = "needs_review"
        draft.tiktok_account_id = case.account_id
        db.commit()
    case.status_lookup.side_effect = httpx.ReadTimeout("timeout")

    response = case.client.post(case.verify_url)

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Unable to verify TikTok publication",
    }


def test_tiktok_publishing_and_verification_require_authentication(tiktok_case):
    case = tiktok_case
    del app.dependency_overrides[verify_token]

    publish_response = publish(case)
    verify_response = case.client.post(case.verify_url)

    assert publish_response.status_code == 401
    assert verify_response.status_code == 401
