import httpx
import pytest
from fastapi import HTTPException


@pytest.fixture
def facebook_page_config(monkeypatch):
    monkeypatch.setenv("FACEBOOK_PAGE_ID", "page-123")
    monkeypatch.setenv("FACEBOOK_PAGE_ACCESS_TOKEN", "test-page-token")


def test_facebook_page_returns_provider_response(
    isolated_client,
    facebook_page_config,
    monkeypatch,
):
    from app.features.facebook import provider as facebook_provider

    client, _ = isolated_client

    async def fake_page_info(page_id, access_token):
        return {
            "id": page_id,
            "name": "Test Page",
            "token_received": access_token == "test-page-token",
        }

    monkeypatch.setattr(facebook_provider, "get_page_info", fake_page_info)

    response = client.get("/facebook/page")

    assert response.status_code == 200
    assert response.json() == {
        "id": "page-123",
        "name": "Test Page",
        "token_received": True,
    }


def test_facebook_page_requires_provider_configuration(
    isolated_client,
    monkeypatch,
):
    from app.features.facebook import provider as facebook_provider

    client, _ = isolated_client
    monkeypatch.delenv("FACEBOOK_PAGE_ID", raising=False)
    monkeypatch.delenv("FACEBOOK_PAGE_ACCESS_TOKEN", raising=False)
    provider = lambda *_args: pytest.fail("Provider should not be called")
    monkeypatch.setattr(facebook_provider, "get_page_info", provider)

    response = client.get("/facebook/page")

    assert response.status_code == 503
    assert response.json() == {"detail": "Facebook is not configured"}


@pytest.mark.parametrize(
    ("failure", "expected_detail"),
    [
        (
            httpx.HTTPStatusError(
                "provider error",
                request=httpx.Request("GET", "https://graph.test/page"),
                response=httpx.Response(
                    500,
                    request=httpx.Request("GET", "https://graph.test/page"),
                ),
            ),
            "Unable to retrieve Facebook Page",
        ),
        (
            httpx.RequestError(
                "connection error",
                request=httpx.Request("GET", "https://graph.test/page"),
            ),
            "Facebook connection failed",
        ),
    ],
)
def test_facebook_page_maps_provider_errors(
    isolated_client,
    facebook_page_config,
    monkeypatch,
    failure,
    expected_detail,
):
    from app.features.facebook import provider

    client, _ = isolated_client

    async def fail(*_args):
        raise failure

    monkeypatch.setattr(provider, "get_page_info", fail)

    response = client.get("/facebook/page")

    assert response.status_code == 502
    assert response.json() == {"detail": expected_detail}


def test_facebook_page_requires_authentication(
    isolated_client,
    facebook_page_config,
):
    from app.auth import verify_token

    client, _ = isolated_client

    def reject_auth():
        raise HTTPException(status_code=401, detail="Invalid token")

    client.app.dependency_overrides[verify_token] = reject_auth

    response = client.get("/facebook/page")

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid token"}
