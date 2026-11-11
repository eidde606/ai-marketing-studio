import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.orm import Session

from app.models import (
    Business,
    InstagramConnection,
    InstagramOAuthState,
    SocialAccount,
)


def test_instagram_callback_access_log_redaction_preserves_route_query():
    from app.features.instagram.routes import (
        InstagramCallbackAccessLogRedactionMiddleware,
    )

    observed = {}

    async def app(scope, receive, send):
        observed["route_query"] = scope["query_string"]
        await send({"type": "http.response.start", "status": 303, "headers": []})
        observed["restored_query"] = scope["query_string"]

    async def send(message):
        observed["logged_query"] = scope["query_string"]

    scope = {
        "type": "http",
        "path": "/auth/instagram/callback",
        "query_string": b"code=private-code&state=private-state",
    }
    asyncio.run(
        InstagramCallbackAccessLogRedactionMiddleware(app)(
            scope, lambda: None, send,
        )
    )
    assert observed == {
        "route_query": b"code=private-code&state=private-state",
        "logged_query": b"",
        "restored_query": b"code=private-code&state=private-state",
    }


def test_instagram_callback_log_redaction_does_not_change_other_routes():
    from app.features.instagram.routes import (
        InstagramCallbackAccessLogRedactionMiddleware,
    )

    observed = {}

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})

    async def send(message):
        observed["query"] = scope["query_string"]

    scope = {
        "type": "http",
        "path": "/auth/facebook/callback",
        "query_string": b"code=facebook-code&state=facebook-state",
    }
    asyncio.run(
        InstagramCallbackAccessLogRedactionMiddleware(app)(
            scope, lambda: None, send,
        )
    )
    assert observed["query"] == b"code=facebook-code&state=facebook-state"


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
    }])
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        pages,
    )
    account_lookup = AsyncMock(return_value={
        "id": "page-a",
        "instagram_business_account": {
            "id": "ig-a", "username": "holacompravibes",
        },
    })
    monkeypatch.setattr(
        "app.features.instagram.provider.get_page_instagram_account",
        account_lookup,
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
    account_lookup.assert_awaited_once_with("fake-access-token", "page-a")


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
            },
            {
                "id": "page-a",
            },
        ]),
    )
    account_lookup = AsyncMock(return_value={
        "id": "page-a",
        "instagram_business_account": {
            "id": "ig-a", "username": "holacompravibes",
        },
    })
    monkeypatch.setattr(
        "app.features.instagram.provider.get_page_instagram_account",
        account_lookup,
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
        account_lookup.assert_awaited_once_with("fake-access-token", "page-a")


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
    pages = AsyncMock(return_value=[{"id": "other-page"}])
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        pages,
    )
    account_lookup = AsyncMock()
    monkeypatch.setattr(
        "app.features.instagram.provider.get_page_instagram_account",
        account_lookup,
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
    account_lookup.assert_not_awaited()


def test_missing_instagram_account_is_reported_without_discovery_failure(
    isolated_client, monkeypatch
):
    client, engine = isolated_client
    business_id, _ = create_business(engine)
    callback_state(engine, business_id, "page-a")
    _mock_authorized_user(monkeypatch)
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        _async_value([{"id": "page-a"}]),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_page_instagram_account",
        _async_value({"id": "page-a", "instagram_business_account": None}),
    )

    client.get(
        "/auth/instagram/callback",
        params={"state": "test-state", "code": "fake-code"},
        follow_redirects=False,
    )
    status = client.get(
        "/auth/instagram/accounts", params={"business_id": business_id},
    ).json()
    assert status["status"] == "not_connected"
    assert status["username"] is None


def test_missing_instagram_username_does_not_reject_account(
    isolated_client, monkeypatch
):
    client, engine = isolated_client
    business_id, _ = create_business(engine)
    callback_state(engine, business_id, "page-a")
    _mock_authorized_user(monkeypatch)
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        _async_value([{"id": "page-a"}]),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_page_instagram_account",
        _async_value({
            "id": "page-a",
            "instagram_business_account": {"id": "ig-a"},
        }),
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
    status = client.get(
        "/auth/instagram/accounts", params={"business_id": business_id},
    ).json()
    assert status["status"] == "connected_and_authorized"
    assert status["username"] is None


def test_page_lookup_must_return_the_authorized_page_id(
    isolated_client, monkeypatch
):
    client, engine = isolated_client
    business_id, _ = create_business(engine)
    callback_state(engine, business_id, "page-a")
    _mock_authorized_user(monkeypatch)
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        _async_value([{"id": "page-a"}]),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_page_instagram_account",
        _async_value({
            "id": "different-page",
            "instagram_business_account": {
                "id": "ig-a", "username": "holacompravibes",
            },
        }),
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


def test_malformed_page_lookup_response_is_safely_rejected(
    isolated_client, monkeypatch, caplog
):
    client, engine = isolated_client
    business_id, _ = create_business(engine)
    callback_state(engine, business_id, "page-a")
    _mock_authorized_user(monkeypatch)
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        _async_value([{"id": "page-a"}]),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_page_instagram_account",
        _async_value({"id": "page-a", "instagram_business_account": []}),
    )

    with caplog.at_level(logging.WARNING, logger="app.features.instagram.service"):
        client.get(
            "/auth/instagram/callback",
            params={"state": "test-state", "code": "sensitive-code"},
            follow_redirects=False,
        )
    status = client.get(
        "/auth/instagram/accounts", params={"business_id": business_id},
    ).json()
    assert status["status"] == "discovery_error"
    assert "sensitive-code" not in caplog.text
    assert "test-state" not in caplog.text
    assert "Instagram account lookup returned an invalid account structure" in caplog.text


