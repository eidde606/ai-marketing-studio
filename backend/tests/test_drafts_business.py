from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.auth import verify_token
from app.main import app
from app.models import Business, Draft, SocialAccount


def test_business_create_and_list_contract(isolated_client):
    client, engine = isolated_client
    response = client.post(
        "/businesses",
        json={
            "name": "Hola Compra Vibes",
            "description": "Contenido local",
            "target_audience": "Familias",
        },
    )

    assert response.status_code == 201
    created = response.json()
    assert created["id"]
    assert created["name"] == "Hola Compra Vibes"
    assert created["description"] == "Contenido local"
    assert created["target_audience"] == "Familias"
    assert created["brand_voice"] is None

    listed = client.get("/businesses")
    assert listed.status_code == 200
    assert [business["id"] for business in listed.json()] == [created["id"]]
    with Session(engine) as db:
        assert db.get(Business, created["id"]).name == "Hola Compra Vibes"


def test_business_create_requires_name(isolated_client):
    client, _ = isolated_client
    assert client.post("/businesses", json={}).status_code == 422


def test_draft_create_and_list_contract(isolated_client):
    client, engine = isolated_client
    business = client.post("/businesses", json={"name": "Negocio"}).json()

    created = client.post(
        "/drafts",
        json={
            "business_id": business["id"],
            "title": "Publicación",
            "caption": "Texto",
            "platform": "instagram",
        },
    )
    assert created.status_code == 201
    draft = created.json()
    assert draft["business_id"] == business["id"]
    assert draft["title"] == "Publicación"
    assert draft["caption"] == "Texto"
    assert draft["platform"] == "instagram"
    assert draft["media_type"] == "text"
    assert draft["status"] == "pending"
    assert draft["publish_destinations"] == ["facebook"]

    assert client.get(
        "/drafts", params={"business_id": business["id"]},
    ).json() == [draft]
    missing_business = client.get(
        "/drafts", params={"business_id": "missing"},
    )
    assert missing_business.status_code == 404
    assert missing_business.json()["detail"] == "Business not found"
    with Session(engine) as db:
        assert db.get(Draft, draft["id"]).title == "Publicación"


def test_draft_create_rejects_missing_business_and_invalid_media_type(
    isolated_client,
):
    client, _ = isolated_client
    payload = {
        "business_id": "missing",
        "title": "Publicación",
        "caption": "Texto",
        "platform": "facebook",
    }

    missing_business = client.post("/drafts", json=payload)
    assert missing_business.status_code == 404
    assert missing_business.json()["detail"] == "Business not found"
    assert client.post(
        "/drafts",
        json={**payload, "media_type": "audio"},
    ).status_code == 422


def test_draft_edit_approval_and_rejection_rules(isolated_client):
    client, engine = isolated_client
    business = client.post("/businesses", json={"name": "Negocio"}).json()
    draft = client.post(
        "/drafts",
        json={
            "business_id": business["id"],
            "title": "Original",
            "caption": "Texto original",
            "platform": "facebook",
        },
    ).json()

    edited = client.patch(
        f'/drafts/{draft["id"]}',
        json={"title": "Actualizado", "caption": "Texto nuevo"},
    )
    assert edited.status_code == 200
    assert (edited.json()["title"], edited.json()["caption"]) == (
        "Actualizado",
        "Texto nuevo",
    )
    assert client.patch(f'/drafts/{draft["id"]}/approve').json()["status"] == "approved"
    non_pending = client.patch(
        f'/drafts/{draft["id"]}',
        json={"title": "No permitido", "caption": "No permitido"},
    )
    assert non_pending.status_code == 409
    assert non_pending.json()["detail"] == "Only pending drafts can be edited"
    assert client.patch(f'/drafts/{draft["id"]}/reject').status_code == 409
    with Session(engine) as db:
        assert db.get(Draft, draft["id"]).title == "Actualizado"

    pending = client.post(
        "/drafts",
        json={
            "business_id": business["id"],
            "title": "Por rechazar",
            "caption": "Texto",
            "platform": "facebook",
        },
    ).json()
    rejected = client.patch(f'/drafts/{pending["id"]}/reject')
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"


def test_video_draft_must_be_completed_before_approval(isolated_client):
    client, engine = isolated_client
    business = client.post("/businesses", json={"name": "Negocio"}).json()
    draft = client.post(
        "/drafts",
        json={
            "business_id": business["id"],
            "title": "Video",
            "caption": "Texto",
            "platform": "facebook",
            "media_type": "video",
        },
    ).json()
    not_ready = client.patch(f'/drafts/{draft["id"]}/approve')
    assert not_ready.status_code == 409
    assert not_ready.json()["detail"] == "Video must be completed before approval"

    with Session(engine) as db:
        saved = db.get(Draft, draft["id"])
        saved.video_status = "completed"
        saved.video_url = "private/video.mp4"
        db.commit()
    approved = client.patch(f'/drafts/{draft["id"]}/approve')
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"


