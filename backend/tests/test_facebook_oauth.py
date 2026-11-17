import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_authenticated_principal, verify_token
from app.main import app
from app.models import BusinessMembership, FacebookOAuthState, SocialAccount
from tests.tenancy_fixtures import grant_test_owner


@pytest.fixture(autouse=True)
def facebook_frontend_redirect(monkeypatch):
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://studio.test.invalid")


def create_business(client) -> str:
    response = client.post("/businesses", json={"name": "Facebook business"})
    assert response.status_code == 201
    return response.json()["id"]


def create_oauth_state(engine, business_id: str, state: str = "facebook-state"):
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    with Session(engine) as db:
        principal = grant_test_owner(db, [business_id])
        db.add(
            FacebookOAuthState(
                state_hash=state_hash,
                business_id=business_id,
                user_id=principal.subject,
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            )
        )
        db.commit()
    return state


def create_pending_selection(
    engine,
    business_id: str,
    token: str = "facebook-selection-token",
    pages: list[dict] | None = None,
):
    with Session(engine) as db:
        principal = grant_test_owner(db, [business_id])
        pending = FacebookOAuthState(
            state_hash=hashlib.sha256(b"pending-state").hexdigest(),
            business_id=business_id,
            user_id=principal.subject,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            encrypted_pages=f"encrypted:{json.dumps(pages or [])}",
            selection_token_hash=hashlib.sha256(token.encode()).hexdigest(),
        )
        db.add(pending)
        db.commit()
    return token


def test_facebook_oauth_start_creates_hashed_expiring_state(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_id = create_business(client)
    monkeypatch.setattr(
        "app.features.facebook.provider.get_facebook_login_url",
        lambda state: f"https://facebook.test/authorize?state={state}",
    )

    response = client.get(
        "/auth/facebook/start",
        params={"business_id": business_id},
    )

    assert response.status_code == 200
    state = re.search(
        r"state=([^&]+)",
        response.json()["authorization_url"],
    ).group(1)
    with Session(engine) as db:
        saved = db.get(
            FacebookOAuthState,
            hashlib.sha256(state.encode()).hexdigest(),
        )
        assert saved.business_id == business_id
        assert saved.user_id == "test-authorized-user"
        assert saved.encrypted_pages is None
        assert saved.selection_token_hash is None
        assert saved.expires_at.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc)


def test_facebook_oauth_start_preserves_auth_and_missing_business_response(
    isolated_client,
    monkeypatch,
):
    client, _ = isolated_client
    monkeypatch.setattr(
        "app.features.facebook.provider.get_facebook_login_url",
        lambda state: "https://facebook.test/authorize",
    )

    missing = client.get(
        "/auth/facebook/start",
        params={"business_id": "missing"},
    )
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Business not found"}

    del app.dependency_overrides[verify_token]
    del app.dependency_overrides[get_authenticated_principal]
    unauthorized = client.get(
        "/auth/facebook/start",
        params={"business_id": "missing"},
    )
    assert unauthorized.status_code == 401


