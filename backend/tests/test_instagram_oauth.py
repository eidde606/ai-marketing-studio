import hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse
from unittest.mock import AsyncMock

from sqlalchemy.orm import Session

from app.models import (
    Business,
    InstagramConnection,
    InstagramOAuthState,
    SocialAccount,
)


def test_login_uses_independent_instagram_configuration(monkeypatch):
    from app.features.instagram.provider import build_login_url

    monkeypatch.setenv("FACEBOOK_APP_ID", "test-app-id")
    monkeypatch.setenv("FACEBOOK_CONFIG_ID", "facebook-config")
    monkeypatch.setenv("INSTAGRAM_CONFIG_ID", "instagram-config")
    monkeypatch.setenv(
        "INSTAGRAM_REDIRECT_URI",
        "https://api.test.invalid/auth/instagram/callback",
    )
    params = parse_qs(urlparse(build_login_url("csrf-state")).query)
    assert params["config_id"] == ["instagram-config"]
    assert params["client_id"] == ["test-app-id"]
    assert params["state"] == ["csrf-state"]
    assert params["redirect_uri"] == [
        "https://api.test.invalid/auth/instagram/callback"
    ]


def create_business(engine, suffix="a"):
    with Session(engine) as db:
        business = Business(name=f"Business {suffix}")
        db.add(business)
        db.flush()
        page = SocialAccount(
            business_id=business.id,
            platform="facebook",
            platform_account_id=f"page-{suffix}",
            account_name=f"Page {suffix}",
            encrypted_access_token="unchanged-facebook-token",
            connection_status="connected",
        )
        db.add(page)
        db.commit()
        return business.id, page.id


def callback_state(engine, business_id, page_id, state="test-state"):
    with Session(engine) as db:
        db.add(
            InstagramOAuthState(
                state_hash=hashlib.sha256(state.encode()).hexdigest(),
                business_id=business_id,
                user_id="test-authorized-user",
                facebook_page_id=page_id,
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            )
        )
        db.commit()


def test_start_uses_instagram_configuration_and_business_page(isolated_client, monkeypatch):
    client, engine = isolated_client
    business_id, _ = create_business(engine)
    monkeypatch.setattr(
        "app.features.instagram.provider.build_login_url",
        lambda state: f"https://meta.test/authorize?state={state}&config=instagram",
    )

    response = client.get(
        "/auth/instagram/start",
        params={"business_id": business_id},
    )

    assert response.status_code == 200
    data = response.json()
    parsed = urlparse(data["authorization_url"])
    returned_state = parse_qs(parsed.query)["state"][0]
    assert parse_qs(parsed.query)["config"] == ["instagram"]
    with Session(engine) as db:
        state = db.query(InstagramOAuthState).one()
        import hashlib

        assert state.state_hash == hashlib.sha256(returned_state.encode()).hexdigest()
        assert state.business_id == business_id
        assert state.facebook_page_id == "page-a"


