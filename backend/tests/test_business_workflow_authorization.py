"""Real access policy and scoped persistence; only verified identity is stubbed."""
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_authenticated_principal
from app.models import Business, BusinessMembership, Campaign, Draft, User
from tests.tenancy_fixtures import grant_test_owner


@pytest.fixture
def workflow_case(isolated_client):
    client, engine = isolated_client
    a = client.post("/businesses", json={"name": "Hola Compra Vibes"}).json()["id"]
    with Session(engine) as db:
        b = Business(name="Other tenant")
        unowned = Business(name="Unverified legacy")
        db.add_all([b, unowned])
        db.flush()
        grant_test_owner(db, [b.id], subject="other-identity")
        for business_id in (a, b.id):
            db.add(Campaign(id=f"{business_id[:8]}-campaign", business_id=business_id, name="Campaign", objective="Goal"))
            db.add(Draft(id=f"{business_id[:8]}-draft", business_id=business_id, title="Draft", caption="Text", platform="facebook", status="pending"))
        db.commit()
        return client, engine, a, b.id, unowned.id


@pytest.mark.parametrize("role", ["owner", "admin", "member"])
def test_role_permissions(workflow_case, role):
    client, engine, a, _, _ = workflow_case
    with Session(engine) as db:
        db.scalar(select(BusinessMembership).where(BusinessMembership.business_id == a)).role = role
        db.commit()
    draft_id = f"{a[:8]}-draft"
    assert client.get("/drafts", params={"business_id": a}).status_code == 200
    assert client.patch(f"/drafts/{draft_id}", json={"title": "Edited", "caption": "Edited"}).status_code == 200
    assert client.post(f"/businesses/{a}/campaigns", json={"name": "New", "objective": "Goal"}).status_code == 201
    approval = client.patch(f"/drafts/{draft_id}/approve")
    assert approval.status_code == (403 if role == "member" else 200)
    if role == "member":
        assert client.patch(f"/drafts/{draft_id}/reject").status_code == 403
        assert client.delete(f"/drafts/{draft_id}").status_code == 200
    else:
        assert client.patch(f"/drafts/{draft_id}", json={"title": "No", "caption": "No"}).status_code == 409


@pytest.mark.parametrize("status", ["suspended", "revoked"])
def test_inactive_membership_denies_all_migrated_paths(workflow_case, status):
    client, engine, a, _, _ = workflow_case
    with Session(engine) as db:
        db.scalar(select(BusinessMembership).where(BusinessMembership.business_id == a)).status = status
        db.commit()
    assert client.get("/businesses").json() == []
    draft_id, campaign_id = f"{a[:8]}-draft", f"{a[:8]}-campaign"
    assert client.get("/drafts", params={"business_id": a}).status_code == 404
    for suffix in ("approve", "reject"):
        assert client.patch(f"/drafts/{draft_id}/{suffix}").status_code == 404
    assert client.delete(f"/drafts/{draft_id}").status_code == 404
    assert client.get(f"/businesses/{a}/campaigns/{campaign_id}").status_code == 404
    assert client.delete(f"/businesses/{a}/campaigns/{campaign_id}").status_code == 404
    assert client.patch(f"/businesses/{a}/campaigns/{campaign_id}/drafts/{draft_id}").status_code == 404