def test_deleted_published_drafts_only_appear_in_history(isolated_client):
    client, engine = isolated_client
    business = Business(name="Negocio")
    engine_business_id = None
    with Session(engine) as db:
        db.add(business)
        db.flush()
        draft = Draft(
            business_id=business.id,
            title="Histórico",
            caption="Publicado",
            platform="facebook",
            status="approved",
            deleted_at=datetime.now(timezone.utc),
            facebook_publish_status="published",
            facebook_post_id="page-post",
        )
        db.add(draft)
        from tests.tenancy_fixtures import grant_test_owner
        grant_test_owner(db, [business.id])
        db.commit()
        engine_business_id = business.id
        draft_id = draft.id

    assert client.get("/businesses").status_code == 200
    assert client.get(
        "/drafts", params={"business_id": engine_business_id},
    ).json() == []
    history = client.get(
        "/drafts",
        params={
            "business_id": engine_business_id,
            "include_deleted_published": True,
        },
    )
    assert history.status_code == 200
    assert [item["id"] for item in history.json()] == [draft_id]


def test_business_and_draft_routes_require_authentication(isolated_client):
    client, _ = isolated_client
    del app.dependency_overrides[verify_token]

    assert client.get("/businesses").status_code == 401
    assert client.get("/drafts", params={"business_id": "missing"}).status_code == 401


def test_draft_listing_is_scoped_to_requested_business(isolated_client):
    client, _ = isolated_client
    businesses = [
        client.post("/businesses", json={"name": name}).json()
        for name in ("Business A", "Business B")
    ]
    drafts = [
        client.post(
            "/drafts",
            json={
                "business_id": business["id"],
                "title": f"Draft {name}",
                "caption": "Text",
                "platform": "facebook",
            },
        ).json()
        for name, business in zip(("A", "B"), businesses)
    ]

    for business, own_draft, other_draft in (
        (businesses[0], drafts[0], drafts[1]),
        (businesses[1], drafts[1], drafts[0]),
    ):
        response = client.get(
            "/drafts",
            params={"business_id": business["id"]},
        )
        assert response.status_code == 200
        assert [draft["id"] for draft in response.json()] == [own_draft["id"]]
        assert other_draft["id"] not in [draft["id"] for draft in response.json()]


def test_destination_update_preserves_validation_and_connection_rules(
    isolated_client,
):
    client, engine = isolated_client
    business = client.post("/businesses", json={"name": "Negocio"}).json()
    draft = client.post(
        "/drafts",
        json={
            "business_id": business["id"],
            "title": "Publicación",
            "caption": "Texto",
            "platform": "facebook",
        },
    ).json()
    endpoint = f'/drafts/{draft["id"]}/destinations'

    duplicates = client.patch(
        endpoint,
        json={"destinations": ["facebook", "facebook"]},
    )
    assert duplicates.status_code == 422
    assert duplicates.json()["detail"] == "Duplicate destinations are not allowed"
    disconnected = client.patch(
        endpoint,
        json={"destinations": ["facebook"]},
    )
    assert disconnected.status_code == 409
    assert disconnected.json()["detail"] == "Connect the selected social accounts first"
    missing_media = client.patch(
        endpoint,
        json={"destinations": ["tiktok"]},
    )
    assert missing_media.status_code == 409
    assert missing_media.json()["detail"] == "TikTok requires an image or video"

    with Session(engine) as db:
        db.add_all([
            SocialAccount(
                business_id=business["id"],
                platform="facebook",
                platform_account_id="page",
                account_name="Facebook",
                encrypted_access_token="test-token",
                connection_status="connected",
            ),
            SocialAccount(
                business_id=business["id"],
                platform="tiktok",
                platform_account_id="creator",
                account_name="TikTok",
                encrypted_access_token="test-token",
                connection_status="connected",
            ),
        ])
        db.commit()
        db.get(Draft, draft["id"]).image_url = "private/image.png"
        db.commit()

    assert client.patch(
        endpoint,
        json={"destinations": ["facebook"]},
    ).json()["publish_destinations"] == ["facebook"]
    tiktok = client.patch(endpoint, json={"destinations": ["tiktok"]})
    assert tiktok.status_code == 200
    assert tiktok.json()["publish_destinations"] == ["tiktok"]
