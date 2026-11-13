from sqlalchemy import select
from sqlalchemy.orm import Session


def test_private_assets_must_be_explicitly_assigned_and_are_exclusive(
    isolated_client,
):
    from app.models import Business
    from tests.tenancy_fixtures import grant_test_owner

    client, engine = isolated_client
    with Session(engine) as db:
        db.add_all([
            Business(id="business-a", name="A"),
            Business(id="business-b", name="B"),
        ])
        db.flush()
        principal = grant_test_owner(db, ["business-a", "business-b"])
        db.commit()

    assigned = client.post(
        "/businesses/business-a/heygen/assets/assignments",
        json={"asset_type": "avatar", "provider_asset_id": "private-avatar"},
    )
    assert assigned.status_code == 201
    assert assigned.json() == {
        "asset_type": "avatar",
        "provider_asset_id": "private-avatar",
    }

    other_business = client.post(
        "/businesses/business-b/heygen/assets/assignments",
        json={"asset_type": "avatar", "provider_asset_id": "private-avatar"},
    )
    assert other_business.status_code == 409


def test_members_cannot_assign_private_assets(isolated_client):
    from app.features.access.principal import AuthenticatedPrincipal
    from app.models import Business, BusinessMembership
    from app.auth import get_authenticated_principal
    from app.main import app
    from tests.tenancy_fixtures import grant_test_owner

    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Business")
        db.add(business)
        db.flush()
        principal = grant_test_owner(db, [business.id])
        membership = db.query(BusinessMembership).filter_by(
            business_id=business.id, user_id=principal.user_id,
        ).one()
        membership.role = "member"
        db.commit()
        business_id = business.id
    previous = app.dependency_overrides[get_authenticated_principal]
    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    try:
        response = client.post(
            f"/businesses/{business_id}/heygen/assets/assignments",
            json={"asset_type": "voice", "provider_asset_id": "private-voice"},
        )
    finally:
        app.dependency_overrides[get_authenticated_principal] = previous
    assert response.status_code == 403


def test_business_cannot_generate_with_another_business_private_assets(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service
    from app.models import Business, Draft, HeyGenAssetAccess
    from tests.tenancy_fixtures import grant_test_owner

    client, engine = isolated_client
    with Session(engine) as db:
        db.add(Business(id="business-a", name="A"))
        db.add(Business(id="business-b", name="B"))
        db.flush()
        principal = grant_test_owner(db, ["business-a", "business-b"])
        db.add(Draft(
            id="draft-business-b",
            business_id="business-b",
            title="Video draft",
            caption="Caption",
            platform="facebook",
            status="pending",
        ))
        for asset_type, asset_id in (
            ("avatar", "private-avatar"),
            ("voice", "private-voice"),
        ):
            db.add(HeyGenAssetAccess(
                asset_type=asset_type,
                provider_asset_id=asset_id,
                access_scope="business_private",
                business_id="business-a",
                assigned_by_user_id=principal.user_id,
            ))
        db.commit()
    provider_calls = []
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **kwargs: provider_calls.append(kwargs),
    )

    response = client.post(
        "/businesses/business-b/drafts/draft-business-b/heygen-generation",
        json={
            "avatar_id": "private-avatar",
            "voice_id": "private-voice",
            "script": "A test script",
        },
    )

    assert response.status_code == 403
    assert provider_calls == []


def test_provider_asset_id_without_assignment_cannot_start_generation(
    isolated_client, monkeypatch,
):
    from app.features.media import generation_service
    from app.models import Business, Draft, HeyGenAssetAccess, HeyGenGenerationAttempt
    from tests.tenancy_fixtures import grant_test_owner

    client, engine = isolated_client
    with Session(engine) as db:
        db.add(Business(id="business-1", name="Business"))
        db.flush()
        principal = grant_test_owner(db, ["business-1"])
        db.add(Draft(
            id="draft-1",
            business_id="business-1",
            title="Video draft",
            caption="Caption",
            platform="facebook",
            status="pending",
        ))
        db.add(HeyGenAssetAccess(
            asset_type="voice",
            provider_asset_id="selected-voice",
            access_scope="business_private",
            business_id="business-1",
            assigned_by_user_id=principal.user_id,
        ))
        db.commit()
    provider_calls = []
    monkeypatch.setattr(
        generation_service,
        "generate_video",
        lambda **kwargs: provider_calls.append(kwargs),
    )

    response = client.post(
        "/businesses/business-1/drafts/draft-1/heygen-generation",
        json={
            "avatar_id": "unassigned-private-avatar",
            "voice_id": "selected-voice",
            "script": "A test script",
        },
    )

    assert response.status_code == 403
    assert provider_calls == []
    with Session(engine) as db:
        assert db.scalar(select(HeyGenGenerationAttempt)) is None
