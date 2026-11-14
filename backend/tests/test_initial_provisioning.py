import os

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access.permissions import Permission
from app.features.access.service import require_permission
from app.features.access.provisioning_service import provision_initial_owner
from app.models import Base, Business, BusinessMembership, User
from tests.test_tenant_foundation_postgres import postgres_database  # noqa: F401


BUSINESS_IDS = [
    "2748f7dd-2f75-4a76-ae45-ef42a1be402a",
    "d91c71aa-3342-4b1d-a4f6-ae8b19249e91",
    "f33cccce-ec00-40ab-a90c-305d3b66d02c",
    "fb2ae49f-a43a-4ddd-99c3-a43c8a51b32c",
]


@pytest.fixture
def empty_identity_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'provisioning.sqlite'}")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all(
            Business(id=business_id, name=f"Business {index}")
            for index, business_id in enumerate(BUSINESS_IDS)
        )
        db.commit()
    yield engine
    engine.dispose()


def test_initial_provisioning_creates_allowlisted_user_and_explicit_owners(
    empty_identity_database,
):
    with Session(empty_identity_database) as db:
        principal = provision_initial_owner(db, BUSINESS_IDS)
        user = db.get(User, principal.user_id)
        memberships = db.scalars(
            select(BusinessMembership).order_by(BusinessMembership.business_id)
        ).all()

        assert user.status == "active"
        assert user.auth_issuer == f"{os.environ['SUPABASE_URL'].rstrip('/')}/auth/v1"
        assert user.auth_subject == os.environ["ALLOWED_USER_ID"]
        assert len(memberships) == len(BUSINESS_IDS)
        assert {membership.business_id for membership in memberships} == set(BUSINESS_IDS)
        assert all(membership.user_id == user.id for membership in memberships)
        assert all(
            membership.role == "owner" and membership.status == "active"
            for membership in memberships
        )
        assert all(
            require_permission(db, principal, business_id, Permission.READ).role == "owner"
            for business_id in BUSINESS_IDS
        )


def test_initial_provisioning_rejects_incomplete_manifest_without_writes(
    empty_identity_database,
):
    with Session(empty_identity_database) as db:
        with pytest.raises(ApplicationError) as error:
            provision_initial_owner(db, BUSINESS_IDS[:-1])

        assert error.value.kind is ErrorKind.CONFLICT
        assert db.scalar(select(User.id)) is None
        assert db.scalar(select(BusinessMembership.id)) is None


@pytest.mark.parametrize("manifest", [[], [""], [" "], [None], BUSINESS_IDS * 2])
def test_invalid_manifest_has_no_writes(empty_identity_database, manifest):
    with Session(empty_identity_database) as db:
        with pytest.raises(ApplicationError) as error:
            provision_initial_owner(db, manifest)
        assert error.value.kind is ErrorKind.INVALID_INPUT
    with Session(empty_identity_database) as db:
        assert db.scalar(select(User.id)) is None
        assert db.scalar(select(BusinessMembership.id)) is None


@pytest.mark.parametrize("setting", ["ALLOWED_USER_ID", "SUPABASE_URL"])
def test_missing_identity_configuration_has_no_writes(
    empty_identity_database, monkeypatch, setting,
):
    monkeypatch.delenv(setting)
    with Session(empty_identity_database) as db:
        with pytest.raises(ApplicationError) as error:
            provision_initial_owner(db, BUSINESS_IDS)
        assert error.value.kind is ErrorKind.FORBIDDEN
    with Session(empty_identity_database) as db:
        assert db.scalar(select(User.id)) is None
        assert db.scalar(select(BusinessMembership.id)) is None


def test_repeat_preserves_original_identity_and_memberships(empty_identity_database):
    with Session(empty_identity_database) as db:
        original = provision_initial_owner(db, BUSINESS_IDS)
        membership_ids = set(db.scalars(select(BusinessMembership.id)))
    with Session(empty_identity_database) as db:
        with pytest.raises(ApplicationError) as error:
            provision_initial_owner(db, list(reversed(BUSINESS_IDS)))
        assert error.value.kind is ErrorKind.CONFLICT
    with Session(empty_identity_database) as db:
        assert list(db.scalars(select(User.id))) == [original.user_id]
        assert set(db.scalars(select(BusinessMembership.id))) == membership_ids


@pytest.mark.parametrize("stage", ["after_user_flush", "after_membership_flush"])
def test_failure_rolls_back_all_writes_and_allows_retry(
    empty_identity_database, monkeypatch, stage,
):
    from app.features.access import provisioning_service, repository

    def fail_after_user_flush(db, user, memberships):
        db.add(user)
        db.flush()
        raise RuntimeError("injected failure")

    def fail_resolution(db, principal):
        assert db.scalar(select(BusinessMembership.id)) is not None
        raise RuntimeError("injected failure")

    with monkeypatch.context() as patch:
        if stage == "after_user_flush":
            patch.setattr(repository, "add_initial_user_and_owner_memberships", fail_after_user_flush)
        else:
            patch.setattr(provisioning_service, "resolve_principal", fail_resolution)
        with Session(empty_identity_database) as db:
            with pytest.raises(RuntimeError, match="injected failure"):
                provision_initial_owner(db, BUSINESS_IDS)
    with Session(empty_identity_database) as db:
        assert db.scalar(select(User.id)) is None
        assert db.scalar(select(BusinessMembership.id)) is None
        principal = provision_initial_owner(db, BUSINESS_IDS)
        assert principal.user_id


def test_initial_provisioning_refuses_nonempty_identity_tables(
    empty_identity_database,
):
    with Session(empty_identity_database) as db:
        db.add(User(
            auth_issuer="https://existing.test.invalid/auth/v1",
            auth_subject="existing",
        ))
        db.commit()

        with pytest.raises(ApplicationError) as error:
            provision_initial_owner(db, BUSINESS_IDS)

        assert error.value.kind is ErrorKind.CONFLICT
        assert db.scalar(select(User.id)) is not None
        assert db.scalar(select(BusinessMembership.id)) is None


def test_concurrent_initial_provisioning_has_one_winner(postgres_database):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    engine, migrate = postgres_database
    migrate("head")
    with Session(engine) as db:
        db.add_all(Business(id=value, name=value) for value in BUSINESS_IDS)
        db.commit()

    barrier = Barrier(2)

    def provision(manifest):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                return provision_initial_owner(db, manifest)
            except ApplicationError as error:
                return error.kind

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(provision, [BUSINESS_IDS, list(reversed(BUSINESS_IDS))]))
    assert results.count(ErrorKind.CONFLICT) == 1
    with Session(engine) as db:
        user_ids = list(db.scalars(select(User.id)))
        memberships = list(db.scalars(select(BusinessMembership)))
        assert len(user_ids) == 1
        assert len(memberships) == len(BUSINESS_IDS)
        assert {membership.business_id for membership in memberships} == set(BUSINESS_IDS)
        assert all(membership.user_id == user_ids[0] for membership in memberships)
