"""Opt-in disposable PostgreSQL tests; never accepts a database URL.

RUN_ISOLATED_POSTGRES=1 PYTHONPATH=backend .venv/bin/python -m pytest \
    backend/tests/test_tenant_foundation_postgres.py -q
PG_BIN_DIR may select installed PostgreSQL binaries. No existing server is used.
"""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from threading import Barrier

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access.principal import Principal
from app.features.memberships.service import change_membership
from app.models import BusinessMembership
from tests.test_tenant_foundation import ISSUER, seed


@pytest.fixture
def postgres_database():
    if os.environ.get("RUN_ISOLATED_POSTGRES") != "1":
        pytest.skip("Set RUN_ISOLATED_POSTGRES=1 to launch a disposable local cluster")
    initdb = Path(os.environ.get("PG_BIN_DIR", Path(shutil.which("initdb") or "/missing").parent)) / "initdb"
    if not initdb.is_file():
        pytest.fail("PostgreSQL binaries unavailable")
    binary_dir = initdb.resolve().parent
    backend = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="ams-pg-", dir="/tmp") as directory:
        root = Path(directory)
        data = root / "data"
        command = [str(binary_dir / "initdb"), "-D", str(data), "-A", "trust", "--no-locale", "-E", "UTF8"]
        share = binary_dir.parent / "share" / "postgresql"
        if (share / "postgres.bki").exists():
            command += ["-L", str(share)]
        result = subprocess.run(command, capture_output=True, text=True)
        assert result.returncode == 0, result.stdout + result.stderr
        # Unix socket only, inside a private temporary directory; no TCP listener.
        subprocess.run([str(binary_dir / "pg_ctl"), "-D", str(data), "-l", str(root / "server.log"),
                        "-o", f"-k {root} -c listen_addresses='' -c fsync=off", "-w", "start"],
                       check=True, capture_output=True, text=True)
        engine = None
        try:
            url = f"postgresql+psycopg:///postgres?host={root}"
            environment = {**os.environ, "DATABASE_URL": url, "PYTHON_DOTENV_DISABLED": "1"}
            def migrate(target, direction="upgrade"):
                result = subprocess.run([sys.executable, "-m", "alembic", direction, target],
                                        cwd=backend, env=environment, capture_output=True, text=True)
                assert result.returncode == 0, result.stdout + result.stderr
            migrate("b6d23e8a41c0")
            engine = create_engine(url)
            yield engine, migrate
        finally:
            if engine is not None:
                engine.dispose()
            subprocess.run([str(binary_dir / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "stop"],
                           check=True, capture_output=True, text=True)


def test_migration_preserves_data_and_constraints(postgres_database):
    engine, migrate = postgres_database
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO businesses (id, name, created_at) VALUES ('legacy', 'Hola Compra Vibes', now())"))
        connection.execute(text("INSERT INTO drafts (id, title, caption, platform, status, created_at, source, publish_destinations) VALUES ('legacy-draft', 'Existing', 'Text', 'facebook', 'pending', now(), 'manual', '[\"facebook\"]')"))
    migrate("head")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM app_users")) == 0
        assert connection.scalar(text("SELECT count(*) FROM business_memberships")) == 0
        assert connection.scalar(text("SELECT name FROM businesses WHERE id='legacy'")) == "Hola Compra Vibes"
        assert connection.scalar(text("SELECT business_id FROM drafts WHERE id='legacy-draft'")) is None
    seed(engine)
    # Exercise constraints against the migrated schema, not create_all metadata.
    for statement in [
        "INSERT INTO app_users (id, auth_issuer, auth_subject) SELECT 'duplicate', auth_issuer, auth_subject FROM app_users WHERE id='owner'",
        "INSERT INTO business_memberships (id, business_id, user_id, role) VALUES ('duplicate', 'a', 'owner', 'member')",
        "UPDATE business_memberships SET role='superadmin' WHERE id='member'",
        "UPDATE business_memberships SET status='invited' WHERE id='member'",
        "INSERT INTO business_memberships (id, business_id, user_id, role) VALUES ('orphan', 'a', 'missing', 'member')",
        "INSERT INTO business_memberships (id, business_id, user_id, role) VALUES ('orphan', 'missing', 'owner2', 'member')",
        "UPDATE app_users SET status='unknown' WHERE id='member'",
    ]:
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(text(statement))
    migrate("b6d23e8a41c0", "downgrade")
    assert "app_users" not in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT title FROM drafts WHERE id='legacy-draft'")) == "Existing"
    migrate("head")
    assert "business_memberships" in inspect(engine).get_table_names()


def test_simultaneous_owner_departures(postgres_database):
    engine, migrate = postgres_database
    migrate("head")
    seed(engine)
    with Session(engine) as db:
        db.add(BusinessMembership(id="owner2", business_id="a", user_id="owner2", role="owner"))
        db.commit()
    barrier = Barrier(2)
    def depart(subject):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                change_membership(db, Principal(ISSUER, subject), "a", subject, role="owner", status="revoked")
                return "removed"
            except ApplicationError as exc:
                return exc.kind
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(depart, ["owner", "owner2"]))
    assert results.count("removed") == 1
    assert results.count(ErrorKind.CONFLICT) == 1
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM business_memberships WHERE business_id='a' AND role='owner' AND status='active'")) == 1


