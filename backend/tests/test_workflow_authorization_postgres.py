"""Revocation/demotion during real workflow row-lock waits, in disposable PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access.principal import Principal
from app.features.access.service import resolve_principal
from app.features.campaigns import repository as campaign_repository, service as campaigns
from app.features.drafts import repository as draft_repository, service as drafts
from tests.test_tenant_foundation_postgres import postgres_database
from tests.test_tenant_repositories import ISSUER, seed_tenants


@pytest.mark.parametrize("operation,change,expected", [
    ("approve", "status='revoked'", ErrorKind.NOT_FOUND),
    ("approve", "role='member'", ErrorKind.FORBIDDEN),
    ("delete_campaign", "status='revoked'", ErrorKind.NOT_FOUND),
    ("associate", "status='revoked'", ErrorKind.NOT_FOUND),
])
def test_workflow_reauthorizes_after_lock_wait(postgres_database, monkeypatch, operation, change, expected):
    engine, migrate = postgres_database
    migrate("head")
    seed_tenants(engine)
    if operation == "delete_campaign":
        with engine.begin() as connection:
            connection.execute(text("UPDATE drafts SET campaign_id='a-campaign' WHERE id='a-pending'"))
    waiting = Event()
    if operation == "approve":
        module, name = draft_repository, "lock_draft_scoped"
    elif operation == "delete_campaign":
        module, name = campaign_repository, "lock_campaign_drafts_scoped"
    else:
        module, name = campaign_repository, "lock_association_draft_scoped"
    original = getattr(module, name)

    def signal(db, *args, **kwargs):
        waiting.set()
        return original(db, *args, **kwargs)
    monkeypatch.setattr(module, name, signal)

    def invoke():
        with Session(engine) as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            principal = resolve_principal(db, Principal(ISSUER, "a"))
            try:
                if operation == "approve":
                    drafts.approve_draft("a-pending", db, principal=principal)
                elif operation == "delete_campaign":
                    campaigns.delete_campaign("a", "a-campaign", db, principal=principal)
                else:
                    campaigns.change_association(db, "a", "a-campaign", "a-pending", True, principal=principal)
            except ApplicationError as exc:
                assert not db.in_transaction(), "Failed workflows must release locks and pending writes"
                return exc.kind
            return None

    with ThreadPoolExecutor(max_workers=1) as executor:
        with engine.begin() as connection:
            connection.execute(text("SELECT id FROM drafts WHERE id='a-pending' FOR UPDATE"))
            future = executor.submit(invoke)
            assert waiting.wait(timeout=10)
            assert not future.done()
            # Emulates a committed membership change while workflow waits on draft.
            connection.execute(text(f"UPDATE business_memberships SET {change} WHERE id='a'"))
        assert future.result(timeout=10) == expected
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT status FROM drafts WHERE id='a-pending'")) == "pending"
        assert connection.scalar(text("SELECT count(*) FROM campaigns WHERE id='a-campaign'")) == 1
        campaign_id = connection.scalar(text("SELECT campaign_id FROM drafts WHERE id='a-pending'"))
        assert campaign_id == ("a-campaign" if operation == "delete_campaign" else None)
