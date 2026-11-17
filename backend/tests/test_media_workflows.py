from types import SimpleNamespace
from unittest.mock import Mock
from io import BytesIO

import pytest
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Business, Draft, ImageRevision
from tests.tenancy_fixtures import (
    grant_test_active_entitlement,
    grant_test_owner,
)


@pytest.fixture
def media_case(isolated_client):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Media workflow business")
        db.add(business)
        db.flush()
        principal = grant_test_owner(db, [business.id])
        grant_test_active_entitlement(
            db, [business.id], owner_user_id=principal.user_id,
        )
        draft = Draft(
            business_id=business.id,
            title="Media draft",
            caption="Caption",
            platform="facebook",
            status="pending",
            image_prompt="A product on a blue background",
        )
        db.add(draft)
        db.commit()
        draft_id, business_id = draft.id, business.id
    return SimpleNamespace(
        client=client,
        engine=engine,
        draft_id=draft_id,
        business_id=business_id,
    )


def saved_draft(case):
    with Session(case.engine) as db:
        return db.get(Draft, case.draft_id)


def valid_png_bytes():
    output = BytesIO()
    Image.new("RGBA", (640, 480), (20, 120, 200, 255)).save(
        output, format="PNG",
    )
    return output.getvalue()


def valid_jpeg_bytes():
    output = BytesIO()
    Image.new("RGB", (640, 480), (20, 120, 200)).save(
        output, format="JPEG",
    )
    return output.getvalue()


def test_storage_service_rejects_missing_server_configuration(
    monkeypatch,
):
    from app import storage_service

    client_factory = Mock()
    monkeypatch.setattr(storage_service, "create_client", client_factory)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)

    with pytest.raises(
        storage_service.StorageUnavailableError,
        match="Supabase Storage is unavailable",
    ):
        storage_service.get_storage_client()
    client_factory.assert_not_called()


def test_storage_service_sanitizes_missing_bucket_and_provider_errors(
    media_case,
    monkeypatch,
):
    from app import storage_service

    monkeypatch.setattr(storage_service, "get_storage_client", Mock())
    monkeypatch.delenv("SUPABASE_STORAGE_BUCKET", raising=False)
    with pytest.raises(
        storage_service.StorageUnavailableError,
        match="Supabase Storage is unavailable",
    ) as missing_bucket:
        storage_service.upload_marketing_video(
            b"0000ftyp",
            media_case.business_id,
        )
    assert missing_bucket.value.__cause__ is None

    storage_client = Mock()
    storage_client.storage.from_.return_value.upload.side_effect = RuntimeError(
        "provider details must not escape",
    )
    monkeypatch.setattr(
        storage_service,
        "get_storage_client",
        Mock(return_value=storage_client),
    )
    monkeypatch.setenv("SUPABASE_STORAGE_BUCKET", "test-bucket")
    with pytest.raises(
        storage_service.StorageUnavailableError,
        match="Supabase Storage is unavailable",
    ) as provider_error:
        storage_service.upload_marketing_video(
            b"0000ftyp",
            media_case.business_id,
        )
    assert "provider details" not in str(provider_error.value)
    assert provider_error.value.__cause__ is None