def test_facebook_oauth_start_reports_missing_configuration_without_saving_state(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_id = create_business(client)
    for name in (
        "FACEBOOK_APP_ID",
        "FACEBOOK_CONFIG_ID",
        "FACEBOOK_REDIRECT_URI",
    ):
        monkeypatch.delenv(name, raising=False)

    response = client.get(
        "/auth/facebook/start",
        params={"business_id": business_id},
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Facebook connection is not configured",
    }
    with Session(engine) as db:
        assert db.query(FacebookOAuthState).count() == 0


def test_facebook_provider_uses_configured_callback_uri(monkeypatch):
    from urllib.parse import parse_qs, urlparse

    from app.features.facebook.provider import get_facebook_login_url

    monkeypatch.setenv("FACEBOOK_APP_ID", "test-app-id")
    monkeypatch.setenv("FACEBOOK_CONFIG_ID", "test-config")
    monkeypatch.setenv(
        "FACEBOOK_REDIRECT_URI",
        "https://api.test.invalid/auth/facebook/callback",
    )

    params = parse_qs(urlparse(get_facebook_login_url("test-state")).query)

    assert params["redirect_uri"] == [
        "https://api.test.invalid/auth/facebook/callback",
    ]
    assert params["state"] == ["test-state"]


def test_facebook_page_lookup_uses_bearer_headers_not_token_query_params(monkeypatch):
    import asyncio

    from app.features.facebook import provider

    calls = []

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, *, params=None, headers=None):
            calls.append((url, params, headers))
            if url.endswith("/me/accounts"):
                return FakeResponse({"data": [{"id": "page-id", "name": "Page"}]})
            return FakeResponse({"id": "page-id", "name": "Page"})

    monkeypatch.setattr(provider.httpx, "AsyncClient", FakeClient)

    async def run():
        return (
            await provider.get_managed_pages("user-access-token"),
            await provider.get_page_info("page-id", "page-access-token"),
        )

    pages, page = asyncio.run(run())
    assert pages == [{"id": "page-id", "name": "Page"}]
    assert page == {"id": "page-id", "name": "Page"}
    assert calls[0][2] == {"Authorization": "Bearer user-access-token"}
    assert calls[1][2] == {"Authorization": "Bearer page-access-token"}
    assert all(
        token not in str((url, params))
        for token in ("user-access-token", "page-access-token")
        for url, params, _headers in calls
    )


