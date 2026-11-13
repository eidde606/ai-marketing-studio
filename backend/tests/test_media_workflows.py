from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Business, Draft, ImageRevision
from tests.tenancy_fixtures import grant_test_owner


@pytest.fixture
def media_case(isolated_client):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Media workflow business")
        db.add(business)
        db.flush()
        grant_test_owner(db, [business.id])
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
    upload.assert_not_called()


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


def test_image_generation_saves_completed_private_storage_path(
    media_case,
    monkeypatch,
):
    case = media_case
    generate = Mock(return_value=f"businesses/{case.business_id}/generated.png")
    sign = Mock(return_value="https://storage.test.invalid/image")
    monkeypatch.setattr("app.features.media.workflows_service.generate_marketing_image", generate)
    monkeypatch.setattr("app.features.media.workflows_service.get_marketing_image_url", sign)

    response = case.client.post(f"/drafts/{case.draft_id}/generate-image")

    assert response.status_code == 200
    assert response.json() == {
        "draft_id": case.draft_id,
        "image_status": "completed",
        "image_url": "https://storage.test.invalid/image",
    }
    generate.assert_called_once_with(
        image_prompt="A product on a blue background",
        business_id=case.business_id,
    )
    assert saved_draft(case).image_url == (
        f"businesses/{case.business_id}/generated.png"
    )
    sign.assert_called_once_with(
        f"businesses/{case.business_id}/generated.png",
        context=sign.call_args.kwargs["context"],
    )
    assert sign.call_args.kwargs["context"].business_id == case.business_id


def test_membership_revocation_during_image_generation_prevents_result_persistence(
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
        principal = AuthenticatedPrincipal(
            SUPABASE_ISSUER, user.auth_subject, user.id,
        )
        membership_id = membership.id

    previous = app.dependency_overrides[get_authenticated_principal]
    app.dependency_overrides[get_authenticated_principal] = lambda: principal

    def revoke_then_return(**_kwargs):
        with Session(case.engine) as db:
            db.get(BusinessMembership, membership_id).status = "revoked"
            db.commit()
        return f"businesses/{case.business_id}/generated.png"

    monkeypatch.setattr(
        "app.features.media.workflows_service.generate_marketing_image",
        revoke_then_return,
    )
    try:
        response = case.client.post(f"/drafts/{case.draft_id}/generate-image")
    finally:
        app.dependency_overrides[get_authenticated_principal] = previous

    assert response.status_code == 404
    draft = saved_draft(case)
    assert draft.image_status == "failed"
    assert draft.image_url is None


def test_image_generation_failure_marks_attempt_failed(
    media_case,
    monkeypatch,
):
    case = media_case
    monkeypatch.setattr(
        "app.features.media.workflows_service.generate_marketing_image",
        Mock(side_effect=RuntimeError("provider unavailable")),
    )

    response = case.client.post(f"/drafts/{case.draft_id}/generate-image")

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Image generation failed. Please try again later.",
    }
    draft = saved_draft(case)
    assert draft.image_status == "failed"
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


def test_image_revision_creation_preserves_original_until_acceptance(
    image_revision_case,
):
    case = image_revision_case
    response = case.client.post(
        f"/drafts/{case.draft_id}/image-revisions",
        json={"instructions": "Make the background warmer"},
    )

    assert response.status_code == 201
    assert response.json()["status"] == "ready"
    assert response.json()["image_url"] == "https://storage.test.invalid/revision"
    assert saved_draft(case).image_url == (
        f"businesses/{case.business_id}/original.png"
    )
    with Session(case.engine) as db:
        revisions = db.scalars(
            select(ImageRevision).where(ImageRevision.draft_id == case.draft_id)
        ).all()
        assert len(revisions) == 1
        assert revisions[0].original_image_path.endswith("/original.png")
        assert revisions[0].revised_image_path.endswith("/revised.png")


def test_failed_image_revision_preserves_original_and_marks_revision_failed(
    image_revision_case,
    monkeypatch,
):
    case = image_revision_case
    monkeypatch.setattr(
        "app.features.media.workflows_service.edit_marketing_image",
        Mock(side_effect=RuntimeError("editor unavailable")),
    )

    response = case.client.post(
        f"/drafts/{case.draft_id}/image-revisions",
        json={"instructions": "Make the background warmer"},
    )

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Image editing failed. The original image was not changed.",
    }
    assert saved_draft(case).image_url.endswith("/original.png")
    with Session(case.engine) as db:
        revision = db.scalar(
            select(ImageRevision).where(ImageRevision.draft_id == case.draft_id)
        )
        assert revision.status == "failed"


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
    response = case.client.post(
        f"/drafts/{case.draft_id}/image-revisions",
        json={"instructions": "  More contrast  "},
    )
    assert response.status_code == 201
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
