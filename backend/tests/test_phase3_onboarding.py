from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Business, BusinessMembership, OnboardingProgress


def test_public_registration_remains_closed(isolated_client):
    client, _ = isolated_client
    assert client.get("/public/config").json() == {"public_registration": False}


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
    assert tutorial.json() == {"completed": True}
    assert client.get("/account/onboarding").json()["tutorial_completed"] is True


def test_onboarding_activation_requires_a_business_name(isolated_client):
    client, engine = isolated_client
    response = client.post("/account/onboarding/activate", json={
        "current_step": 6,
        "business_profile": {"name": "   "},
    })
    assert response.status_code == 400
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Business)) == 0
