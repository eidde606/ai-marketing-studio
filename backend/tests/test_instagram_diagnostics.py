import asyncio

import pytest

from app.features.instagram import diagnostics


def test_diagnostics_require_explicit_flag_and_local_development_target(monkeypatch):
    monkeypatch.setenv("AI_MARKETING_STUDIO_ENV", "development")
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://ai_marketing_studio_dev:local-only@localhost:5432/"
        "ai_marketing_studio_dev",
    )
    monkeypatch.delenv("INSTAGRAM_OAUTH_DIAGNOSTICS_ENABLED", raising=False)
    assert not diagnostics.enabled_for_local_development()

    monkeypatch.setenv("INSTAGRAM_OAUTH_DIAGNOSTICS_ENABLED", "true")
    assert diagnostics.enabled_for_local_development()

    monkeypatch.setenv("AI_MARKETING_STUDIO_ENV", "production")
    assert not diagnostics.enabled_for_local_development()
    assert diagnostics.requested_but_unsafe()

    monkeypatch.setenv("AI_MARKETING_STUDIO_ENV", "development")
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://app:secret@db.example.invalid:5432/production",
    )
    assert not diagnostics.enabled_for_local_development()
    assert diagnostics.requested_but_unsafe()


def test_diagnostics_inspect_callback_token_and_fully_paginate_pages(
        monkeypatch,
):
    token = "callback-token-for-test"
    app_id = "test-app-id"
    app_secret = "test-app-secret"
    authorized_page_id = "1122820307587663"
    calls = []

    responses = {
        "debug_token": {
            "data": {
                "is_valid": True,
                "app_id": app_id,
                "type": "USER",
                "scopes": [
                    "pages_show_list",
                    "pages_read_engagement",
                    "instagram_basic",
                ],
            }
        },
        "me/permissions": {
            "data": [
                {"permission": "pages_show_list", "status": "granted"},
                {"permission": "pages_read_engagement", "status": "granted"},
                {"permission": "instagram_basic", "status": "declined"},
            ]
        },
        "me/accounts:first": {
            "data": [
                {
                    "id": "998877",
                    "name": "Ignored page name",
                    "tasks": ["ADVERTISE", "MANAGE"],
                }
            ],
            "paging": {
                "cursors": {"after": "next-cursor"},
                "next": (
                    "https://graph.facebook.com/v27.0/me/accounts?"
                    "after=next-cursor&access_token=must-not-be-recorded"
                ),
            },
        },
        "me/accounts:next": {
            "data": [{
                "id": authorized_page_id,
                "name": "Another ignored page name",
                "tasks": ["CREATE_CONTENT", "MANAGE", "unsafe task"],
            }],
            "paging": {},
        },
    }

    class FakeResponse:
        status_code = 200
        is_error = False

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self, timeout):
            assert timeout == 20.0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, *, params=None, headers=None):
            endpoint = url.rsplit("/", 1)[-1]
            if endpoint == "debug_token":
                key = "debug_token"
                assert params == {"input_token": token}
                assert headers == {
                    "Authorization": f"Bearer {app_id}|{app_secret}"
                }
            elif endpoint == "permissions":
                key = "me/permissions"
                assert headers == {"Authorization": f"Bearer {token}"}
            else:
                key = (
                    "me/accounts:next"
                    if params.get("after") == "next-cursor"
                    else "me/accounts:first"
                )
                assert params["fields"] == "id,name,tasks"
                assert params["limit"] == 100
                assert headers == {"Authorization": f"Bearer {token}"}
            calls.append((endpoint, params, headers))
            return FakeResponse(responses[key])

    monkeypatch.setattr(diagnostics.httpx, "AsyncClient", FakeClient)
    monkeypatch.setenv("FACEBOOK_APP_ID", app_id)
    monkeypatch.setenv("FACEBOOK_APP_SECRET", app_secret)

    result = asyncio.run(
        diagnostics.collect_oauth_diagnostics(token, authorized_page_id)
    )

    assert result == {
        "token_type": "USER",
        "token_valid": True,
        "app_id_match": True,
        "debug_scopes": [
            "instagram_basic",
            "pages_read_engagement",
            "pages_show_list",
        ],
        "permissions": [
            {"name": "instagram_basic", "status": "declined"},
            {"name": "pages_read_engagement", "status": "granted"},
            {"name": "pages_show_list", "status": "granted"},
        ],
        "page_ids": ["1122820307587663", "998877"],
        "page_tasks": {
            "1122820307587663": ["CREATE_CONTENT", "MANAGE"],
            "998877": ["ADVERTISE", "MANAGE"],
        },
        "page_result_count": 2,
        "authorized_page_id": authorized_page_id,
        "authorized_page_match": True,
        "page_list_complete": True,
        "errors": [],
    }
    assert [call[0] for call in calls] == [
        "debug_token", "permissions", "accounts", "accounts",
    ]
    assert calls[2][1] == {"fields": "id,name,tasks", "limit": 100}
    assert calls[3][1] == {
        "fields": "id,name,tasks",
        "limit": 100,
        "after": "next-cursor",
    }
    serialized_result = repr(result)
    assert token not in serialized_result
    assert app_secret not in serialized_result
    assert "must-not-be-recorded" not in serialized_result
    assert "Ignored page name" not in serialized_result


