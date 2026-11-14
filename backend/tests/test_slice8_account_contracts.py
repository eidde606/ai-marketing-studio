"""Offline Phase 1 account, capability, language and tenant contracts."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import Mock
import json

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.auth import SUPABASE_ISSUER, ALLOWED_USER_ID
from app.features.access.principal import Principal
from app.features.accounts import service as accounts
from app.features.content import openai_provider, sofia_provider
from app.models import Business, BusinessMembership, User, UserPreferences, BusinessPreferences, Draft
from tests.test_authentication_integration import auth_client, signed_token, signing_keys, headers, add_user
from tests.test_tenant_foundation_postgres import postgres_database
from tests.tenancy_fixtures import grant_test_owner
from tests.test_ai_destinations import generated_content


def seed(engine):
    with Session(engine) as db:
        db.add_all([Business(id="a", name="A"), Business(id="b", name="Private B")])
        db.flush()
        actor = grant_test_owner(db, ["a"])
        other = grant_test_owner(db, ["b"], subject="other")
        db.commit()
        return actor, other


def test_registration_is_explicit_idempotent_and_never_claims_legacy_businesses(auth_client, signed_token):
    client, engine = auth_client
    with Session(engine) as db:
        db.add(Business(id="legacy", name="Existing business"))
        db.commit()
    token = headers(signed_token())
    assert client.get("/account", headers=token).status_code == 403
    first = client.post("/account/register", json={}, headers=token)
    assert first.status_code == 200
    assert first.json()["businesses"] == []
    assert first.json()["preferences"] == {"interface_language": "en", "conversation_language": "en"}
    assert first.json()["features"]["public_registration"] is False
    assert client.post("/account/register", json={}, headers=token).json() == first.json()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(User)) == 1
        assert db.scalar(select(func.count()).select_from(BusinessMembership)) == 0
        assert db.get(Business, "legacy").name == "Existing business"


@pytest.mark.parametrize("claims", [{"sub": "unapproved"}, {"is_anonymous": True}])
def test_registration_retains_allowlist_and_denies_anonymous(auth_client, signed_token, claims):
    client, engine = auth_client
    assert client.post("/account/register", json={}, headers=headers(signed_token(changes=claims))).status_code == 403
    with Session(engine) as db:
        assert db.scalar(select(User.id)) is None


def test_enabled_registration_gate_requires_verified_email(auth_client, signed_token, monkeypatch):
    client, engine = auth_client
    from app.features.entitlements import service as entitlement_service

    monkeypatch.setattr(entitlement_service, "public_registration_enabled", lambda: True)
    unverified = client.post(
        "/account/register",
        json={},
        headers=headers(signed_token(changes={"email_verified": False})),
    )
    assert unverified.status_code == 403
    with Session(engine) as db:
        assert db.scalar(select(User.id)) is None

    verified = client.post(
        "/account/register",
        json={},
        headers=headers(signed_token(changes={"email_verified": True})),
    )
    assert verified.status_code == 200


def test_registration_cannot_reactivate_disabled_user_or_accept_ownership(auth_client, signed_token):
    client, engine = auth_client
    add_user(engine, status="disabled")
    token = headers(signed_token())
    assert client.post("/account/register", json={}, headers=token).status_code == 403
    assert client.post("/account/register", json={"role": "owner", "business_id": "a"}, headers=token).status_code == 422
    assert client.post("/account/register", json={}).status_code == 401
    with Session(engine) as db:
        assert db.get(User, "application-user").status == "disabled"


def test_capabilities_are_fresh_and_scoped_to_current_user(isolated_client):
    client, engine = isolated_client
    actor, _ = seed(engine)
    response = client.get("/account").json()
    assert [b["id"] for b in response["businesses"]] == ["a"]
    assert "publish" in response["businesses"][0]["capabilities"]
    assert response["features"]["mia_analysis"] is False
    assert response["features"]["instagram_publishing"] is False
    with Session(engine) as db:
        membership = db.scalar(select(BusinessMembership).where(BusinessMembership.user_id == actor.user_id))
        membership.role = "member"
        db.commit()
    assert "publish" not in client.get("/account").json()["businesses"][0]["capabilities"]
    with Session(engine) as db:
        db.scalar(select(BusinessMembership).where(BusinessMembership.user_id == actor.user_id)).status = "revoked"
        db.commit()
    assert client.get("/account").json()["businesses"] == []


def test_independent_preferences_are_authorized_persisted_and_do_not_change_content(isolated_client):
    client, engine = isolated_client
    actor, other = seed(engine)
    with Session(engine) as db:
        db.add(Draft(id="legacy", business_id="a", title="Hola", caption="Original", platform="Facebook"))
        db.commit()
    assert client.patch("/account/preferences", json={"interface_language": "es"}).json() == {
        "interface_language": "es", "conversation_language": "en",
    }
    assert client.patch("/businesses/a/preferences", json={"marketing_content_language": "es"}).status_code == 200
    assert client.get("/businesses/a/preferences").json() == {"marketing_content_language": "es"}
    assert client.get("/businesses/b/preferences").status_code == 404
    assert client.patch("/businesses/b/preferences", json={"marketing_content_language": "en"}).status_code == 404
    for payload in ({}, {"interface_language": None}, {"interface_language": "fr"}, {"user_id": other.user_id}):
        assert client.patch("/account/preferences", json=payload).status_code in (400, 422)
    with Session(engine) as db:
        assert db.get(UserPreferences, actor.user_id).conversation_language == "en"
        assert db.get(UserPreferences, other.user_id) is None
        assert db.get(BusinessPreferences, "b") is None
        assert db.get(Draft, "legacy").caption == "Original"
        assert db.get(Draft, "legacy").marketing_content_language is None
        db.scalar(select(BusinessMembership).where(BusinessMembership.user_id == actor.user_id)).role = "member"
        db.commit()
    assert client.patch("/businesses/a/preferences", json={"marketing_content_language": "en"}).status_code == 403


def test_membership_routes_preserve_last_owner_and_do_not_accept_foreign_targets(isolated_client):
    client, engine = isolated_client
    actor, other = seed(engine)
    own = client.get("/businesses/a/memberships").json()[0]
    assert client.patch(f'/businesses/a/memberships/{own["id"]}', json={"role": "member", "status": "active"}).status_code == 409
    assert client.get("/businesses/b/memberships").status_code == 404
    with Session(engine) as db:
        foreign = db.scalar(select(BusinessMembership).where(BusinessMembership.user_id == other.user_id)).id
        db.add(BusinessMembership(id="member", business_id="a", user_id=other.user_id, role="member"))
        db.commit()
    assert client.patch(f"/businesses/a/memberships/{foreign}", json={"role": "member", "status": "revoked"}).status_code == 404
    assert client.patch("/businesses/a/memberships/member", json={"role": "member", "status": "suspended"}).status_code == 204
    with Session(engine) as db:
        assert db.get(BusinessMembership, foreign).status == "active"
        db.scalar(select(BusinessMembership).where(BusinessMembership.user_id == actor.user_id)).role = "admin"
        db.commit()
    assert client.patch("/businesses/a/memberships/member", json={"role": "owner", "status": "active"}).status_code == 403


@pytest.mark.parametrize("interface", ["en", "es"])
@pytest.mark.parametrize("conversation", ["en", "es"])
@pytest.mark.parametrize("content", ["en", "es"])
def test_all_language_combinations_reach_separate_provider_prompts(isolated_client, monkeypatch, interface, conversation, content):
    client, engine = isolated_client
    seed(engine)
    assert client.patch("/account/preferences", json={"interface_language": interface, "conversation_language": conversation}).status_code == 200
    assert client.patch("/businesses/a/preferences", json={"marketing_content_language": content}).status_code == 200
    provider = Mock(side_effect=[SimpleNamespace(output_text="Strategy"), SimpleNamespace(output_text=json.dumps(generated_content("TikTok")))])
    monkeypatch.setattr(openai_provider.client.responses, "create", provider)
    response = client.post("/businesses/a/generate-content")
    assert response.status_code == 201
    assert response.json()["marketing_content_language"] == content
    assert response.json()["publish_destinations"] == ["tiktok"]
    assert response.json()["campaign_id"] is None
    assert response.json()["status"] == "pending"
    name = {"en": "English", "es": "Spanish"}
    assert f"Respond only in {name[conversation]}" in provider.call_args_list[0].kwargs["instructions"]
    assert f"Write all marketing text in {name[content]}" in provider.call_args_list[1].kwargs["instructions"]
    assert "en español" not in provider.call_args_list[1].kwargs["instructions"]


def test_chat_language_snapshot_and_explicit_output_override(isolated_client, monkeypatch):
    client, engine = isolated_client
    seed(engine)
    reply = Mock(return_value=SimpleNamespace(output_text="Hola"))
    monkeypatch.setattr(sofia_provider.client.responses, "create", reply)
    created = client.post("/businesses/a/sofia/chat", json={"message": "Hello", "conversation_language": "es"})
    assert created.status_code == 200
    conversation_id = created.json()["conversation_id"]
    assert "professionally in Spanish" in reply.call_args.kwargs["instructions"]
    client.post("/businesses/a/sofia/chat", json={"message": "Continue", "conversation_id": conversation_id})
    assert "professionally in Spanish" in reply.call_args.kwargs["instructions"]
    provider = Mock(side_effect=[SimpleNamespace(output_text="Strategy"), SimpleNamespace(output_text=json.dumps(generated_content("Instagram")))])
    monkeypatch.setattr(openai_provider.client.responses, "create", provider)
    response = client.post(f"/businesses/a/sofia/conversations/{conversation_id}/generate-draft", json={"marketing_content_language": "en"})
    assert response.status_code == 200
    assert response.json()["publish_destinations"] == []
    assert "Respond only in Spanish" in provider.call_args_list[0].kwargs["instructions"]
    assert "Write all marketing text in English" in provider.call_args_list[1].kwargs["instructions"]


def test_concurrent_registration_and_additive_migration(postgres_database):
    engine, migrate = postgres_database
    migrate("8d4c2b17a690")
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO businesses (id, name, created_at) "
            "VALUES ('legacy', 'Keep me', now())"
        ))
        connection.execute(text("INSERT INTO app_users (id, auth_issuer, auth_subject) VALUES ('legacy', 'issuer', 'subject')"))
        connection.execute(text("INSERT INTO business_memberships (id,business_id,user_id,role) VALUES ('legacy','legacy','legacy','owner')"))
        connection.execute(text(
            "INSERT INTO campaigns (id, business_id, name, objective, created_at, updated_at) "
            "VALUES ('legacy-campaign', 'legacy', 'Keep campaign', 'Keep objective', now(), now())"
        ))
        connection.execute(text(
            "INSERT INTO drafts (id, business_id, title, caption, platform, status, created_at, source) "
            "VALUES ('legacy-draft', 'legacy', 'Keep draft', 'Keep caption', 'facebook', 'pending', now(), 'manual')"
        ))
        connection.execute(text(
            "INSERT INTO social_accounts "
            "(id, business_id, platform, platform_account_id, account_name, encrypted_access_token, created_at) "
            "VALUES ('legacy-social', 'legacy', 'facebook', 'legacy-page', 'Keep page', 'ciphertext', now())"
        ))
        connection.execute(text(
            "INSERT INTO conversations (id, business_id, created_at) VALUES ('legacy-conversation', 'legacy', now())"
        ))
        connection.execute(text(
            "INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) "
            "VALUES ('legacy-message', 'legacy-conversation', 'user', 'Keep message', now())"
        ))
    migrate("head")
    preserved_tables = (
        "businesses", "business_memberships", "campaigns", "drafts",
        "social_accounts", "conversations", "conversation_messages",
    )
    with engine.connect() as connection:
        assert {
            table: connection.scalar(text(f"SELECT count(*) FROM {table}"))
            for table in preserved_tables
        } == {table: 1 for table in preserved_tables}
        assert connection.scalar(text("SELECT name FROM businesses WHERE id='legacy'")) == "Keep me"
        assert connection.scalar(text(
            "SELECT customer_organization_id FROM businesses WHERE id='legacy'"
        )) is None
        assert connection.scalar(text("SELECT name FROM campaigns WHERE id='legacy-campaign'")) == "Keep campaign"
        assert connection.scalar(text("SELECT caption FROM drafts WHERE id='legacy-draft'")) == "Keep caption"
        assert connection.scalar(text(
            "SELECT marketing_content_language FROM drafts WHERE id='legacy-draft'"
        )) is None
        assert connection.scalar(text(
            "SELECT account_name FROM social_accounts WHERE id='legacy-social'"
        )) == "Keep page"
        assert connection.scalar(text(
            "SELECT content FROM conversation_messages WHERE id='legacy-message'"
        )) == "Keep message"
        assert connection.scalar(text("SELECT language FROM conversations WHERE id='legacy-conversation'")) is None
        assert connection.scalar(text("SELECT count(*) FROM user_preferences")) == 0
        assert connection.scalar(text("SELECT count(*) FROM business_preferences")) == 0
        assert connection.scalar(text("SELECT count(*) FROM customer_organizations")) == 0
        assert connection.scalar(text("SELECT count(*) FROM customer_entitlements")) == 0
        assert connection.scalar(text("SELECT count(*) FROM ai_usage_reservations")) == 0
        assert connection.scalar(text("SELECT count(*) FROM onboarding_progress")) == 0
    barrier = Barrier(2)
    def register(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            return accounts.register(db, Principal(SUPABASE_ISSUER, ALLOWED_USER_ID))["user_id"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        ids = list(executor.map(register, range(2)))
    assert ids[0] == ids[1]
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(User)) == 2
        assert db.scalar(select(func.count()).select_from(BusinessMembership)) == 1
        assert db.get(BusinessMembership, "legacy").role == "owner"
        assert db.get(Business, "legacy").name == "Keep me"
    migrate("8d4c2b17a690", "downgrade")
    migrate("head")
    with Session(engine) as db:
        assert db.get(BusinessMembership, "legacy").role == "owner"
        assert db.get(Draft, "legacy-draft").caption == "Keep caption"
