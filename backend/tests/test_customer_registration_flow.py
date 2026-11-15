"""Customer journey with real JWTs/HTTP/SQLite; only Supabase is mocked."""
from datetime import timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import auth
from app.models import Business, BusinessMembership, CustomerEntitlement, CustomerOrganization
from tests.tenancy_fixtures import grant_test_owner
from tests.test_authentication_integration import auth_client, signed_token, signing_keys, headers


@pytest.mark.parametrize("language", ["en", "es"])
def test_two_customer_journey_preserves_existing_admin(auth_client, signed_token, monkeypatch, language):
    client, engine = auth_client
    monkeypatch.setenv("PUBLIC_REGISTRATION_ENABLED", "true")
    monkeypatch.setenv("TRIALS_ENABLED", "true")
    monkeypatch.setenv("TRIAL_DAYS", "14")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-only")
    with Session(engine) as db:
        db.add(Business(id="legacy-admin", name="Existing workspace"))
        db.flush()
        admin = grant_test_owner(db, ["legacy-admin"])
        db.commit()

    workspaces = []
    for subject in ("customer-a", "customer-b"):
        token = headers(signed_token(changes={"sub": subject}))
        response = Mock(status_code=200)
        response.json.return_value = {
            "id": subject, "email": f"{subject}@example.invalid",
            "email_confirmed_at": "2026-01-01T00:00:00Z",
        }
        monkeypatch.setattr(auth.httpx, "get", Mock(return_value=response))
        registered = client.post("/account/register", json={}, headers=token)
        assert registered.status_code == 200
        assert registered.json()["businesses"] == []
        assert client.post("/account/register", json={}, headers=token).json() == registered.json()
        progress = {"current_step": 6, "business_profile": {"name": subject},
                    "interface_language": language, "conversation_language": language,
                    "marketing_content_language": language, "social_accounts_skipped": True}
        assert client.put("/account/onboarding", json=progress, headers=token).status_code == 200
        activated = client.post("/account/onboarding/activate", json=progress, headers=token)
        assert activated.status_code == 201
        business_id = activated.json()["id"]
        assert client.post("/account/onboarding/activate", json=progress, headers=token).json()["id"] == business_id
        account = client.get("/account", headers=token).json()
        assert [b["id"] for b in account["businesses"]] == [business_id]
        assert account["preferences"]["interface_language"] == language
        entitlement = client.get(f"/businesses/{business_id}/entitlement", headers=token).json()
        assert entitlement["status"] == "trialing"
        assert entitlement["days_remaining"] == 14
        assert entitlement["provider_status"] is None
        assert client.patch("/account/onboarding/tutorial", json={"completed": True, "current_step": 9}, headers=token).status_code == 200
        assert client.get("/account/onboarding", headers=token).json()["tutorial_completed"] is True
        workspaces.append((token, business_id))

    for token, own_id in workspaces:
        for foreign_id in ["legacy-admin", *[bid for _, bid in workspaces if bid != own_id]]:
            for path in (f"/businesses/{foreign_id}/entitlement", f"/businesses/{foreign_id}/preferences"):
                assert client.get(path, headers=token).status_code == 404
            assert client.patch(f"/businesses/{foreign_id}/preferences", json={"marketing_content_language": "es"}, headers=token).status_code == 404
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(CustomerOrganization)) == 2
        entitlements = db.scalars(select(CustomerEntitlement)).all()
        assert len(entitlements) == 2
        assert len({e.organization_id for e in entitlements}) == 2
        assert all(e.trial_expires_at - e.trial_started_at == timedelta(days=14) for e in entitlements)
        assert db.get(Business, "legacy-admin").name == "Existing workspace"
        membership = db.scalar(select(BusinessMembership).where(BusinessMembership.business_id == "legacy-admin"))
        assert (membership.user_id, membership.role, membership.status) == (admin.user_id, "owner", "active")
    # Closing admission must not lock out already provisioned customers/admins.
    monkeypatch.setenv("PUBLIC_REGISTRATION_ENABLED", "false")
    for token, _ in workspaces:
        assert client.get("/account", headers=token).status_code == 200
    admin_account = client.get("/account", headers=headers(signed_token())).json()
    assert [b["id"] for b in admin_account["businesses"]] == ["legacy-admin"]