def test_invalid_and_replayed_callbacks_never_call_meta(isolated_client, monkeypatch):
    client, engine = isolated_client
    business_id, _ = create_business(engine)
    exchange = AsyncMock()
    monkeypatch.setattr(
        "app.features.instagram.provider.exchange_code_for_long_lived_token",
        exchange,
    )
    response = client.get(
        "/auth/instagram/callback",
        params={"state": "unknown", "code": "fake-code"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"].endswith("#instagram_result=invalid_state")

    callback_state(engine, business_id, "page-a")
    response = client.get(
        "/auth/instagram/callback",
        params={"state": "test-state", "error": "access_denied"},
        follow_redirects=False,
    )
    assert response.headers["location"].endswith(
        "#instagram_result=authorization_declined"
    )
    replay = client.get(
        "/auth/instagram/callback",
        params={"state": "test-state", "code": "fake-code"},
        follow_redirects=False,
    )
    assert replay.headers["location"].endswith("#instagram_result=invalid_state")

    with Session(engine) as db:
        db.add(
            InstagramOAuthState(
                state_hash=hashlib.sha256(b"expired-state").hexdigest(),
                business_id=business_id,
                user_id="test-authorized-user",
                facebook_page_id="page-a",
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            )
        )
        db.commit()
    expired = client.get(
        "/auth/instagram/callback",
        params={"state": "expired-state", "code": "fake-code"},
        follow_redirects=False,
    )
    assert expired.headers["location"].endswith("#instagram_result=invalid_state")
    exchange.assert_not_awaited()


def test_missing_permissions_are_not_reported_as_authorized(
    isolated_client, monkeypatch
):
    client, engine = isolated_client
    business_id, _ = create_business(engine)
    callback_state(engine, business_id, "page-a")
    monkeypatch.setattr(
        "app.features.instagram.provider.exchange_code_for_long_lived_token",
        _async_value(("fake-access-token", 3600)),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_granted_permissions",
        _async_value({"pages_show_list", "pages_read_engagement", "instagram_basic"}),
    )
    monkeypatch.setattr(
        "app.features.instagram.service.encrypt_token",
        lambda token: f"encrypted:{token}",
    )
    pages = AsyncMock(return_value=[{
        "id": "page-a",
        "instagram_business_account": {
            "id": "ig-a", "username": "holacompravibes",
        },
    }])
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        pages,
    )

    response = client.get(
        "/auth/instagram/callback",
        params={"state": "test-state", "code": "fake-code"},
        follow_redirects=False,
    )
    assert response.headers["location"].endswith(
        "#instagram_result=linked_not_api_authorized"
    )
    connection = client.get(
        "/auth/instagram/accounts", params={"business_id": business_id},
    ).json()
    assert connection["status"] == "linked_not_api_authorized"
    assert connection["username"] == "holacompravibes"
    assert connection["missing_permissions"] == ["instagram_content_publish"]
    pages.assert_awaited_once_with("fake-access-token")


def test_discovery_uses_only_the_businesss_authorized_page(
    isolated_client, monkeypatch
):
    client, engine = isolated_client
    business_id, _ = create_business(engine)
    callback_state(engine, business_id, "page-a")
    monkeypatch.setattr(
        "app.features.instagram.provider.exchange_code_for_long_lived_token",
        _async_value(("fake-access-token", 3600)),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_granted_permissions",
        _async_value({
            "pages_show_list", "pages_read_engagement", "instagram_basic",
            "instagram_content_publish",
        }),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        _async_value([
            {
                "id": "another-page",
                "instagram_business_account": {
                    "id": "wrong-ig", "username": "wrong_account",
                },
            },
            {
                "id": "page-a",
                "instagram_business_account": {
                    "id": "ig-a", "username": "holacompravibes",
                },
            },
        ]),
    )
    monkeypatch.setattr(
        "app.features.instagram.service.encrypt_token",
        lambda token: f"encrypted:{token}",
    )

    response = client.get(
        "/auth/instagram/callback",
        params={"state": "test-state", "code": "fake-code"},
        follow_redirects=False,
    )
    assert response.headers["location"].endswith(
        "#instagram_result=connected_and_authorized"
    )
    status = client.get(
        "/auth/instagram/accounts", params={"business_id": business_id},
    ).json()
    assert status["status"] == "connected_and_authorized"
    assert status["username"] == "holacompravibes"
    assert status["facebook_page_id"] == "page-a"
    assert "access_token" not in status
    assert "encrypted_access_token" not in status
    with Session(engine) as db:
        saved = db.get(InstagramConnection, business_id)
        assert saved.instagram_account_id == "ig-a"
        assert saved.encrypted_access_token == "encrypted:fake-access-token"


def test_wrong_page_account_relationship_is_rejected(isolated_client, monkeypatch):
    client, engine = isolated_client
    business_id, _ = create_business(engine)
    callback_state(engine, business_id, "page-a")
    monkeypatch.setattr(
        "app.features.instagram.provider.exchange_code_for_long_lived_token",
        _async_value(("fake-access-token", 3600)),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_granted_permissions",
        _async_value({
            "pages_show_list", "pages_read_engagement", "instagram_basic",
            "instagram_content_publish",
        }),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        _async_value([{
            "id": "other-page",
            "instagram_business_account": {
                "id": "ig-a", "username": "holacompravibes",
            },
        }]),
    )

    client.get(
        "/auth/instagram/callback",
        params={"state": "test-state", "code": "fake-code"},
        follow_redirects=False,
    )
    status = client.get(
        "/auth/instagram/accounts", params={"business_id": business_id},
    ).json()
    assert status["status"] == "discovery_error"
    assert status["username"] is None


def test_saved_connection_is_not_ready_after_business_page_changes(isolated_client):
    client, engine = isolated_client
    business_id, _ = create_business(engine)
    with Session(engine) as db:
        db.add(
            InstagramConnection(
                business_id=business_id,
                instagram_account_id="ig-a",
                username="holacompravibes",
                facebook_page_id="previous-page",
                encrypted_access_token="encrypted-token",
                token_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
                granted_permissions=[
                    "pages_show_list", "pages_read_engagement",
                    "instagram_basic", "instagram_content_publish",
                ],
                status="connected_and_authorized",
            )
        )
        db.commit()

    status = client.get(
        "/auth/instagram/accounts", params={"business_id": business_id},
    ).json()
    assert status["status"] == "discovery_error"
    assert status["message"]


def test_business_isolation_and_facebook_account_survive_instagram_reconnect(
    isolated_client, monkeypatch
):
    client, engine = isolated_client
    business_a, _ = create_business(engine, "a")
    business_b, _ = create_business(engine, "b")
    callback_state(engine, business_a, "page-a")
    with Session(engine) as db:
        db.add(
            InstagramConnection(
                business_id=business_a,
                instagram_account_id="old-ig",
                username="old-account",
                facebook_page_id="page-a",
                encrypted_access_token="old-instagram-token",
                token_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
                granted_permissions=[
                    "pages_show_list", "pages_read_engagement",
                    "instagram_basic", "instagram_content_publish",
                ],
                status="connected_and_authorized",
            )
        )
        db.commit()
    monkeypatch.setattr(
        "app.features.instagram.provider.exchange_code_for_long_lived_token",
        _async_value(("new-instagram-token", 3600)),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_granted_permissions",
        _async_value({
            "pages_show_list", "pages_read_engagement", "instagram_basic",
            "instagram_content_publish",
        }),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        _async_value([{
            "id": "page-a",
            "instagram_business_account": {
                "id": "new-ig", "username": "holacompravibes",
            },
        }]),
    )
    monkeypatch.setattr(
        "app.features.instagram.service.encrypt_token",
        lambda token: f"encrypted:{token}",
    )
    client.get(
        "/auth/instagram/callback",
        params={"state": "test-state", "code": "fake-code"},
        follow_redirects=False,
    )

    assert client.get(
        "/auth/instagram/accounts", params={"business_id": business_b},
    ).json()["status"] == "not_connected"
    facebook = client.get(
        "/auth/facebook/accounts", params={"business_id": business_a},
    ).json()["accounts"]
    assert facebook == [{
        "id": facebook[0]["id"],
        "platform": "facebook",
        "page_id": "page-a",
        "page_name": "Page a",
        "connection_status": "connected",
    }]
    with Session(engine) as db:
        saved_facebook = db.get(SocialAccount, facebook[0]["id"])
        assert saved_facebook.encrypted_access_token == "unchanged-facebook-token"
        saved_instagram = db.get(InstagramConnection, business_a)
        assert saved_instagram.instagram_account_id == "new-ig"
        assert saved_instagram.username == "holacompravibes"
        assert saved_instagram.encrypted_access_token == (
            "encrypted:new-instagram-token"
        )
        assert db.query(InstagramConnection).filter_by(
            business_id=business_a,
        ).count() == 1


def _async_value(value):
    async def resolve(*args, **kwargs):
        return value

    return resolve