def test_manual_video_upload_saves_private_path_and_marks_complete(
    media_case,
    monkeypatch,
):
    case = media_case
    upload = Mock(return_value=f"businesses/{case.business_id}/manual.mp4")
    monkeypatch.setattr("app.features.media.workflows_service.upload_marketing_video", upload)
    content = b"private mp4 bytes"

    response = case.client.post(
        f"/drafts/{case.draft_id}/upload-video",
        files={"file": ("manual.mp4", content, "video/mp4")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "draft_id": case.draft_id,
        "media_type": "video",
        "video_status": "completed",
    }
    upload.assert_called_once_with(
        video_bytes=content,
        business_id=case.business_id,
    )
    draft = saved_draft(case)
    assert draft.video_url == f"businesses/{case.business_id}/manual.mp4"
    assert draft.video_generation_id is None


def test_manual_video_upload_rejects_invalid_type_and_existing_video(
    media_case,
    monkeypatch,
):
    case = media_case
    upload = Mock(return_value="unused")
    monkeypatch.setattr("app.features.media.workflows_service.upload_marketing_video", upload)

    wrong_type = case.client.post(
        f"/drafts/{case.draft_id}/upload-video",
        files={"file": ("manual.mov", b"video", "video/quicktime")},
    )
    assert wrong_type.status_code == 415
    assert wrong_type.json() == {"detail": "Only MP4 videos are supported"}

    with Session(case.engine) as db:
        db.get(Draft, case.draft_id).video_status = "generating"
        db.commit()
    existing = case.client.post(
        f"/drafts/{case.draft_id}/upload-video",
        files={"file": ("manual.mp4", b"video", "video/mp4")},
    )
    assert existing.status_code == 409
    assert existing.json() == {
        "detail": "This draft already has a video or an active video operation",
    }


def test_manual_image_upload_converts_to_jpeg_without_generation_credit(
    media_case,
    monkeypatch,
):
    case = media_case
    stored = {}

    def upload(**kwargs):
        stored.update(kwargs)
        return f"businesses/{case.business_id}/manual.jpg"

    monkeypatch.setattr(
        "app.features.media.workflows_service.upload_marketing_image",
        upload,
    )
    monkeypatch.setattr(
        "app.features.media.workflows_service.get_marketing_image_url",
        Mock(return_value="https://storage.example.com/manual.jpg"),
    )
    monkeypatch.setattr(
        "app.features.entitlements.service.assert_image_generation_disabled",
        Mock(side_effect=AssertionError("Upload must not consume AI credits")),
    )
    generate = Mock()
    monkeypatch.setattr(
        "app.features.media.workflows_service.generate_marketing_image",
        generate,
    )

    response = case.client.post(
        f"/drafts/{case.draft_id}/upload-image",
        files={"file": ("source.png", valid_png_bytes(), "image/png")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "draft_id": case.draft_id,
        "media_type": "image",
        "image_status": "completed",
        "image_url": "https://storage.example.com/manual.jpg",
    }
    assert stored["content_type"] == "image/jpeg"
    assert stored["business_id"] == case.business_id
    assert stored["image_bytes"].startswith(b"\xff\xd8\xff")
    draft = saved_draft(case)
    assert draft.image_url == f"businesses/{case.business_id}/manual.jpg"
    assert draft.media_type == "image"
    assert draft.image_status == "completed"
    assert draft.image_generation_id is None
    generate.assert_not_called()


def test_manual_jpeg_upload_is_validated_and_stored_as_jpeg(
    media_case,
    monkeypatch,
):
    case = media_case
    stored = {}

    def upload(**kwargs):
        stored.update(kwargs)
        return f"businesses/{case.business_id}/customer.jpg"

    monkeypatch.setattr(
        "app.features.media.workflows_service.upload_marketing_image",
        upload,
    )
    monkeypatch.setattr(
        "app.features.media.workflows_service.get_marketing_image_url",
        Mock(return_value="https://storage.example.com/customer.jpg"),
    )
    response = case.client.post(
        f"/drafts/{case.draft_id}/upload-image",
        files={"file": ("customer.jpg", valid_jpeg_bytes(), "image/jpeg")},
    )
    assert response.status_code == 200
    assert stored["content_type"] == "image/jpeg"
    assert stored["image_bytes"].startswith(b"\xff\xd8\xff")
    assert saved_draft(case).image_url.endswith("/customer.jpg")


@pytest.mark.parametrize(
    ("content", "expected_status"),
    [
        (b"not an image", 415),
        (valid_png_bytes(), 200),
    ],
)
def test_manual_image_upload_validates_actual_bytes(
    media_case,
    monkeypatch,
    content,
    expected_status,
):
    case = media_case
    monkeypatch.setattr(
        "app.features.media.workflows_service.upload_marketing_image",
        Mock(return_value=f"businesses/{case.business_id}/manual.jpg"),
    )
    monkeypatch.setattr(
        "app.features.media.workflows_service.get_marketing_image_url",
        Mock(return_value="https://storage.example.com/manual.jpg"),
    )

    response = case.client.post(
        f"/drafts/{case.draft_id}/upload-image",
        files={"file": ("spoofed.jpg", content, "image/jpeg")},
    )

    assert response.status_code == expected_status
    if expected_status == 415:
        assert "valid JPEG, PNG, or WebP" in response.json()["detail"]
        assert saved_draft(case).image_url is None


def test_manual_image_upload_rejects_existing_media_and_oversized_files(
    media_case,
    monkeypatch,
):
    case = media_case
    upload = Mock()
    monkeypatch.setattr(
        "app.features.media.workflows_service.upload_marketing_image",
        upload,
    )
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.image_status = "completed"
        draft.image_url = f"businesses/{case.business_id}/existing.jpg"
        db.commit()
    existing = case.client.post(
        f"/drafts/{case.draft_id}/upload-image",
        files={"file": ("source.png", valid_png_bytes(), "image/png")},
    )
    assert existing.status_code == 409
    upload.assert_not_called()

    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.image_status = "not_started"
        draft.image_url = None
        db.commit()
    oversized = case.client.post(
        f"/drafts/{case.draft_id}/upload-image",
        files={
            "file": (
                "oversized.png",
                b"x" * (20 * 1024 * 1024 + 1),
                "image/png",
            )
        },
    )
    assert oversized.status_code == 413
    upload.assert_not_called()


def test_manual_image_upload_cannot_cross_tenant(media_case, monkeypatch):
    from app.auth import get_authenticated_principal
    from app.main import app

    case = media_case
    with Session(case.engine) as db:
        other_business = Business(name="Other media business")
        db.add(other_business)
        db.flush()
        other_principal = grant_test_owner(
            db,
            [other_business.id],
            subject="other-media-test-user",
        )
        db.commit()

    previous = app.dependency_overrides[get_authenticated_principal]
    app.dependency_overrides[get_authenticated_principal] = (
        lambda: other_principal
    )
    upload = Mock()
    monkeypatch.setattr(
        "app.features.media.workflows_service.upload_marketing_image",
        upload,
    )
    try:
        response = case.client.post(
            f"/drafts/{case.draft_id}/upload-image",
            files={"file": ("source.png", valid_png_bytes(), "image/png")},
        )
    finally:
        app.dependency_overrides[get_authenticated_principal] = previous

    assert response.status_code == 404
    upload.assert_not_called()


def test_reusable_images_are_tenant_scoped_and_attach_as_jpeg(
    media_case,
    monkeypatch,
):
    case = media_case
    with Session(case.engine) as db:
        source = Draft(
            business_id=case.business_id,
            title="Source image",
            caption="Previously generated",
            platform="facebook",
            status="approved",
            media_type="image",
            image_status="completed",
            image_url=f"businesses/{case.business_id}/source.png",
        )
        other_business = Business(name="Private image business")
        db.add_all([source, other_business])
        db.flush()
        other_source = Draft(
            business_id=other_business.id,
            title="Other tenant image",
            caption="Private",
            platform="facebook",
            status="approved",
            media_type="image",
            image_status="completed",
            image_url=f"businesses/{other_business.id}/private.png",
        )
        db.add(other_source)
        db.commit()
        source_id, other_source_id = source.id, other_source.id

    monkeypatch.setattr(
        "app.features.media.workflows_service.get_marketing_image_url",
        Mock(return_value="https://storage.example.com/source.png"),
    )
    cross_tenant = case.client.post(
        f"/drafts/{case.draft_id}/reuse-image",
        json={"source_draft_id": other_source_id},
    )
    assert cross_tenant.status_code == 404

    listed = case.client.get(
        f"/drafts/{case.draft_id}/reusable-images",
    )
    assert listed.status_code == 200
    assert listed.json() == [
        {
            "draft_id": source_id,
            "title": "Source image",
            "image_url": "https://storage.example.com/source.png",
        }
    ]

    stored = {}
    monkeypatch.setattr(
        "app.features.media.workflows_service.download_marketing_image",
        Mock(return_value=valid_png_bytes()),
    )

    def upload(**kwargs):
        stored.update(kwargs)
        return f"businesses/{case.business_id}/reused.jpg"

    monkeypatch.setattr(
        "app.features.media.workflows_service.upload_marketing_image",
        upload,
    )
    monkeypatch.setattr(
        "app.features.entitlements.service.assert_image_generation_disabled",
        Mock(side_effect=AssertionError("Reuse must not consume AI credits")),
    )

    reused = case.client.post(
        f"/drafts/{case.draft_id}/reuse-image",
        json={"source_draft_id": source_id},
    )
    assert reused.status_code == 200
    assert reused.json()["image_status"] == "completed"
    assert stored["content_type"] == "image/jpeg"
    assert stored["image_bytes"].startswith(b"\xff\xd8\xff")
    assert saved_draft(case).image_url == (
        f"businesses/{case.business_id}/reused.jpg"
    )
    with Session(case.engine) as db:
        assert db.get(Draft, source_id).image_url.endswith("/source.png")


def test_manual_video_upload_maps_storage_validation_error(
    media_case,
    monkeypatch,
):
    case = media_case
    monkeypatch.setattr(
        "app.features.media.workflows_service.upload_marketing_video",
        Mock(side_effect=ValueError("Invalid MP4 data")),
    )

    response = case.client.post(
        f"/drafts/{case.draft_id}/upload-video",
        files={"file": ("manual.mp4", b"video", "video/mp4")},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid MP4 data"}
    assert saved_draft(case).video_url is None


def test_manual_video_upload_maps_storage_configuration_failure(
    media_case,
    monkeypatch,
):
    case = media_case
    monkeypatch.setattr(
        "app.features.media.workflows_service.upload_marketing_video",
        Mock(side_effect=KeyError("SUPABASE_STORAGE_BUCKET")),
    )

    response = case.client.post(
        f"/drafts/{case.draft_id}/upload-video",
        files={"file": ("manual.mp4", b"video", "video/mp4")},
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Video storage is unavailable. Please try again later.",
    }
    assert "SUPABASE_STORAGE_BUCKET" not in response.text
    assert saved_draft(case).video_url is None


def test_video_preview_only_returns_signed_url_for_valid_private_path(
    media_case,
    monkeypatch,
):
    case = media_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.media_type = "video"
        draft.video_status = "completed"
        draft.video_url = f"businesses/{case.business_id}/manual.mp4"
        db.commit()
    sign = Mock(return_value="https://storage.test.invalid/signed-video")
    monkeypatch.setattr("app.features.media.workflows_service.get_marketing_image_url", sign)

    response = case.client.get(f"/drafts/{case.draft_id}/video-preview")

    assert response.status_code == 200
    assert response.json() == {
        "draft_id": case.draft_id,
        "video_url": "https://storage.test.invalid/signed-video",
    }
    sign.assert_called_once_with(
        f"businesses/{case.business_id}/manual.mp4",
        expires_in=900,
        context=sign.call_args.kwargs["context"],
    )
    assert sign.call_args.kwargs["context"].business_id == case.business_id


def test_video_preview_rejects_incomplete_or_cross_business_path(media_case):
    case = media_case
    response = case.client.get(f"/drafts/{case.draft_id}/video-preview")
    assert response.status_code == 404
    assert response.json() == {
        "detail": "No completed video available for this draft",
    }

    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.media_type = "video"
        draft.video_status = "completed"
        draft.video_url = "businesses/another-business/video.mp4"
        db.commit()
    invalid = case.client.get(f"/drafts/{case.draft_id}/video-preview")
    assert invalid.status_code == 400
    assert invalid.json() == {"detail": "Invalid video storage path"}


def test_video_preview_maps_missing_storage_configuration(
    media_case,
    monkeypatch,
):
    case = media_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.media_type = "video"
        draft.video_status = "completed"
        draft.video_url = f"businesses/{case.business_id}/manual.mp4"
        db.commit()
    monkeypatch.setattr(
        "app.features.media.workflows_service.get_marketing_image_url",
        Mock(side_effect=KeyError("SUPABASE_STORAGE_BUCKET")),
    )

    response = case.client.get(f"/drafts/{case.draft_id}/video-preview")

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Video preview is unavailable. Please try again later.",
    }
    assert "SUPABASE_STORAGE_BUCKET" not in response.text


def test_image_preview_maps_storage_failure(media_case, monkeypatch):
    case = media_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.image_url = f"businesses/{case.business_id}/draft.png"
        db.commit()
    monkeypatch.setattr(
        "app.features.media.workflows_service.get_marketing_image_url",
        Mock(side_effect=RuntimeError("provider response includes sensitive details")),
    )

    response = case.client.get(f"/drafts/{case.draft_id}/image")

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Image preview is unavailable. Please try again later.",
    }
    assert "sensitive details" not in response.text


def test_active_customer_image_generation_is_disabled_before_provider_call(
    media_case,
    monkeypatch,
):
    case = media_case
    generate = Mock()
    sign = Mock()
    monkeypatch.setattr("app.features.media.workflows_service.generate_marketing_image", generate)
    monkeypatch.setattr("app.features.media.workflows_service.get_marketing_image_url", sign)

    response = case.client.post(f"/drafts/{case.draft_id}/generate-image")

    assert response.status_code == 429
    assert response.json() == {
        "detail": "AI image generation and editing are temporarily unavailable.",
    }
    generate.assert_not_called()
    sign.assert_not_called()
    draft = saved_draft(case)
    assert draft.image_url is None
    assert draft.image_generation_id is None
    assert draft.image_started_at is None


def test_member_cannot_bypass_image_generation_disable(
    media_case, monkeypatch,
):
    from app.auth import SUPABASE_ISSUER, get_authenticated_principal
    from app.features.access.principal import AuthenticatedPrincipal
    from app.main import app
    from app.models import BusinessMembership, User

    case = media_case
    with Session(case.engine) as db:
        user = User(
            auth_issuer=SUPABASE_ISSUER,
            auth_subject="revoked-image-user",
        )
        db.add(user)
        db.flush()
        membership = BusinessMembership(
            business_id=case.business_id,
            user_id=user.id,
            role="member",
            status="active",
        )
        db.add(membership)
        db.commit()
        membership_id = membership.id
        principal = AuthenticatedPrincipal(
            SUPABASE_ISSUER, user.auth_subject, user.id,
        )

    previous = app.dependency_overrides[get_authenticated_principal]
    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    generate = Mock()
    monkeypatch.setattr(
        "app.features.media.workflows_service.generate_marketing_image",
        generate,
    )
    try:
        response = case.client.post(f"/drafts/{case.draft_id}/generate-image")
    finally:
        app.dependency_overrides[get_authenticated_principal] = previous

    assert response.status_code == 429
    generate.assert_not_called()
    with Session(case.engine) as db:
        assert db.get(BusinessMembership, membership_id).status == "active"
    draft = saved_draft(case)
    assert draft.image_url is None


def test_image_generation_does_not_start_or_mutate_attempt_when_disabled(
    media_case,
    monkeypatch,
):
    case = media_case
    provider = Mock(side_effect=RuntimeError("provider unavailable"))
    monkeypatch.setattr(
        "app.features.media.workflows_service.generate_marketing_image",
        provider,
    )

    response = case.client.post(f"/drafts/{case.draft_id}/generate-image")

    assert response.status_code == 429
    assert response.json() == {
        "detail": "AI image generation and editing are temporarily unavailable.",
    }
    provider.assert_not_called()
    draft = saved_draft(case)
    assert draft.image_status in (None, "not_started")
    assert draft.image_started_at is None
    assert draft.image_generation_id is None
    assert draft.image_url is None


def test_image_generation_rejects_existing_video_operation(
    media_case,
    monkeypatch,
):
    case = media_case
    with Session(case.engine) as db:
        db.get(Draft, case.draft_id).video_status = "generating"
        db.commit()
    generate = Mock()
    monkeypatch.setattr("app.features.media.workflows_service.generate_marketing_image", generate)

    response = case.client.post(f"/drafts/{case.draft_id}/generate-image")

    assert response.status_code == 409
    assert response.json() == {
        "detail": "A video or video operation already exists",
    }
    generate.assert_not_called()


@pytest.fixture
def image_revision_case(media_case, monkeypatch):
    case = media_case
    with Session(case.engine) as db:
        draft = db.get(Draft, case.draft_id)
        draft.image_status = "completed"
        draft.image_url = f"businesses/{case.business_id}/original.png"
        db.commit()

    monkeypatch.setattr(
        "app.features.media.repository.lock_draft_revisions",
        lambda *_args: None,
    )
    monkeypatch.setattr(
        "app.features.media.repository.lock_draft_revisions_scoped",
        lambda *_args: True,
    )
    monkeypatch.setattr(
        "app.features.media.workflows_service.download_marketing_image",
        Mock(return_value=b"\x89PNG\r\n\x1a\noriginal"),
    )
    monkeypatch.setattr(
        "app.features.media.workflows_service.edit_marketing_image",
        Mock(return_value=f"businesses/{case.business_id}/revised.png"),
    )
    monkeypatch.setattr(
        "app.features.media.workflows_service.get_marketing_image_url",
        Mock(return_value="https://storage.test.invalid/revision"),
    )
    return case


def test_active_customer_image_revision_is_disabled_before_provider_calls(
    image_revision_case, monkeypatch,
):
    case = image_revision_case
    download = Mock()
    edit = Mock()
    monkeypatch.setattr(
        "app.features.media.workflows_service.download_marketing_image",
        download,
    )
    monkeypatch.setattr(
        "app.features.media.workflows_service.edit_marketing_image",
        edit,
    )
    response = case.client.post(
        f"/drafts/{case.draft_id}/image-revisions",
        json={"instructions": "Make the background warmer"},
    )

    assert response.status_code == 429
    assert response.json() == {
        "detail": "AI image generation and editing are temporarily unavailable.",
    }
    download.assert_not_called()
    edit.assert_not_called()
    assert saved_draft(case).image_url == (
        f"businesses/{case.business_id}/original.png"
    )
    with Session(case.engine) as db:
        revisions = db.scalars(
            select(ImageRevision).where(ImageRevision.draft_id == case.draft_id)
        ).all()
        assert revisions == []


def test_image_revision_does_not_call_provider_when_disabled(
    image_revision_case,
    monkeypatch,
):
    case = image_revision_case
    edit = Mock(side_effect=RuntimeError("editor unavailable"))
    monkeypatch.setattr(
        "app.features.media.workflows_service.edit_marketing_image",
        edit,
    )

    response = case.client.post(
        f"/drafts/{case.draft_id}/image-revisions",
        json={"instructions": "Make the background warmer"},
    )

    assert response.status_code == 429
    assert response.json() == {
        "detail": "AI image generation and editing are temporarily unavailable.",
    }
    edit.assert_not_called()
    assert saved_draft(case).image_url.endswith("/original.png")
    with Session(case.engine) as db:
        revision = db.scalar(
            select(ImageRevision).where(ImageRevision.draft_id == case.draft_id)
        )
        assert revision is None


def test_accept_and_reject_image_revisions_preserve_expected_source(
    image_revision_case,
):
    case = image_revision_case
    with Session(case.engine) as db:
        accepted = ImageRevision(
            draft_id=case.draft_id,
            original_image_path=f"businesses/{case.business_id}/original.png",
            revised_image_path=f"businesses/{case.business_id}/accepted.png",
            instructions="Accepted",
            status="ready",
        )
        rejected = ImageRevision(
            draft_id=case.draft_id,
            original_image_path=f"businesses/{case.business_id}/original.png",
            revised_image_path=f"businesses/{case.business_id}/rejected.png",
            instructions="Rejected",
            status="ready",
        )
        db.add_all([accepted, rejected])
        db.commit()
        accepted_id, rejected_id = accepted.id, rejected.id

    accept_response = case.client.post(
        f"/drafts/{case.draft_id}/image-revisions/{accepted_id}/accept",
    )
    assert accept_response.status_code == 200
    assert accept_response.json()["status"] == "accepted"
    assert saved_draft(case).image_url.endswith("/accepted.png")

    reject_response = case.client.post(
        f"/drafts/{case.draft_id}/image-revisions/{rejected_id}/reject",
    )
    assert reject_response.status_code == 200
    assert reject_response.json() == {
        "draft_id": case.draft_id,
        "revision_id": rejected_id,
        "status": "rejected",
        "message": "Original image preserved",
    }
    assert saved_draft(case).image_url.endswith("/accepted.png")


def test_revision_list_is_draft_scoped_and_instructions_trimmed(
    image_revision_case,
):
    case = image_revision_case
    with Session(case.engine) as db:
        db.add(ImageRevision(
            draft_id=case.draft_id,
            original_image_path=f"businesses/{case.business_id}/original.png",
            instructions="More contrast",
            status="ready",
        ))
        db.commit()
    listing = case.client.get(f"/drafts/{case.draft_id}/image-revisions")
    assert listing.status_code == 200
    assert listing.json()[0]["instructions"] == "More contrast"
    assert listing.json()[0]["draft_id"] == case.draft_id


def test_revisions_reject_unready_state_and_blank_instructions(
    image_revision_case,
):
    case = image_revision_case
    blank = case.client.post(
        f"/drafts/{case.draft_id}/image-revisions",
        json={"instructions": "   "},
    )
    assert blank.status_code == 422
    assert blank.json() == {"detail": "Editing instructions cannot be empty"}

    with Session(case.engine) as db:
        revision = ImageRevision(
            draft_id=case.draft_id,
            original_image_path=f"businesses/{case.business_id}/original.png",
            instructions="Still generating",
            status="generating",
        )
        db.add(revision)
        db.commit()
        revision_id = revision.id
    reject = case.client.post(
        f"/drafts/{case.draft_id}/image-revisions/{revision_id}/reject",
    )
    assert reject.status_code == 409
    assert reject.json() == {"detail": "Only ready revisions can be rejected"}
