"""Offline test setup. Nothing here changes the application's production config."""
import os
import socket

import httpx
import pytest


# Set these before test modules import app.main and construct provider clients.
# Assignment (not setdefault) prevents inherited production credentials being used.
os.environ.update({
    "PYTHON_DOTENV_DISABLED": "1",
    "DATABASE_URL": "sqlite://",
    "SUPABASE_URL": "https://supabase.test.invalid",
    "SUPABASE_SECRET_KEY": "test-only-secret",
    "SUPABASE_STORAGE_BUCKET": "test-only-bucket",
    "ALLOWED_USER_ID": "test-authorized-user",
    "OPENAI_API_KEY": "test-only-openai-key",
    "HEYGEN_API_KEY": "test-only-heygen-key",
    "FRONTEND_BASE_URL": "https://studio.test.invalid",
})


@pytest.fixture(autouse=True)
def block_external_requests(monkeypatch):
    """Fail even if application error handling catches an unmocked request."""
    attempts = []

    def blocked(*args, **kwargs):
        attempts.append("outbound request")
        raise AssertionError("External requests are blocked; mock the provider.")

    async def blocked_async(*args, **kwargs):
        blocked()

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", blocked_async)
    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked)
    yield
    assert not attempts, "A test attempted an unmocked external request."


@pytest.fixture
def isolated_client():
    """A fresh database and in-process HTTP client for each new baseline test."""
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool

    from app.auth import verify_token
    from app.database import get_db
    from app.main import app
    from app.models import Base

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)

    def override_db():
        with Session(engine) as db:
            yield db

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[verify_token] = lambda: {"sub": "test-authorized-user"}
    try:
        with TestClient(app) as client:
            yield client, engine
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)
        engine.dispose()
