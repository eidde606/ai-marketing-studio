from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Business, BusinessMembership, OnboardingProgress


def test_public_registration_remains_closed(isolated_client, monkeypatch):
    client, _ = isolated_client
    monkeypatch.setenv("SUPABASE_GOOGLE_SIGN_IN_ENABLED", "false")
    assert client.get("/public/config").json() == {
        "public_registration": False,
        "google_sign_in": False,
        "facebook_sign_in": False,
        "apple_sign_in": False,
        "trial_available": False,
    }


def test_public_config_exposes_trial_only_when_both_gates_are_enabled(
    isolated_client, monkeypatch,
):
    client, _ = isolated_client
    monkeypatch.setenv("PUBLIC_REGISTRATION_ENABLED", "true")
    monkeypatch.setenv("TRIALS_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_GOOGLE_SIGN_IN_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_FACEBOOK_SIGN_IN_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_APPLE_SIGN_IN_ENABLED", "true")
    assert client.get("/public/config").json() == {
        "public_registration": True,
        "google_sign_in": True,
        "facebook_sign_in": True,
        "apple_sign_in": True,
        "trial_available": True,
    }


def test_onboarding_saves_resumes_and_activates_idempotently(isolated_client):
    client, engine = isolated_client
    assert client.get("/account/onboarding").json() == {
        "current_step": 1,
        "business_profile": {},
        "interface_language": "en",
        "conversation_language": "en",
        "marketing_content_language": "en",
        "social_accounts_skipped": False,
        "completed": False,
        "tutorial_completed": False,
        "tutorial_step": 0,
    }

    progress = {
        "current_step": 5,
        "business_profile": {
            "name": "Example Studio",
            "industry": "Retail",
            "description": "A local shop",
            "target_audience": "Local families",
            "marketing_goals": "awareness, leads",
            "preferred_platforms": "facebook, instagram",
        },
        "interface_language": "es",
        "conversation_language": "en",
        "marketing_content_language": "es",
        "social_accounts_skipped": True,
    }
    saved = client.put("/account/onboarding", json=progress)
    assert saved.status_code == 200
    assert saved.json()["current_step"] == 5
    assert saved.json()["business_profile"]["name"] == "Example Studio"
    assert saved.json()["interface_language"] == "es"

    activation = {**progress, "current_step": 6}
    first = client.post("/account/onboarding/activate", json=activation)
    assert first.status_code == 201
    business_id = first.json()["id"]
    second = client.post("/account/onboarding/activate", json=activation)
    assert second.status_code == 201
    assert second.json()["id"] == business_id

    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Business)) == 1
        membership = db.scalar(select(BusinessMembership).where(
            BusinessMembership.business_id == business_id,
        ))
        assert membership.role == "owner"
        assert membership.status == "active"
        state = db.get(OnboardingProgress, membership.user_id)
        assert state.business_id == business_id
        assert state.completed_at is not None

    tutorial = client.patch("/account/onboarding/tutorial", json={"completed": True})
    assert tutorial.status_code == 200
    assert tutorial.json() == {"completed": True, "current_step": 0}
    state = client.get("/account/onboarding").json()
    assert state["tutorial_completed"] is True
    assert state["tutorial_step"] == 0

    replay = client.patch(
        "/account/onboarding/tutorial",
        json={"completed": False, "current_step": 0},
    )
    assert replay.status_code == 200
    assert replay.json() == {"completed": False, "current_step": 0}
    assert client.get("/account/onboarding").json()["tutorial_completed"] is False

    saved_step = client.patch(
        "/account/onboarding/tutorial",
        json={"completed": False, "current_step": 7},
    )
    assert saved_step.status_code == 200
    assert saved_step.json()["current_step"] == 7
    assert client.get("/account/onboarding").json()["tutorial_step"] == 7


def test_tutorial_progress_rejects_out_of_range_steps(isolated_client):
    client, _ = isolated_client
    response = client.patch(
        "/account/onboarding/tutorial",
        json={"completed": False, "current_step": 10},
    )
    assert response.status_code == 422


def test_onboarding_activation_requires_a_business_name(isolated_client):
    client, engine = isolated_client
    response = client.post("/account/onboarding/activate", json={
        "current_step": 6,
        "business_profile": {"name": "   "},
    })
    assert response.status_code == 400
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Business)) == 0