def test_page_lookup_meta_error_is_logged_without_sensitive_data(
    isolated_client, monkeypatch, caplog
):
    from app.features.instagram.provider import MetaAPIError

    client, engine = isolated_client
    business_id, _ = create_business(engine)
    callback_state(engine, business_id, "page-a")
    _mock_authorized_user(monkeypatch)
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        _async_value([{"id": "page-a"}]),
    )

    async def fail_lookup(*_args):
        raise MetaAPIError(403, 10)

    monkeypatch.setattr(
        "app.features.instagram.provider.get_page_instagram_account",
        fail_lookup,
    )

    with caplog.at_level(logging.WARNING, logger="app.features.instagram.service"):
        client.get(
            "/auth/instagram/callback",
            params={"state": "test-state", "code": "sensitive-code"},
            follow_redirects=False,
        )
    status = client.get(
        "/auth/instagram/accounts", params={"business_id": business_id},
    ).json()
    assert status["status"] == "permission_error"
    assert "Instagram account lookup failed (Meta status=403, code=10)" in caplog.text
    assert "sensitive-code" not in caplog.text
    assert "test-state" not in caplog.text


def test_provider_uses_user_token_for_page_listing_and_separate_page_lookup(
    monkeypatch,
):
    from app.features.instagram import provider

    calls = []
    responses = [
        {"data": [{"id": "page-a", "name": "Hola Compra Vibes"}]},
        {
            "id": "page-a",
            "instagram_business_account": {
                "id": "ig-a", "username": "holacompravibes",
            },
        },
    ]

    class FakeResponse:
        is_error = False

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, *, params=None, headers=None):
            calls.append((url, params, headers))
            return FakeResponse(responses.pop(0))

    monkeypatch.setattr(provider.httpx, "AsyncClient", FakeClient)

    async def discover():
        pages = await provider.get_managed_pages("test-user-token")
        page = await provider.get_page_instagram_account(
            "test-user-token", "page-a",
        )
        return pages, page

    pages, page = asyncio.run(discover())

    assert pages == [{"id": "page-a", "name": "Hola Compra Vibes"}]
    assert page["instagram_business_account"]["id"] == "ig-a"
    assert calls[0][0] == f"{provider.GRAPH_API_URL}/me/accounts"
    assert calls[0][1]["fields"] == "id,name"
    assert calls[0][2]["Authorization"].startswith("Bearer ")
    assert calls[0][2]["Authorization"].endswith("test-user-token")
    assert calls[1][0] == f"{provider.GRAPH_API_URL}/page-a"
    assert calls[1][1]["fields"] == "id,instagram_business_account{id,username}"
    assert calls[1][2]["Authorization"].startswith("Bearer ")
    assert calls[1][2]["Authorization"].endswith("test-user-token")


def test_provider_rejects_malformed_page_and_page_lookup_responses(monkeypatch):
    from app.features.instagram import provider

    responses = [
        {"data": "not-a-list"},
        ["not-a-page-object"],
    ]

    class FakeResponse:
        is_error = False

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, *args, **kwargs):
            return FakeResponse(responses.pop(0))

    monkeypatch.setattr(provider.httpx, "AsyncClient", FakeClient)

    async def discover():
        with pytest.raises(ValueError, match="invalid Page list"):
            await provider.get_managed_pages("test-user-token")
        with pytest.raises(ValueError, match="invalid Page response"):
            await provider.get_page_instagram_account(
                "test-user-token", "page-a",
            )

    asyncio.run(discover())


def test_provider_preserves_meta_error_details_without_response_body(monkeypatch):
    from app.features.instagram import provider

    class FakeResponse:
        is_error = True
        status_code = 403

        def json(self):
            return {"error": {"code": 200, "message": "sensitive provider detail"}}

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(provider.httpx, "AsyncClient", FakeClient)

    async def lookup():
        with pytest.raises(provider.MetaAPIError) as error:
            await provider.get_page_instagram_account(
                "test-user-token", "page-a",
            )
        assert error.value.status_code == 403
        assert error.value.error_code == 200
        assert "sensitive provider detail" not in str(error.value)

    asyncio.run(lookup())


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
    _mock_authorized_user(monkeypatch)
    monkeypatch.setattr(
        "app.features.instagram.provider.exchange_code_for_long_lived_token",
        _async_value(("new-instagram-token", 3600)),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_managed_pages",
        _async_value([{"id": "page-a"}]),
    )
    monkeypatch.setattr(
        "app.features.instagram.provider.get_page_instagram_account",
        _async_value({
            "id": "page-a",
            "instagram_business_account": {
                "id": "new-ig", "username": "holacompravibes",
            },
        }),
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


def _mock_authorized_user(monkeypatch):
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
        "app.features.instagram.service.encrypt_token",
        lambda token: f"encrypted:{token}",
    )