def test_actor_revoked_while_waiting_for_business_lock(postgres_database, monkeypatch):
    from threading import Event
    from app.features.memberships import repository

    engine, migrate = postgres_database
    migrate("head")
    seed(engine)
    waiting = Event()
    original_lock = repository.lock_business

    def signal_then_lock(db, business_id):
        waiting.set()  # The first authorization check has already succeeded.
        return original_lock(db, business_id)

    monkeypatch.setattr(repository, "lock_business", signal_then_lock)

    def remove_member():
        with Session(engine) as db:
            try:
                change_membership(db, Principal(ISSUER, "admin"), "a", "member", role="member", status="revoked")
                return None
            except ApplicationError as exc:
                return exc.kind

    with ThreadPoolExecutor(max_workers=1) as executor:
        with engine.begin() as connection:
            connection.execute(text("SELECT id FROM businesses WHERE id='a' FOR UPDATE"))
            future = executor.submit(remove_member)
            assert waiting.wait(timeout=10)
            assert not future.done()
            connection.execute(text("UPDATE business_memberships SET status='revoked' WHERE id='admin'"))
        assert future.result(timeout=10) == ErrorKind.NOT_FOUND
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT status FROM business_memberships WHERE id='member'")) == "active"


def test_resolved_principal_rechecks_committed_revocation(postgres_database):
    from app.features.access.permissions import Permission
    from app.features.access.service import require_permission, resolve_principal

    engine, migrate = postgres_database
    migrate("head")
    seed(engine)
    with Session(engine) as request_session:
        principal = resolve_principal(request_session, Principal(ISSUER, "member"))
        assert require_permission(request_session, principal, "a", Permission.READ)
        with engine.begin() as connection:
            connection.execute(text("UPDATE business_memberships SET status='revoked' WHERE id='member'"))
        with pytest.raises(ApplicationError) as error:
            require_permission(request_session, principal, "a", Permission.READ)
        assert error.value.kind == ErrorKind.NOT_FOUND
        # Other-business membership remains usable until the account is disabled.
        assert require_permission(request_session, principal, "b", Permission.READ)
        with engine.begin() as connection:
            connection.execute(text("UPDATE app_users SET status='disabled' WHERE id='member'"))
        with pytest.raises(ApplicationError) as error:
            require_permission(request_session, principal, "b", Permission.READ)
        assert error.value.kind == ErrorKind.NOT_FOUND
        with pytest.raises(ApplicationError) as error:
            resolve_principal(request_session, Principal(ISSUER, "member"))
        assert error.value.kind == ErrorKind.FORBIDDEN