def test_facebook_callback_consumes_state_before_provider_and_hands_off_pages(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_id = create_business(client)
    state = create_oauth_state(engine, business_id)
    exchange = AsyncMock(return_value="short-user-token")
    long_lived = AsyncMock(return_value="long-user-token")
    pages = AsyncMock(return_value=[
        {
            "id": "page-id",
            "name": "Hola Compra Vibes",
            "access_token": "page-access-token",
        },
    ])
    monkeypatch.setattr(
        "app.features.facebook.provider.exchange_code_for_token",
        exchange,
    )
    monkeypatch.setattr(
        "app.features.facebook.provider.get_long_lived_user_token",
        long_lived,
    )
    monkeypatch.setattr(
        "app.features.facebook.provider.get_managed_pages",
        pages,
    )
    monkeypatch.setattr(
        "app.features.facebook.service.encrypt_token",
        lambda value: f"encrypted:{value}",
    )
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://studio.test.invalid")

    response = client.get(
        "/auth/facebook/callback",
        params={"state": state, "code": "authorization-code"},
        follow_redirects=False,
    )

    assert response.status_code == 303
    fragment = parse_qs(urlsplit(response.headers["location"]).fragment)
    handoff = fragment["facebook_handoff"][0]
    assert fragment["business_id"] == [business_id]
    assert urlsplit(response.headers["location"]).netloc == "studio.test.invalid"
    assert len(handoff) > 20
    exchange.assert_awaited_once_with("authorization-code")
    long_lived.assert_awaited_once_with("short-user-token")
    pages.assert_awaited_once_with("long-user-token")
    with Session(engine) as db:
        assert db.get(
            FacebookOAuthState,
            hashlib.sha256(state.encode()).hexdigest(),
        ) is None
        pending = db.scalar(
            select(FacebookOAuthState).where(
                FacebookOAuthState.selection_token_hash
                == hashlib.sha256(handoff.encode()).hexdigest()
            )
        )
        assert pending.business_id == business_id
        assert pending.user_id == "test-authorized-user"
        assert json.loads(pending.encrypted_pages.removeprefix("encrypted:")) == [
            {
                "id": "page-id",
                "name": "Hola Compra Vibes",
                "access_token": "page-access-token",
            },
        ]


@pytest.mark.parametrize(
    ("params", "expected_detail"),
    [
        ({"state": "unknown"}, "Invalid, expired, or previously used authorization"),
        (
            {"state": "facebook-state", "error": "access_denied"},
            "Facebook authorization was declined",
        ),
        (
            {"state": "facebook-state"},
            "Facebook did not return an authorization code",
        ),
    ],
)
def test_facebook_callback_rejects_invalid_or_incomplete_authorization(
    isolated_client,
    params,
    expected_detail,
):
    client, engine = isolated_client
    business_id = create_business(client)
    if params["state"] == "facebook-state":
        create_oauth_state(engine, business_id)

    response = client.get(
        "/auth/facebook/callback",
        params=params,
        follow_redirects=False,
    )

    assert response.status_code == 303
    result = (
        "invalid_state"
        if expected_detail.startswith("Invalid,")
        else "authorization_declined"
    )
    assert response.headers["location"] == (
        f"https://studio.test.invalid/#facebook_result={result}"
    )


def test_facebook_callback_maps_provider_failure_and_consumes_state(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_id = create_business(client)
    state = create_oauth_state(engine, business_id)
    exchange = AsyncMock(side_effect=httpx.ConnectError("unavailable"))
    monkeypatch.setattr(
        "app.features.facebook.provider.exchange_code_for_token",
        exchange,
    )

    response = client.get(
        "/auth/facebook/callback",
        params={"state": state, "code": "authorization-code"},
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == (
        "https://studio.test.invalid/#facebook_result=provider_error"
    )
    exchange.assert_awaited_once_with("authorization-code")
    with Session(engine) as db:
        assert db.get(
            FacebookOAuthState,
            hashlib.sha256(state.encode()).hexdigest(),
        ) is None


def test_facebook_callback_rejects_empty_page_list(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_id = create_business(client)
    state = create_oauth_state(engine, business_id)
    monkeypatch.setattr(
        "app.features.facebook.provider.exchange_code_for_token",
        AsyncMock(return_value="short-token"),
    )
    monkeypatch.setattr(
        "app.features.facebook.provider.get_long_lived_user_token",
        AsyncMock(return_value="long-token"),
    )
    monkeypatch.setattr(
        "app.features.facebook.provider.get_managed_pages",
        AsyncMock(return_value=[]),
    )

    response = client.get(
        "/auth/facebook/callback",
        params={"state": state, "code": "authorization-code"},
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == (
        "https://studio.test.invalid/#facebook_result=no_pages"
    )


def test_facebook_member_cannot_list_or_connect_pages(isolated_client, monkeypatch):
    client, engine = isolated_client
    business_id = create_business(client)
    handoff = create_pending_selection(engine, business_id)
    login_url = monkeypatch.setattr(
        "app.features.facebook.provider.get_facebook_login_url",
        lambda state: "https://facebook.test/authorize",
    )
    with Session(engine) as db:
        membership = db.query(BusinessMembership).filter_by(
            business_id=business_id,
        ).one()
        membership.role = "member"
        db.commit()

    listing = client.get(
        "/auth/facebook/accounts", params={"business_id": business_id},
    )
    start = client.get(
        "/auth/facebook/start", params={"business_id": business_id},
    )
    handoff_response = client.post(
        "/auth/facebook/handoff",
        json={"handoff_token": handoff, "business_id": business_id},
    )

    assert [listing.status_code, start.status_code, handoff_response.status_code] == [
        403, 403, 403,
    ]
    assert all(response.json() == {"detail": "Operation not permitted"} for response in (
        listing, start, handoff_response,
    ))
    assert login_url is None
    with Session(engine) as db:
        assert db.query(FacebookOAuthState).count() == 1


def test_facebook_callback_rechecks_membership_after_provider_exchange(
    isolated_client, monkeypatch,
):
    from app.errors import ApplicationError, ErrorKind
    from app.features.facebook import service

    client, engine = isolated_client
    business_id = create_business(client)
    state = create_oauth_state(engine, business_id)
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://studio.test.invalid")
    exchange = AsyncMock(return_value="short-token")
    long_lived = AsyncMock(return_value="long-token")
    pages = AsyncMock(return_value=[{
        "id": "page-id", "name": "Page", "access_token": "page-token",
    }])
    monkeypatch.setattr("app.features.facebook.provider.exchange_code_for_token", exchange)
    monkeypatch.setattr("app.features.facebook.provider.get_long_lived_user_token", long_lived)
    monkeypatch.setattr("app.features.facebook.provider.get_managed_pages", pages)
    monkeypatch.setattr(
        "app.features.facebook.service.encrypt_token",
        lambda value: f"encrypted:{value}",
    )

    original = service.access.require_permission
    checks = 0

    def revoke_after_provider(db, principal, requested_business, permission, **kwargs):
        nonlocal checks
        checks += 1
        if checks == 2:
            raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
        return original(db, principal, requested_business, permission, **kwargs)

    monkeypatch.setattr(service.access, "require_permission", revoke_after_provider)
    response = client.get(
        "/auth/facebook/callback",
        params={"state": state, "code": "authorization-code"},
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == (
        "https://studio.test.invalid/#facebook_result=provider_error"
    )
    exchange.assert_awaited_once()
    long_lived.assert_awaited_once()
    pages.assert_awaited_once()
    with Session(engine) as db:
        assert db.get(FacebookOAuthState, hashlib.sha256(state.encode()).hexdigest()) is None
        assert db.query(FacebookOAuthState).count() == 0
        assert db.query(SocialAccount).count() == 0


def test_facebook_callback_returns_to_oauth_initiating_local_origin(
        isolated_client,
        monkeypatch,
):
        client, engine = isolated_client
        business_id = create_business(client)
        monkeypatch.setenv("FRONTEND_BASE_URL", "http://127.0.0.1:5173")
        monkeypatch.setattr(
            "app.features.facebook.provider.get_facebook_login_url",
            lambda state: f"https://facebook.test/authorize?state={state}",
        )
        start = client.get(
            "/auth/facebook/start",
            params={"business_id": business_id},
            headers={"Origin": "http://localhost:5173"},
        )
        state = parse_qs(urlsplit(start.json()["authorization_url"]).query)["state"][0]
        monkeypatch.setattr(
            "app.features.facebook.provider.exchange_code_for_token",
            AsyncMock(return_value="short-token"),
        )
        monkeypatch.setattr(
            "app.features.facebook.provider.get_long_lived_user_token",
            AsyncMock(return_value="long-token"),
        )
        monkeypatch.setattr(
            "app.features.facebook.provider.get_managed_pages",
            AsyncMock(return_value=[{
                "id": "page-id", "name": "Page", "access_token": "page-token",
            }]),
        )
        monkeypatch.setattr(
            "app.features.facebook.service.encrypt_token",
            lambda value: f"encrypted:{value}",
        )

        callback = client.get(
            "/auth/facebook/callback",
            params={"state": state, "code": "authorization-code"},
            follow_redirects=False,
        )

        assert callback.status_code == 303
        assert callback.headers["location"].startswith(
            "http://localhost:5173/#facebook_handoff=",
        )


def test_facebook_start_rejects_untrusted_frontend_origin(
        isolated_client,
        monkeypatch,
):
        client, _ = isolated_client
        business_id = create_business(client)
        monkeypatch.setattr(
            "app.features.facebook.provider.get_facebook_login_url",
            lambda state: f"https://facebook.test/authorize?state={state}",
        )

        response = client.get(
            "/auth/facebook/start",
            params={"business_id": business_id},
            headers={"Origin": "https://attacker.test"},
        )

        assert response.status_code == 400
        assert response.json() == {"detail": "Facebook connection origin is not allowed"}


def test_facebook_handoff_is_user_scoped_and_hides_page_tokens(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_id = create_business(client)
    token = create_pending_selection(
        engine,
        business_id,
        pages=[
            {
                "id": "page-id",
                "name": "Hola Compra Vibes",
                "access_token": "must-not-be-returned",
            },
        ],
    )
    monkeypatch.setattr(
        "app.features.facebook.service.decrypt_token",
        lambda value: value.removeprefix("encrypted:"),
    )

    response = client.post(
        "/auth/facebook/handoff",
        json={"handoff_token": token, "business_id": business_id},
    )

    assert response.status_code == 200
    assert response.json() == {
        "business_id": business_id,
        "pages": [{"id": "page-id", "name": "Hola Compra Vibes"}],
    }
    assert "must-not-be-returned" not in response.text


def test_facebook_handoff_and_selection_reject_wrong_business(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_a = create_business(client)
    business_b = client.post(
        "/businesses",
        json={"name": "Other Facebook business"},
    ).json()["id"]
    token = create_pending_selection(
        engine,
        business_a,
        pages=[{"id": "page-id", "name": "Page", "access_token": "secret"}],
    )
    monkeypatch.setattr(
        "app.features.facebook.service.decrypt_token",
        lambda value: value.removeprefix("encrypted:"),
    )

    handoff = client.post(
        "/auth/facebook/handoff",
        json={"handoff_token": token, "business_id": business_b},
    )
    selection = client.post(
        "/auth/facebook/select-page",
        json={
            "selection_token": token,
            "business_id": business_b,
            "page_id": "page-id",
        },
    )

    assert handoff.status_code == selection.status_code == 403
    assert "secret" not in handoff.text + selection.text
    with Session(engine) as db:
        assert db.query(SocialAccount).count() == 0
        assert db.scalar(
            select(FacebookOAuthState).where(
                FacebookOAuthState.selection_token_hash
                == hashlib.sha256(token.encode()).hexdigest()
            )
        ) is not None


def test_facebook_page_selection_connects_reconnects_and_consumes_token(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_id = create_business(client)
    token = create_pending_selection(
        engine,
        business_id,
        pages=[
            {
                "id": "page-id",
                "name": "Hola Compra Vibes",
                "access_token": "new-page-token",
            },
        ],
    )
    monkeypatch.setattr(
        "app.features.facebook.service.decrypt_token",
        lambda value: value.removeprefix("encrypted:"),
    )
    monkeypatch.setattr(
        "app.features.facebook.service.encrypt_token",
        lambda value: f"encrypted:{value}",
    )
    with Session(engine) as db:
        db.add(
            SocialAccount(
                business_id=business_id,
                platform="facebook",
                platform_account_id="page-id",
                account_name="Old page name",
                encrypted_access_token="encrypted:old-token",
                connection_status="disconnected",
            )
        )
        db.commit()

    response = client.post(
        "/auth/facebook/select-page",
        json={
            "selection_token": token,
            "business_id": business_id,
            "page_id": "page-id",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "connected",
        "business_id": business_id,
        "page_id": "page-id",
        "page_name": "Hola Compra Vibes",
    }
    with Session(engine) as db:
        account = db.scalar(
            select(SocialAccount).where(
                SocialAccount.business_id == business_id,
                SocialAccount.platform == "facebook",
            )
        )
        assert account.account_name == "Hola Compra Vibes"
        assert account.encrypted_access_token == "encrypted:new-page-token"
        assert account.connection_status == "connected"
        assert db.scalar(
            select(FacebookOAuthState).where(
                FacebookOAuthState.selection_token_hash
                == hashlib.sha256(token.encode()).hexdigest()
            )
        ) is None


@pytest.mark.parametrize(
    ("route", "body", "detail"),
    [
        (
            "/auth/facebook/handoff",
            {"handoff_token": "not-valid", "business_id": "business-id"},
            "Invalid or expired Facebook handoff",
        ),
        (
            "/auth/facebook/select-page",
            {
                "selection_token": "not-valid",
                "business_id": "business-id",
                "page_id": "page-id",
            },
            "Invalid or expired Page selection",
        ),
    ],
)
def test_facebook_handoff_and_page_selection_reject_invalid_tokens(
    isolated_client,
    route,
    body,
    detail,
):
    client, _ = isolated_client

    response = client.post(route, json=body)

    assert response.status_code == 400
    assert response.json() == {"detail": detail}


def test_facebook_handoff_rejects_expired_selection(
    isolated_client,
):
    client, engine = isolated_client
    business_id = create_business(client)
    token = create_pending_selection(
        engine,
        business_id,
        pages=[{"id": "page-id", "name": "Page", "access_token": "secret"}],
    )
    with Session(engine) as db:
        pending = db.scalar(
            select(FacebookOAuthState).where(
                FacebookOAuthState.selection_token_hash
                == hashlib.sha256(token.encode()).hexdigest()
            )
        )
        pending.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()

    response = client.post(
        "/auth/facebook/handoff",
        json={"handoff_token": token, "business_id": business_id},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid or expired Facebook handoff"}


def test_facebook_handoff_requires_an_authenticated_session(
    isolated_client,
):
    client, engine = isolated_client
    business_id = create_business(client)
    token = create_pending_selection(engine, business_id)
    del app.dependency_overrides[verify_token]
    del app.dependency_overrides[get_authenticated_principal]

    response = client.post(
        "/auth/facebook/handoff",
        json={"handoff_token": token, "business_id": business_id},
    )

    assert response.status_code == 401


def test_facebook_page_selection_rejects_unavailable_page(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_id = create_business(client)
    token = create_pending_selection(
        engine,
        business_id,
        pages=[{"id": "allowed-page", "name": "Allowed", "access_token": "token"}],
    )
    monkeypatch.setattr(
        "app.features.facebook.service.decrypt_token",
        lambda value: value.removeprefix("encrypted:"),
    )

    response = client.post(
        "/auth/facebook/select-page",
        json={
            "selection_token": token,
            "business_id": business_id,
            "page_id": "other-page",
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Selected Facebook Page is not available",
    }


def test_facebook_accounts_listing_is_business_scoped_and_hides_tokens(
    isolated_client,
):
    client, engine = isolated_client
    business_a = create_business(client)
    business_b = client.post(
        "/businesses",
        json={"name": "Another Facebook business"},
    ).json()["id"]
    with Session(engine) as db:
        db.add_all(
            [
                SocialAccount(
                    business_id=business_a,
                    platform="facebook",
                    platform_account_id="page-a",
                    account_name="Page A",
                    encrypted_access_token="secret-a",
                ),
                SocialAccount(
                    business_id=business_b,
                    platform="facebook",
                    platform_account_id="page-b",
                    account_name="Page B",
                    encrypted_access_token="secret-b",
                ),
            ]
        )
        db.commit()

    response = client.get(
        "/auth/facebook/accounts",
        params={"business_id": business_a},
    )

    assert response.status_code == 200
    assert response.json()["accounts"] == [
        {
            "id": response.json()["accounts"][0]["id"],
            "platform": "facebook",
            "page_id": "page-a",
            "page_name": "Page A",
            "connection_status": "connected",
        },
    ]
    assert "secret-a" not in response.text
    missing = client.get(
        "/auth/facebook/accounts",
        params={"business_id": "missing"},
    )
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Business not found"}


def test_facebook_disconnect_is_business_scoped_and_clears_saved_token(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_a = create_business(client)
    business_b = client.post(
        "/businesses",
        json={"name": "Second Facebook business"},
    ).json()["id"]
    with Session(engine) as db:
        accounts = [
            SocialAccount(
                business_id=business_a,
                platform="facebook",
                platform_account_id="page-a",
                account_name="Page A",
                encrypted_access_token="encrypted:secret-a",
            ),
            SocialAccount(
                business_id=business_b,
                platform="facebook",
                platform_account_id="page-b",
                account_name="Page B",
                encrypted_access_token="encrypted:secret-b",
            ),
        ]
        db.add_all(accounts)
        db.commit()
        account_a_id, account_b_id = (account.id for account in accounts)
    monkeypatch.setattr(
        "app.features.facebook.service.encrypt_token",
        lambda value: f"encrypted:{value}",
    )

    cross_tenant = client.delete(
        f"/auth/facebook/accounts/{account_b_id}",
        params={"business_id": business_a},
    )
    disconnected = client.delete(
        f"/auth/facebook/accounts/{account_a_id}",
        params={"business_id": business_a},
    )

    assert cross_tenant.status_code == 404
    assert disconnected.status_code == 200
    assert disconnected.json() == {"status": "disconnected"}
    with Session(engine) as db:
        account = db.get(SocialAccount, account_a_id)
        assert account.connection_status == "disconnected"
        assert account.encrypted_access_token == "encrypted:"
