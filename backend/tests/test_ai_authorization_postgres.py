"""Real independent transactions: revoke during generation and authorization lock waits."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access.principal import Principal
from app.features.access.service import resolve_principal
from app.features.access import repository as access_repository
from app.features.content import service, adapters, generation_service
from app.features.content.schemas import SofiaChatRequest
from tests.test_tenant_foundation_postgres import postgres_database
from tests.test_tenant_repositories import ISSUER, seed_tenants
from tests.test_ai_destinations import generated_content


@pytest.mark.parametrize("workflow", ["new_chat", "existing_chat", "automatic", "conversation"])
def test_revocation_commits_while_provider_waits(postgres_database, monkeypatch, workflow):
    engine, migrate = postgres_database
    migrate("head")
    seed_tenants(engine)
    started, release = Event(), Event()
    def provider(*args, **kwargs):
        started.set()
        assert release.wait(10)
        return "reply" if "chat" in workflow else generated_content("facebook")
    monkeypatch.setattr(adapters, "chat_with_sofia", provider)
    monkeypatch.setattr(generation_service, "generate_marketing_content", provider)
    def invoke():
        with Session(engine) as db:
            principal = resolve_principal(db, Principal(ISSUER, "a"))
            try:
                if "chat" in workflow:
                    service.sofia_chat("a", SofiaChatRequest(message="new",
                        conversation_id="a-conversation" if workflow == "existing_chat" else None), db=db, principal=principal)
                elif workflow == "automatic":
                    service.generate_content("a", db=db, principal=principal)
                else:
                    service.generate_sofia_conversation_draft("a", "a-conversation", db=db, principal=principal)
            except ApplicationError as exc:
                assert not db.in_transaction()
                return exc.kind
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(invoke)
        try:
            assert started.wait(10)
            with engine.begin() as connection:
                connection.execute(text("SET LOCAL lock_timeout='2s'"))
                connection.execute(text("UPDATE business_memberships SET status='revoked' WHERE id='a'"))
        finally:
            release.set()
        assert future.result(10) == ErrorKind.NOT_FOUND
    with engine.connect() as connection:
        for table, count in [("drafts", 4), ("conversations", 2), ("conversation_messages", 6)]:
            assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == count


@pytest.mark.parametrize("change", ["membership", "user"])
def test_authorization_rechecks_after_lock_wait(postgres_database, monkeypatch, change):
    engine, migrate = postgres_database
    migrate("head")
    seed_tenants(engine)
    waiting = Event()
    original = access_repository.lock_business_for_authorization
    def signal(*args, **kwargs):
        waiting.set()
        return original(*args, **kwargs)
    monkeypatch.setattr(access_repository, "lock_business_for_authorization", signal)
    monkeypatch.setattr(generation_service, "generate_marketing_content", lambda *a, **k: generated_content("facebook"))
    def invoke():
        with Session(engine) as db:
            principal = resolve_principal(db, Principal(ISSUER, "a"))
            try:
                service.generate_content("a", db=db, principal=principal)
            except ApplicationError as exc:
                assert not db.in_transaction()
                return exc.kind
    with ThreadPoolExecutor(max_workers=1) as executor:
        with engine.begin() as connection:
            connection.execute(text("SELECT id FROM businesses WHERE id='a' FOR UPDATE"))
            future = executor.submit(invoke)
            assert waiting.wait(10)
            assert not future.done()
            sql = ("UPDATE business_memberships SET status='revoked' WHERE id='a'" if change == "membership"
                   else "UPDATE app_users SET status='disabled' WHERE id='a'")
            connection.execute(text(sql))
        assert future.result(10) == ErrorKind.NOT_FOUND
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM drafts")) == 4
