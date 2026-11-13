import hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import verify_token
from app.database import get_db
from app.main import app
from app.models import Business, SocialAccount, TikTokOAuthState


def create_oauth_state(engine, business_id: str, state: str = "oauth-state"):
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    with Session(engine) as db:
        db.add(
            TikTokOAuthState(
                state_hash=state_hash,
                business_id=business_id,
                user_id="test-authorized-user",
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            )
        )
        db.commit()
    return state


def create_business(client) -> str:
    response = client.post("/businesses", json={"name": "TikTok business"})
    assert response.status_code == 201
    return response.json()["id"]


def test_tiktok_oauth_start_persists_hashed_state(isolated_client, monkeypatch):
    client, engine = isolated_client
    business_id = create_business(client)
    monkeypatch.setattr(
        "app.features.tiktok.provider.get_tiktok_login_url",
        lambda state: f"https://tiktok.test/authorize?state={state}",
    )

    response = client.get(
        "/api/integrations/tiktok/start",
        params={"business_id": business_id},
    )

    assert response.status_code == 200
    authorization_url = response.json()["authorization_url"]
    state = parse_qs(urlparse(authorization_url).query)["state"][0]
    with Session(engine) as db:
        saved = db.get(
            TikTokOAuthState,
            hashlib.sha256(state.encode()).hexdigest(),
        )
        assert saved.business_id == business_id
        assert saved.user_id == "test-authorized-user"
        assert saved.expires_at.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc)


def test_tiktok_oauth_start_requires_business_and_authentication(isolated_client):
    client, _ = isolated_client

    missing = client.get(
        "/api/integrations/tiktok/start",
        params={"business_id": "missing"},
    )
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Business not found"}

    del app.dependency_overrides[verify_token]
    unauthorized = client.get(
        "/api/integrations/tiktok/start",
        params={"business_id": "missing"},
    )
    assert unauthorized.status_code == 401


def test_tiktok_callback_rejects_invalid_or_replayed_state(isolated_client):
    client, engine = isolated_client
    business_id = create_business(client)
    state = create_oauth_state(engine, business_id)

    first = client.get(
        "/api/integrations/tiktok/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )
    assert first.status_code == 400
    assert first.json() == {"detail": "TikTok authorization was not completed"}

    replay = client.get(
        "/api/integrations/tiktok/callback",
        params={"state": state, "code": "authorization-code"},
        follow_redirects=False,
    )
    assert replay.status_code == 400
    assert replay.json() == {
        "detail": "Invalid, expired, or previously used TikTok authorization",
    }


@pytest.mark.parametrize("existing", [False, True])
def test_tiktok_callback_connects_or_reconnects_account(
    isolated_client,
    monkeypatch,
    existing,
):
    client, engine = isolated_client
    business_id = create_business(client)
    state = create_oauth_state(engine, business_id)
    if existing:
        with Session(engine) as db:
            db.add(
                SocialAccount(
                    business_id=business_id,
                    platform="tiktok",
                    platform_account_id="open-id",
                    account_name="Old name",
                    encrypted_access_token="old-access",
                    encrypted_refresh_token="old-refresh",
                    connection_status="disconnected",
                )
            )
            db.commit()

    exchange = AsyncMock(return_value={
        "access_token": "new-access",
        "refresh_token": "new-refresh",
        "expires_in": 3600,
    })
    profile = AsyncMock(return_value={
        "open_id": "open-id",
        "display_name": "Hola Compra Vibes",
    })
    monkeypatch.setattr(
        "app.features.tiktok.provider.exchange_code_for_token",
        exchange,
    )
    monkeypatch.setattr(
        "app.features.tiktok.provider.get_tiktok_user",
        profile,
    )
    monkeypatch.setattr(
        "app.features.tiktok.service.encrypt_token",
        lambda token: f"encrypted:{token}",
    )
    monkeypatch.setenv(
        "TIKTOK_FRONTEND_REDIRECT_URL",
        "https://studio.test.invalid",
    )

    response = client.get(
        "/api/integrations/tiktok/callback",
        params={"state": state, "code": "authorization-code"},
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == (
        "https://studio.test.invalid/#tiktok_connected=1"
    )
    exchange.assert_awaited_once_with("authorization-code")
    profile.assert_awaited_once_with("new-access")
    with Session(engine) as db:
        accounts = db.scalars(
            select(SocialAccount).where(
                SocialAccount.business_id == business_id,
                SocialAccount.platform == "tiktok",
            )
        ).all()
        assert len(accounts) == 1
        account = accounts[0]
        assert account.platform_account_id == "open-id"
        assert account.account_name == "Hola Compra Vibes"
        assert account.encrypted_access_token == "encrypted:new-access"
        assert account.encrypted_refresh_token == "encrypted:new-refresh"
        assert account.connection_status == "connected"
        assert account.token_expires_at is not None
        assert db.get(TikTokOAuthState, hashlib.sha256(state.encode()).hexdigest()) is None


def test_tiktok_callback_maps_provider_failure_and_consumes_state(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    business_id = create_business(client)
    state = create_oauth_state(engine, business_id)
    exchange = AsyncMock(side_effect=httpx.ConnectError("provider unavailable"))
    monkeypatch.setattr(
        "app.features.tiktok.provider.exchange_code_for_token",
        exchange,
    )

    response = client.get(
        "/api/integrations/tiktok/callback",
        params={"state": state, "code": "authorization-code"},
        follow_redirects=False,
    )

    assert response.status_code == 502
    assert response.json() == {"detail": "Unable to connect the TikTok account"}
    exchange.assert_awaited_once_with("authorization-code")
    with Session(engine) as db:
        assert db.get(
            TikTokOAuthState,
            hashlib.sha256(state.encode()).hexdigest(),
        ) is None
        assert db.scalars(select(SocialAccount)).all() == []


def test_tiktok_account_listing_is_business_scoped_and_hides_tokens(
    isolated_client,
):
    client, engine = isolated_client
    business_a = create_business(client)
    business_b = client.post(
        "/businesses",
        json={"name": "Other TikTok business"},
    ).json()["id"]
    with Session(engine) as db:
        db.add_all([
            SocialAccount(
                business_id=business_a,
                platform="tiktok",
                platform_account_id="account-a",
                account_name="Account A",
                encrypted_access_token="secret-a",
                encrypted_refresh_token="refresh-a",
            ),
            SocialAccount(
                business_id=business_b,
                platform="tiktok",
                platform_account_id="account-b",
                account_name="Account B",
                encrypted_access_token="secret-b",
                encrypted_refresh_token="refresh-b",
            ),
        ])
        db.commit()

    response = client.get(
        "/api/integrations/tiktok/accounts",
        params={"business_id": business_a},
    )
    assert response.status_code == 200
    assert len(response.json()["accounts"]) == 1
    assert response.json()["accounts"][0]["account_name"] == "Account A"
    assert set(response.json()["accounts"][0]) == {
        "id",
        "account_name",
        "connection_status",
    }

    missing = client.get(
        "/api/integrations/tiktok/accounts",
        params={"business_id": "missing"},
    )
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Business not found"}


def test_tiktok_account_listing_requires_authentication(isolated_client):
    client, _ = isolated_client
    del app.dependency_overrides[verify_token]

    response = client.get(
        "/api/integrations/tiktok/accounts",
        params={"business_id": "missing"},
    )
    assert response.status_code == 401
