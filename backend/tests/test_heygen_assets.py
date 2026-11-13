import httpx


def test_asset_endpoints_require_existing_authentication(isolated_client):
    from app.auth import verify_token
    from app.main import app

    client, _ = isolated_client
    override = app.dependency_overrides.pop(verify_token)
    try:
        response = client.get("/heygen/assets/avatars")
    finally:
        app.dependency_overrides[verify_token] = override

    assert response.status_code == 401


def test_paginated_avatar_looks_include_filters_and_metadata(
    isolated_client, monkeypatch,
):
    from app.features.media import service

    client, _ = isolated_client
    expected = {
        "data": [{
            "id": "look-1",
            "name": "Avatar de prueba",
            "avatar_type": "photo_avatar",
            "default_voice_id": "voice-1",
            "supported_api_engines": ["avatar_iv", "avatar_v"],
            "preview_image_url": "https://assets.test/avatar.jpg",
            "preview_video_url": None,
            "group_id": None,
            "gender": None,
            "tags": [],
            "status": None,
        }],
        "has_more": True,
        "next_token": "next-avatar-page",
    }
    calls = []

    def list_looks(**kwargs):
        calls.append(kwargs)
        return expected

    monkeypatch.setattr(service, "avatar_looks", list_looks)
    response = client.get(
        "/heygen/assets/avatars",
        params={
            "avatar_type": "photo_avatar",
            "ownership": "private",
            "limit": 1,
            "token": "prior-page",
        },
    )

    assert response.status_code == 200
    assert response.json() == expected
    assert calls == [{
        "avatar_type": "photo_avatar",
        "ownership": "private",
        "limit": 1,
        "token": "prior-page",
    }]


def test_paginated_voice_listing_preserves_metadata_and_cursor(
    isolated_client, monkeypatch,
):
    from app.features.media import service

    client, _ = isolated_client
    expected = {
        "data": [{
            "voice_id": "voice-1",
            "name": "Voz de prueba",
            "language": "es",
            "status": "ACTIVE",
            "mode": "instant",
            "preview_audio_url": "https://assets.test/voice.wav",
        }],
        "has_more": True,
        "next_token": "next-voice-page",
    }
    calls = []

    def list_voice_assets(**kwargs):
        calls.append(kwargs)
        return expected

    monkeypatch.setattr(service, "voices", list_voice_assets)
    response = client.get(
        "/heygen/assets/voices",
        params={"type": "public", "limit": 1, "token": "prior-page"},
    )

    assert response.status_code == 200
    assert response.json() == expected
    assert calls == [{
        "voice_type": "public",
        "limit": 1,
        "token": "prior-page",
    }]


def test_asset_filters_and_page_limits_are_validated(isolated_client, monkeypatch):
    from app.features.media import service

    client, _ = isolated_client
    called = False

    def unexpected_call(**_kwargs):
        nonlocal called
        called = True
        return {"data": [], "has_more": False, "next_token": None}

    monkeypatch.setattr(service, "avatar_looks", unexpected_call)
    for query in (
        "?avatar_type=unknown",
        "?ownership=shared",
        "?limit=0",
        "?limit=51",
    ):
        response = client.get(f"/heygen/assets/avatars{query}")
        assert response.status_code == 422
    assert not called


def test_legacy_avatar_and_voice_routes_keep_list_responses(
    isolated_client, monkeypatch,
):
    from app.features.media import service

    client, _ = isolated_client
    monkeypatch.setattr(
        service,
        "legacy_avatar_looks",
        lambda: [{
            "id": "look-1",
            "name": "Avatar",
            "avatar_type": "digital_twin",
            "extra_provider_field": "preserved",
        }],
    )
    monkeypatch.setattr(
        service,
        "legacy_voices",
        lambda: [{"voice_id": "voice-1", "name": "Voz", "language": "es"}],
    )

    avatars = client.get("/heygen/avatars")
    voices = client.get("/heygen/voices")

    assert avatars.status_code == voices.status_code == 200
    assert isinstance(avatars.json(), list)
    assert isinstance(voices.json(), list)
    assert avatars.json()[0]["avatar_type"] == "digital_twin"
    assert avatars.json()[0]["extra_provider_field"] == "preserved"
    assert voices.json()[0]["language"] == "es"


def test_provider_voice_client_uses_v3_and_query_pagination(monkeypatch):
    from app.features.media import heygen_provider as heygen_service

    expected = {
        "data": [{"voice_id": "voice-1", "name": "Voz"}],
        "has_more": True,
        "next_token": "next-page",
    }
    captured = {}

    class MockClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def get(self, url, *, headers, params):
            captured.update(url=url, headers=headers, params=params)
            return httpx.Response(
                200,
                json=expected,
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(heygen_service.httpx, "Client", MockClient)
    monkeypatch.setenv("HEYGEN_API_KEY", "test-only-heygen-key")

    result = heygen_service.list_voices(
        voice_type="public",
        limit=7,
        token="cursor-1",
    )

    assert result == expected
    assert captured["url"] == (
        "https://api.heygen.com/v3/models/audio/voices"
    )
    assert captured["headers"]["X-Api-Key"] == "test-only-heygen-key"
    assert captured["params"] == {
        "type": "public",
        "limit": 7,
        "token": "cursor-1",
    }


def test_provider_avatar_client_uses_v3_filtering(monkeypatch):
    from app.features.media import heygen_provider as heygen_service

    captured = {}

    class MockClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def get(self, url, *, headers, params):
            captured.update(url=url, params=params)
            return httpx.Response(
                200,
                json={"data": [], "has_more": False, "next_token": None},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(heygen_service.httpx, "Client", MockClient)
    monkeypatch.setenv("HEYGEN_API_KEY", "test-only-heygen-key")

    heygen_service.list_avatar_looks(
        avatar_type="photo_avatar",
        ownership="private",
        limit=12,
    )

    assert captured["url"] == "https://api.heygen.com/v3/avatars/looks"
    assert captured["params"] == {
        "avatar_type": "photo_avatar",
        "ownership": "private",
        "limit": 12,
    }


def test_provider_errors_return_gateway_response(isolated_client, monkeypatch):
    from app.features.media import service

    client, _ = isolated_client
    request = httpx.Request("GET", "https://api.heygen.com/v3/avatars/looks")
    response = httpx.Response(503, request=request)
    monkeypatch.setattr(
        service,
        "avatar_looks",
        lambda **_kwargs: (_ for _ in ()).throw(
            httpx.HTTPStatusError("provider unavailable", request=request, response=response)
        ),
    )
    monkeypatch.setattr(
        service,
        "voices",
        lambda **_kwargs: (_ for _ in ()).throw(
            httpx.ConnectError("provider unavailable")
        ),
    )

    assert client.get("/heygen/assets/avatars").status_code == 502
    assert client.get("/heygen/assets/voices").status_code == 502


def test_legacy_voice_service_collects_all_v3_pages(monkeypatch):
    from app.features.media import heygen_provider as heygen_service

    calls = []

    def list_voices(*, voice_type, limit, token):
        calls.append((voice_type, limit, token))
        if token is None:
            return {
                "data": [{"voice_id": "voice-1"}],
                "has_more": True,
                "next_token": "next",
            }
        return {
            "data": [{"voice_id": "voice-2"}],
            "has_more": False,
            "next_token": None,
        }

    monkeypatch.setattr(heygen_service, "list_voices", list_voices)

    assert heygen_service.get_available_voices() == [
        {"voice_id": "voice-1"},
        {"voice_id": "voice-2"},
    ]
    assert calls == [("private", 20, None), ("private", 20, "next")]