def test_diagnostic_api_errors_are_categorized_without_raw_messages(
        monkeypatch,
):
    token = "sensitive-callback-token"
    app_secret = "sensitive-app-secret"
    raw_message = (
        "sensitive-callback-token sensitive-app-secret private-code private-state"
    )

    class FakeResponse:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self.payload = payload
            self.is_error = status_code >= 400

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, *, params=None, headers=None):
            endpoint = url.rsplit("/", 1)[-1]
            return FakeResponse(
                400,
                {"error": {"code": 190, "message": raw_message}},
            )

    monkeypatch.setattr(diagnostics.httpx, "AsyncClient", FakeClient)
    monkeypatch.setenv("FACEBOOK_APP_ID", "test-app-id")
    monkeypatch.setenv("FACEBOOK_APP_SECRET", app_secret)

    result = asyncio.run(
        diagnostics.collect_oauth_diagnostics(token, "1122820307587663")
    )

    assert result["errors"] == [
        {
            "endpoint": "debug_token",
            "category": "http_error",
            "status": 400,
            "code": 190,
        },
        {
            "endpoint": "me/permissions",
            "category": "http_error",
            "status": 400,
            "code": 190,
        },
        {
            "endpoint": "me/accounts",
            "category": "http_error",
            "status": 400,
            "code": 190,
        },
    ]
    safe_result = repr(result)
    for sensitive_value in (token, app_secret, raw_message, "private-code", "private-state"):
        assert sensitive_value not in safe_result


def test_invalid_token_app_mismatch_and_malformed_permission_data_are_reported(
        monkeypatch,
):
    class FakeResponse:
        status_code = 200
        is_error = False

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, *, params=None, headers=None):
            endpoint = url.rsplit("/", 1)[-1]
            if endpoint == "debug_token":
                return FakeResponse({
                    "data": {
                        "is_valid": False,
                        "app_id": "different-app",
                        "type": "PAGE",
                        "scopes": ["pages_show_list"],
                    }
                })
            if endpoint == "permissions":
                return FakeResponse({"data": "malformed"})
            return FakeResponse({"data": [], "paging": {}})

    monkeypatch.setattr(diagnostics.httpx, "AsyncClient", FakeClient)
    monkeypatch.setenv("FACEBOOK_APP_ID", "configured-app")
    monkeypatch.setenv("FACEBOOK_APP_SECRET", "test-app-secret")

    result = asyncio.run(
        diagnostics.collect_oauth_diagnostics(
            "callback-token",
            "1122820307587663",
        )
    )

    assert result["token_type"] == "PAGE"
    assert result["token_valid"] is False
    assert result["app_id_match"] is False
    assert result["debug_scopes"] == ["pages_show_list"]
    assert result["permissions"] == []
    assert result["page_list_complete"] is True
    assert result["errors"] == [{
        "endpoint": "me/permissions",
        "category": "data_missing",
    }]
