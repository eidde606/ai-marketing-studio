"""Foundation tests intentionally call services: no new HTTP integration yet."""
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access.permissions import Permission, allows
from app.features.access.principal import Principal
from app.features.access.service import require_permission
from app.features.memberships.service import change_membership
from app.models import Business, BusinessMembership, User

ISSUER = "https://identity.test.invalid/auth/v1"


def seed(engine):
    with Session(engine) as db:
        db.add_all([Business(id="a", name="Hola Compra Vibes"), Business(id="b", name="Other")])
        db.add_all([User(id=name, auth_issuer=ISSUER, auth_subject=name)
                    for name in ("owner", "owner2", "admin", "member", "outsider")])
        db.flush()
        db.add_all([BusinessMembership(id=name, business_id="a", user_id=name, role=role)
                    for name, role in (("owner", "owner"), ("admin", "admin"), ("member", "member"))])
        db.add(BusinessMembership(id="b-owner", business_id="b", user_id="member", role="owner"))
        db.commit()


@pytest.fixture
def tenant_engine(isolated_client):
    _, engine = isolated_client
    seed(engine)
    return engine


@pytest.mark.parametrize("role", ["owner", "admin", "member", "unknown"])
@pytest.mark.parametrize("permission", list(Permission))
def test_permission_matrix(role, permission):
    member = {"read", "edit_content", "manage_campaigns", "use_sofia", "use_leo",
              "generate_media", "upload_media", "submit_for_approval"}
    admin = member | {
        "approve_content", "publish", "manage_connections", "manage_heygen_assets",
        "edit_business", "manage_members",
    }
    owner = admin | {"manage_admins", "manage_owners", "archive_business"}
    assert allows(role, permission) == (permission.value in {"owner": owner, "admin": admin, "member": member}.get(role, set()))


def test_unknown_permission_fails_closed():
    assert not allows("owner", "publish")
    assert not allows("owner", "future_permission")


def test_multi_business_identity_and_revocation(tenant_engine):
    principal = Principal(ISSUER, "member")
    with Session(tenant_engine) as db:
        assert require_permission(db, principal, "a", Permission.USE_SOFIA).role == "member"
        assert require_permission(db, principal, "b", Permission.PUBLISH).role == "owner"
        with pytest.raises(ApplicationError) as error:
            require_permission(db, principal, "a", Permission.PUBLISH)
        assert error.value.kind == ErrorKind.FORBIDDEN
        # Recheck even when an earlier authorization result exists in this session.
        change_membership(db, Principal(ISSUER, "owner"), "a", "member", role="member", status="revoked")
        with pytest.raises(ApplicationError) as error:
            require_permission(db, principal, "a", Permission.READ)
        assert error.value.kind == ErrorKind.NOT_FOUND
        assert require_permission(db, principal, "b", Permission.READ)


@pytest.mark.parametrize("subject,business,issuer", [
    ("outsider", "a", ISSUER), ("unknown", "a", ISSUER),
    ("owner", "missing", ISSUER), ("owner", "a", "https://wrong.invalid"),
])
def test_non_disclosing_denial(tenant_engine, subject, business, issuer):
    with Session(tenant_engine) as db, pytest.raises(ApplicationError) as error:
        require_permission(db, Principal(issuer, subject), business, Permission.READ)
    assert (error.value.kind, error.value.detail) == (ErrorKind.NOT_FOUND, "Business not found")


@pytest.mark.parametrize("state", ["suspended", "revoked", "disabled"])
def test_inactive_membership_or_user_denied(tenant_engine, state):
    with Session(tenant_engine) as db:
        if state == "disabled":
            db.get(User, "member").status = state
        else:
            db.get(BusinessMembership, "member").status = state
        db.commit()
        with pytest.raises(ApplicationError) as error:
            require_permission(db, Principal(ISSUER, "member"), "a", Permission.READ)
        assert error.value.kind == ErrorKind.NOT_FOUND


@pytest.mark.parametrize("role,status", [("member", "active"), ("owner", "revoked"), ("owner", "suspended")])
def test_last_owner_protected(tenant_engine, role, status):
    with Session(tenant_engine) as db:
        with pytest.raises(ApplicationError) as error:
            change_membership(db, Principal(ISSUER, "owner"), "a", "owner", role=role, status=status)
        assert error.value.kind == ErrorKind.CONFLICT
        owner = db.get(BusinessMembership, "owner")
        assert (owner.role, owner.status) == ("owner", "active")


