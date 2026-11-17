import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.tiktok.service import get_valid_access_token
from app.models import Business, BusinessMembership, SocialAccount
from tests.tenancy_fixtures import grant_test_owner


def create_account(engine, business_id: str, **overrides) -> str:
    values = {
        "business_id": business_id,
        "platform": "tiktok",
        "platform_account_id": "tiktok-account",
        "account_name": "TikTok account",
        "encrypted_access_token": "encrypted:old-access",
        "encrypted_refresh_token": "encrypted:old-refresh",
        "token_expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "connection_status": "connected",
    }
    values.update(overrides)
    with Session(engine) as db:
        account = SocialAccount(**values)
        db.add(account)
        db.commit()
        return account.id


def load_account(engine, account_id: str) -> SocialAccount:
    with Session(engine) as db:
        return db.scalar(
            select(SocialAccount).where(SocialAccount.id == account_id)
        )


def test_tiktok_valid_access_token_is_decrypted_without_refresh(
    isolated_client,
    monkeypatch,
):
    _, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="TikTok refresh business")
        db.add(business)
        db.flush()
        principal = grant_test_owner(db, [business.id])
        account = SocialAccount(
            business_id=business.id,
            platform="tiktok",
            platform_account_id="account",
            account_name="Account",
            encrypted_access_token="encrypted:valid",
            encrypted_refresh_token="encrypted:refresh",
            token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        )
        db.add(account)
        db.commit()
        monkeypatch.setattr(
            "app.features.tiktok.service.decrypt_token",
            lambda token: token.removeprefix("encrypted:"),
        )
        refresh = AsyncMock()
        monkeypatch.setattr(
            "app.features.tiktok.provider.refresh_tiktok_token",
            refresh,
        )

        token = asyncio.run(get_valid_access_token(
            account.id, business_id=business.id, principal=principal, db=db,
        ))

    assert token == "valid"
    refresh.assert_not_awaited()


def test_tiktok_member_cannot_refresh_account_credentials(isolated_client, monkeypatch):
    _, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="TikTok refresh business")
        db.add(business)
        db.flush()
        principal = grant_test_owner(db, [business.id])
        account = SocialAccount(
            business_id=business.id,
            platform="tiktok",
            platform_account_id="account",
            account_name="Account",
            encrypted_access_token="encrypted:expired",
            encrypted_refresh_token="encrypted:refresh",
            token_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        db.add(account)
        db.flush()
        db.query(BusinessMembership).filter_by(
            business_id=business.id,
        ).one().role = "member"
        db.commit()
        refresh = AsyncMock()
        monkeypatch.setattr(
            "app.features.tiktok.provider.refresh_tiktok_token",
            refresh,
        )

        with pytest.raises(ApplicationError) as raised:
            asyncio.run(get_valid_access_token(
                account.id, business_id=business.id, principal=principal, db=db,
            ))

    assert raised.value.kind is ErrorKind.FORBIDDEN
    refresh.assert_not_awaited()


def test_tiktok_expiring_token_refreshes_and_persists_rotated_credentials(
    isolated_client,
    monkeypatch,
):
    _, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="TikTok refresh business")
        db.add(business)
        db.flush()
        grant_test_owner(db, [business.id])
        business_id = business.id
        db.commit()
    account_id = create_account(
        engine,
        business_id,
        token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=4),
    )
    with Session(engine) as db:
        account = db.get(SocialAccount, account_id)
        principal = grant_test_owner(db, [business_id])
        monkeypatch.setattr(
            "app.features.tiktok.service.decrypt_token",
            lambda token: token.removeprefix("encrypted:"),
        )
        monkeypatch.setattr(
            "app.features.tiktok.service.encrypt_token",
            lambda token: f"encrypted:{token}",
        )
        refresh = AsyncMock(return_value={
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "expires_in": 3600,
        })
        monkeypatch.setattr(
            "app.features.tiktok.provider.refresh_tiktok_token",
            refresh,
        )

        token = asyncio.run(get_valid_access_token(
            account_id, business_id=business_id, principal=principal, db=db,
        ))

    assert token == "new-access"
    refresh.assert_awaited_once_with("old-refresh")
    saved = load_account(engine, account_id)
    assert saved.encrypted_access_token == "encrypted:new-access"
    assert saved.encrypted_refresh_token == "encrypted:new-refresh"
    expiry = saved.token_expires_at.replace(tzinfo=timezone.utc)
    assert expiry > datetime.now(timezone.utc)


def test_tiktok_expired_token_without_refresh_requires_reconnection(
    isolated_client,
    monkeypatch,
):
    _, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="TikTok refresh business")
        db.add(business)
        db.flush()
        principal = grant_test_owner(db, [business.id])
        account = SocialAccount(
            business_id=business.id,
            platform="tiktok",
            platform_account_id="account",
            account_name="Account",
            encrypted_access_token="encrypted:expired",
            encrypted_refresh_token=None,
            token_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        db.add(account)
        db.commit()
        refresh = AsyncMock()
        monkeypatch.setattr(
            "app.features.tiktok.provider.refresh_tiktok_token",
            refresh,
        )

        with pytest.raises(ApplicationError) as raised:
            asyncio.run(get_valid_access_token(
                account.id, business_id=business.id, principal=principal, db=db,
            ))

    assert raised.value.kind is ErrorKind.CONFLICT
    assert raised.value.detail == "Reconnect your TikTok account"
    refresh.assert_not_awaited()


@pytest.mark.parametrize(
    "failure",
    [
        httpx.ConnectError("unavailable"),
        ValueError("invalid response"),
        KeyError("access_token"),
    ],
)
def test_tiktok_refresh_failures_require_reconnection_without_saving_tokens(
    isolated_client,
    monkeypatch,
    failure,
):
    _, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="TikTok refresh business")
        db.add(business)
        db.flush()
        principal = grant_test_owner(db, [business.id])
        account = SocialAccount(
            business_id=business.id,
            platform="tiktok",
            platform_account_id="account",
            account_name="Account",
            encrypted_access_token="encrypted:expired",
            encrypted_refresh_token="encrypted:refresh",
            token_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        db.add(account)
        db.commit()
        monkeypatch.setattr(
            "app.features.tiktok.service.decrypt_token",
            lambda token: token.removeprefix("encrypted:"),
        )
        refresh = AsyncMock(side_effect=failure)
        monkeypatch.setattr(
            "app.features.tiktok.provider.refresh_tiktok_token",
            refresh,
        )

        with pytest.raises(ApplicationError) as raised:
            asyncio.run(get_valid_access_token(
                account.id, business_id=business.id, principal=principal, db=db,
            ))

        db.refresh(account)
        assert account.encrypted_access_token == "encrypted:expired"
        assert account.encrypted_refresh_token == "encrypted:refresh"

    assert raised.value.kind is ErrorKind.CONFLICT
    assert raised.value.detail == (
        "TikTok authorization expired. Reconnect TikTok."
    )
    refresh.assert_awaited_once_with("refresh")
