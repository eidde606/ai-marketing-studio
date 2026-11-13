"""Actual PostgreSQL scoping/locking tests on a disposable migrated cluster."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.features.campaigns import repository as campaigns
from app.features.drafts import repository as drafts
from app.features.facebook import repository as facebook
from app.features.media import repository as media
from app.features.tiktok import repository as tiktok
from tests.test_tenant_foundation_postgres import postgres_database
from tests.test_tenant_repositories import NOW, context, seed_tenants
from tests.test_tenant_repositories import test_inserts_enforce_tenant_and_parent_ownership as verify_inserts
from tests.test_tenant_repositories import test_messages_and_pagination as verify_messages
from tests.test_tenant_repositories import test_scoped_provider_and_media_inserts as verify_provider_inserts


def test_scoped_insert_and_child_queries_on_postgres(postgres_database):
    engine, migrate = postgres_database
    migrate("head")
    seed_tenants(engine)
    with Session(engine) as db:
        scope = context(db)
        verify_inserts((db, scope))
        # The insert test creates a second conversation/campaign: use an isolated
        # transaction for the shared message assertions' original fixture counts.
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM conversations WHERE id NOT IN ('a-conversation','b-conversation')"))
            connection.execute(text("DELETE FROM campaigns WHERE id NOT IN ('a-campaign','b-campaign')"))
        verify_messages((db, scope))
        verify_provider_inserts((db, scope))


def test_wrong_tenant_never_waits_for_foreign_row_or_advisory_lock(postgres_database):
    engine, migrate = postgres_database
    migrate("head")
    seed_tenants(engine)

    def wrong_tenant():
        with Session(engine) as db:
            db.execute(text("SET LOCAL lock_timeout = '300ms'"))
            scope = context(db)
            assert drafts.lock_draft_scoped(db, scope, "b-pending") is None
            assert drafts.soft_delete_if_idle_scoped(db, scope, "b-pending", NOW) is None
            assert not facebook.claim_publication_scoped(db, scope, "b-approved")
            assert not tiktok.claim_publication_scoped(db, scope, "b-approved", "a-tiktok")
            assert not campaigns.change_association_scoped(db, scope, "a-campaign", "b-pending", attach=True)
            assert media.lock_attempt_scoped(db, scope, "b-attempt") == (None, None)
            assert not media.lock_draft_revisions_scoped(db, scope, "b-pending")
            db.commit()

    with ThreadPoolExecutor(max_workers=1) as executor:
        with engine.begin() as connection:
            connection.execute(text("SELECT id FROM drafts WHERE business_id='b' FOR UPDATE"))
            connection.execute(text("SELECT id FROM heygen_generation_attempts WHERE business_id='b' FOR UPDATE"))
            connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('b-pending'))"))
            executor.submit(wrong_tenant).result(timeout=10)


def test_concurrent_publication_claim_is_atomic_and_tenant_scoped(postgres_database):
    engine, migrate = postgres_database
    migrate("head")
    seed_tenants(engine)
    barrier = Barrier(2)

    def claim():
        with Session(engine) as db:
            db.execute(text("SET LOCAL lock_timeout = '3s'"))
            scope = context(db)
            barrier.wait(timeout=10)
            assert not facebook.claim_publication_scoped(db, scope, "b-approved")
            won = facebook.claim_publication_scoped(db, scope, "a-approved")
            db.commit()
            return won

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: claim(), range(2)))
    assert sorted(results) == [False, True]
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT facebook_publish_status FROM drafts WHERE id='b-approved'")) == "not_published"
        assert connection.scalar(text("SELECT facebook_publish_status FROM drafts WHERE id='a-approved'")) == "publishing"