def test_listing_and_foreign_ids_are_non_disclosing(workflow_case):
    client, engine, a, b, unowned = workflow_case
    assert [row["id"] for row in client.get("/businesses").json()] == [a]
    for business_id in (b, unowned, "missing"):
        assert client.get("/drafts", params={"business_id": business_id}).status_code == 404
        assert client.post("/drafts", json={"business_id": business_id, "title": "No", "caption": "No", "platform": "facebook"}).status_code == 404
    foreign_draft = f"{b[:8]}-draft"
    for draft_id in (foreign_draft, "missing"):
        assert client.patch(f"/drafts/{draft_id}", json={"title": "No", "caption": "No"}).json() == {"detail": "Draft not found"}
        assert client.patch(f"/drafts/{draft_id}/approve").status_code == 404
        assert client.patch(f"/drafts/{draft_id}/reject").status_code == 404
        assert client.patch(f"/drafts/{draft_id}/destinations", json={"destinations": ["facebook"]}).status_code == 404
        assert client.delete(f"/drafts/{draft_id}").status_code == 404
    a_campaign, b_campaign = f"{a[:8]}-campaign", f"{b[:8]}-campaign"
    assert client.get(f"/businesses/{a}/campaigns/{b_campaign}").status_code == 404
    assert client.patch(f"/businesses/{a}/campaigns/{b_campaign}", json={"name": "No"}).status_code == 404
    assert client.patch(f"/businesses/{a}/campaigns/{a_campaign}/drafts/{foreign_draft}").status_code == 404
    with Session(engine) as db:
        foreign = db.get(Draft, foreign_draft)
        assert (foreign.title, foreign.status, foreign.deleted_at, foreign.campaign_id) == ("Draft", "pending", None, None)
        assert db.scalar(select(func.count()).select_from(BusinessMembership).where(BusinessMembership.business_id == unowned)) == 0


def test_multi_business_listing_and_new_business_ownership(workflow_case):
    client, engine, a, b, unowned = workflow_case
    with Session(engine) as db:
        grant_test_owner(db, [b])
        db.commit()
    assert {row["id"] for row in client.get("/businesses").json()} == {a, b}
    created = client.post("/businesses", json={"name": "New tenant", "id": unowned}).json()["id"]
    assert created != unowned
    with Session(engine) as db:
        membership = db.scalar(select(BusinessMembership).where(BusinessMembership.business_id == created))
        assert (membership.role, membership.status) == ("owner", "active")
        assert db.scalar(select(func.count()).select_from(BusinessMembership).where(BusinessMembership.business_id == unowned)) == 0


def test_business_creation_rolls_back_owner_failure(workflow_case, monkeypatch):
    from app.features.businesses import repository
    client, engine, _, _, _ = workflow_case
    original = repository.insert_business_and_owner
    def fail(db, business, membership):
        original(db, business, membership)
        raise RuntimeError("test failure")
    monkeypatch.setattr(repository, "insert_business_and_owner", fail)
    with pytest.raises(RuntimeError, match="test failure"):
        client.post("/businesses", json={"name": "Rollback tenant"})
    with Session(engine) as db:
        assert db.scalar(select(Business).where(Business.name == "Rollback tenant")) is None


def test_member_cannot_delete_approved_content(workflow_case):
    client, engine, a, _, _ = workflow_case
    draft_id = f"{a[:8]}-draft"
    assert client.patch(f"/drafts/{draft_id}/approve").status_code == 200
    with Session(engine) as db:
        db.scalar(select(BusinessMembership).where(BusinessMembership.business_id == a)).role = "member"
        db.commit()
    assert client.delete(f"/drafts/{draft_id}").status_code == 403
    with Session(engine) as db:
        assert db.get(Draft, draft_id).deleted_at is None


def test_complete_list_contract_beyond_one_repository_page(workflow_case):
    client, engine, a, _, _ = workflow_case
    with Session(engine) as db:
        db.add_all([Draft(business_id=a, title=str(i), caption="Page", platform="facebook") for i in range(105)])
        db.add_all([Campaign(business_id=a, name=str(i), objective="Page") for i in range(105)])
        db.commit()
    drafts_response = client.get("/drafts", params={"business_id": a}).json()
    campaigns_response = client.get(f"/businesses/{a}/campaigns").json()
    assert len(drafts_response) == 106
    assert len(campaigns_response) == 106
    assert {row["business_id"] for row in drafts_response} == {a}
    assert {row["business_id"] for row in campaigns_response} == {a}