@pytest.mark.parametrize("actor,target,role", [
    ("admin", "owner", "member"), ("admin", "admin", "member"),
    ("admin", "member", "admin"), ("member", "admin", "member"),
    ("member", "member", "owner"),
])
def test_cannot_escalate_or_manage_higher_roles(tenant_engine, actor, target, role):
    with Session(tenant_engine) as db, pytest.raises(ApplicationError) as error:
        change_membership(db, Principal(ISSUER, actor), "a", target, role=role, status="active")
    assert error.value.kind == ErrorKind.FORBIDDEN


def test_admin_can_remove_member_and_member_can_leave(tenant_engine):
    with Session(tenant_engine) as db:
        change_membership(db, Principal(ISSUER, "admin"), "a", "member", role="member", status="suspended")
        change_membership(db, Principal(ISSUER, "owner"), "a", "member", role="member", status="active")
        change_membership(db, Principal(ISSUER, "member"), "a", "member", role="member", status="revoked")
        assert db.get(BusinessMembership, "member").status == "revoked"


def test_cross_business_membership_id(tenant_engine):
    with Session(tenant_engine) as db, pytest.raises(ApplicationError) as error:
        change_membership(db, Principal(ISSUER, "owner"), "a", "b-owner", role="member", status="revoked")
    assert error.value.kind == ErrorKind.NOT_FOUND


def test_successor_owner_before_departure(tenant_engine):
    with Session(tenant_engine) as db:
        change_membership(db, Principal(ISSUER, "owner"), "a", "admin", role="owner", status="active")
        change_membership(db, Principal(ISSUER, "owner"), "a", "owner", role="owner", status="revoked")
        assert db.get(BusinessMembership, "admin").role == "owner"


@pytest.mark.parametrize("mutation", ["duplicate_identity", "duplicate_membership", "invalid_role", "invalid_status", "missing_user", "missing_business"])
def test_database_constraints(tenant_engine, mutation):
    with Session(tenant_engine) as db:
        if mutation == "duplicate_identity":
            db.add(User(auth_issuer=ISSUER, auth_subject="owner"))
        elif mutation == "duplicate_membership":
            db.add(BusinessMembership(business_id="a", user_id="owner", role="member"))
        elif mutation == "invalid_role":
            db.get(BusinessMembership, "member").role = "superadmin"
        elif mutation == "invalid_status":
            db.get(BusinessMembership, "member").status = "invited"
        else:
            db.add(BusinessMembership(business_id="missing" if mutation == "missing_business" else "a",
                                      user_id="missing" if mutation == "missing_user" else "owner2", role="member"))
        with pytest.raises(IntegrityError):
            db.commit()


def test_identity_creation_does_not_grant_access(tenant_engine):
    with Session(tenant_engine) as db:
        assert db.scalars(select(BusinessMembership).where(BusinessMembership.user_id == "outsider")).all() == []
        with pytest.raises(ApplicationError):
            require_permission(db, Principal(ISSUER, "outsider"), "a", Permission.READ)


def test_commit_failure_rolls_back(tenant_engine, monkeypatch):
    with Session(tenant_engine) as db:
        def fail():
            raise RuntimeError("commit failed")
        monkeypatch.setattr(db, "commit", fail)
        with pytest.raises(RuntimeError, match="commit failed"):
            change_membership(db, Principal(ISSUER, "owner"), "a", "member", role="member", status="revoked")
        assert db.get(BusinessMembership, "member").status == "active"


def test_disabled_second_owner_cannot_satisfy_last_owner_rule(tenant_engine):
    with Session(tenant_engine) as db:
        db.get(User, "owner2").status = "disabled"
        db.add(BusinessMembership(id="owner2", business_id="a", user_id="owner2", role="owner"))
        db.commit()
        with pytest.raises(ApplicationError) as error:
            change_membership(db, Principal(ISSUER, "owner"), "a", "owner", role="owner", status="revoked")
        assert error.value.kind == ErrorKind.CONFLICT


@pytest.mark.parametrize("role,status", [("superadmin", "active"), ("member", "invited")])
def test_invalid_membership_update_rejected(tenant_engine, role, status):
    with Session(tenant_engine) as db, pytest.raises(ApplicationError) as error:
        change_membership(db, Principal(ISSUER, "owner"), "a", "member", role=role, status=status)
    assert error.value.kind == ErrorKind.INVALID_INPUT


def test_can_remove_disabled_owner_when_active_owner_remains(tenant_engine):
    with Session(tenant_engine) as db:
        db.get(User, "owner2").status = "disabled"
        db.add(BusinessMembership(id="owner2", business_id="a", user_id="owner2", role="owner"))
        db.commit()
        change_membership(db, Principal(ISSUER, "owner"), "a", "owner2", role="owner", status="revoked")
        assert db.get(BusinessMembership, "owner").status == "active"
