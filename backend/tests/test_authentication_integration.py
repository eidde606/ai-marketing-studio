"""Real JWT signatures and dependency wiring, with offline JWKS key selection."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
import jwt
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import auth
from app.database import get_db
from app.errors import ApplicationError, ErrorKind
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal, Principal
from app.features.access.service import require_permission, resolve_principal
from app.http_errors import http_error
from app.models import Business, BusinessMembership, User


@pytest.fixture(scope="module")
def signing_keys():
    return {
        "RS256": rsa.generate_private_key(public_exponent=65537, key_size=2048),
        "ES256": ec.generate_private_key(ec.SECP256R1()),
    }


@pytest.fixture
def signed_token(signing_keys, monkeypatch):
    def key_for_token(token):
        algorithm = jwt.get_unverified_header(token)["alg"]
        key = signing_keys.get(algorithm, signing_keys["RS256"])
        return SimpleNamespace(key=key.public_key())

    monkeypatch.setattr(auth.jwks_client, "get_signing_key_from_jwt", key_for_token)

    def make(*, algorithm="RS256", changes=None, omit=(), key=None):
        now = datetime.now(timezone.utc)
        payload = {
            "iss": auth.SUPABASE_ISSUER,
            "sub": auth.ALLOWED_USER_ID,
            "aud": "authenticated",
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "email": "not-an-identity-key@example.invalid",
        }
        payload.update(changes or {})
        for claim in omit:
            payload.pop(claim, None)
        return jwt.encode(payload, key or signing_keys[algorithm], algorithm=algorithm)
    return make


def headers(token):
    return {"Authorization": f"Bearer {token}"}


def add_user(engine, *, status="active", subject=None):
    with Session(engine) as db:
        db.add(User(id="application-user", auth_issuer=auth.SUPABASE_ISSUER,
                    auth_subject=subject or auth.ALLOWED_USER_ID, status=status))
        db.commit()


@pytest.fixture
def auth_client(isolated_client):
    client, engine = isolated_client
    # Exercise the production dependency chain instead of the legacy test override.
    client.app.dependency_overrides.pop(auth.verify_token)
    client.app.dependency_overrides.pop(auth.get_authenticated_principal)
    # This security suite provisions each identity explicitly (including absence).
    from sqlalchemy import delete
    with Session(engine) as db:
        db.execute(delete(User))
        db.commit()
    return client, engine


@pytest.fixture
def boundary_client(auth_client):
    client, engine = auth_client
    app = FastAPI()
    app.dependency_overrides[get_db] = client.app.dependency_overrides[get_db]

    @app.get("/identity")
    def identity(principal: AuthenticatedPrincipal = Depends(auth.get_authenticated_principal)):
        return {"user_id": principal.user_id, "subject": principal.subject, "issuer": principal.issuer}

    @app.get("/businesses/{business_id}/context")
    def business_context(
        business_id: str,
        permission: Permission = Permission.READ,
        principal: AuthenticatedPrincipal = Depends(auth.get_authenticated_principal),
        db: Session = Depends(get_db),
    ):
        try:
            return require_permission(db, principal, business_id, permission)
        except ApplicationError as exc:
            raise http_error(exc) from exc

    @app.get("/legacy-claims")
    def legacy_claims(payload: dict = Depends(auth.verify_token)):
        return payload

    with TestClient(app) as test_client:
        yield test_client, engine


@pytest.mark.parametrize("algorithm", ["RS256", "ES256"])
def test_signed_identity_resolution(boundary_client, signed_token, algorithm):
    client, engine = boundary_client
    add_user(engine)
    token = signed_token(algorithm=algorithm)
    response = client.get("/identity", headers=headers(token))
    assert response.status_code == 200
    assert response.json() == {"user_id": "application-user", "subject": auth.ALLOWED_USER_ID,
                               "issuer": auth.SUPABASE_ISSUER}
    claims = client.get("/legacy-claims", headers=headers(token)).json()
    assert claims == jwt.decode(token, options={"verify_signature": False})
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(BusinessMembership)) == 0


@pytest.mark.parametrize("authorization", [None, "Basic abc", "Bearer", "Bearer malformed"])
def test_missing_or_invalid_authentication(auth_client, authorization):
    client, _ = auth_client
    response = client.get("/businesses", headers={} if authorization is None else {"Authorization": authorization})
    assert response.status_code == 401


@pytest.mark.parametrize("claim,value", [
    ("iss", "https://other.invalid/auth/v1"), ("aud", "other-audience"),
    ("sub", 123), ("exp", 0), ("iat", 9999999999), ("nbf", 9999999999),
])
def test_invalid_claims_denied_before_user_resolution(auth_client, signed_token, monkeypatch, claim, value):
    client, _ = auth_client
    def unexpected(*args, **kwargs):
        pytest.fail("Invalid JWT reached application-user resolution")
    monkeypatch.setattr(auth.access_service, "resolve_principal", unexpected)
    assert client.get("/businesses", headers=headers(signed_token(changes={claim: value}))).status_code == 401


@pytest.mark.parametrize("claim", ["iss", "aud", "sub", "exp", "iat"])
def test_required_claims(auth_client, signed_token, claim):
    client, _ = auth_client
    assert client.get("/businesses", headers=headers(signed_token(omit=(claim,)))).status_code == 401


def test_wrong_signature_rejected(auth_client, signed_token):
    client, _ = auth_client
    wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert client.get("/businesses", headers=headers(signed_token(key=wrong_key))).status_code == 401


def test_disallowed_algorithm(auth_client, signed_token):
    client, _ = auth_client
    token = signed_token(algorithm="HS256", key="test-only-hmac-secret-at-least-32-bytes")
    assert client.get("/businesses", headers=headers(token)).status_code == 401


def test_key_lookup_unavailable_is_not_authorized(auth_client, signed_token, monkeypatch):
    client, _ = auth_client
    token = signed_token()
    def unavailable(*args):
        raise OSError("JWKS unavailable")
    monkeypatch.setattr(auth.jwks_client, "get_signing_key_from_jwt", unavailable)
    assert client.get("/businesses", headers=headers(token)).status_code == 503


@pytest.mark.parametrize("state", ["unknown", "disabled"])
def test_unknown_and_disabled_users_cannot_read_existing_businesses(auth_client, signed_token, state):
    client, engine = auth_client
    if state == "disabled":
        add_user(engine, status="disabled")
    with Session(engine) as db:
        db.add(Business(id="legacy", name="Hola Compra Vibes"))
        db.commit()
    response = client.get("/businesses", headers=headers(signed_token()))
    assert response.status_code == 403
    assert response.json() == {"detail": "Application access denied"}
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(User)) == (state == "disabled")
        assert db.scalar(select(func.count()).select_from(BusinessMembership)) == 0


def test_active_customer_does_not_inherit_operator_memberships(auth_client, signed_token):
    client, engine = auth_client
    add_user(engine)
    with Session(engine) as db:
        db.add(User(
            id="customer-user",
            auth_issuer=auth.SUPABASE_ISSUER,
            auth_subject="other-subject",
            status="active",
        ))
        db.add(Business(id="a", name="Other business"))
        db.flush()
        db.add(BusinessMembership(business_id="a", user_id="application-user", role="owner"))
        db.commit()
    response = client.get("/businesses", headers=headers(signed_token(changes={"sub": "other-subject"})))
    assert response.status_code == 200
    assert response.json() == []


def test_existing_business_response_contract(auth_client, signed_token):
    client, engine = auth_client
    add_user(engine)
    created = client.post("/businesses", json={"name": "Hola Compra Vibes"}, headers=headers(signed_token()))
    assert created.status_code == 201
    response = client.get("/businesses", headers=headers(signed_token()))
    assert response.status_code == 200
    assert response.json() == [created.json()]
    # Only the newly created business receives an owner membership.
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(BusinessMembership)) == 1


@pytest.mark.parametrize("status", [None, "suspended", "revoked"])
def test_business_context_denies_inactive_memberships(boundary_client, signed_token, status):
    client, engine = boundary_client
    add_user(engine)
    with Session(engine) as db:
        db.add(Business(id="a", name="Business A"))
        db.flush()
        if status:
            db.add(BusinessMembership(business_id="a", user_id="application-user", role="owner", status=status))
        db.commit()
    for business_id in ("a", "missing"):
        response = client.get(f"/businesses/{business_id}/context", headers=headers(signed_token()))
        assert response.status_code == 404
        assert response.json() == {"detail": "Business not found"}


def test_multi_business_roles_and_revocation(boundary_client, signed_token):
    client, engine = boundary_client
    add_user(engine)
    with Session(engine) as db:
        db.add_all([Business(id="a", name="A"), Business(id="b", name="B")])
        db.flush()
        db.add_all([BusinessMembership(id=business, business_id=business, user_id="application-user", role=role)
                    for business, role in (("a", "member"), ("b", "admin"))])
        db.commit()
    # JWT/client-selected roles and tenant IDs are never permission grants.
    token = signed_token(changes={"role": "owner", "user_id": "forged", "business_id": "b"})
    assert client.get("/businesses/a/context?permission=use_sofia", headers=headers(token)).status_code == 200
    assert client.get("/businesses/a/context?permission=use_leo", headers=headers(token)).status_code == 200
    assert client.get("/businesses/a/context?permission=publish", headers=headers(token)).status_code == 403
    assert client.get("/businesses/b/context?permission=publish", headers=headers(token)).status_code == 200
    with Session(engine) as db:
        db.get(BusinessMembership, "b").status = "revoked"
        db.commit()
    assert client.get("/businesses/b/context", headers=headers(token)).status_code == 404
    with Session(engine) as db:
        db.get(User, "application-user").status = "disabled"
        db.commit()
    assert client.get("/identity", headers=headers(token)).status_code == 403


def test_no_cached_account_status_or_user_id_substitution(auth_client):
    _, engine = auth_client
    add_user(engine)
    with Session(engine) as db:
        db.add(Business(id="a", name="A"))
        db.flush()
        db.add(BusinessMembership(business_id="a", user_id="application-user", role="owner"))
        db.commit()
        principal = resolve_principal(db, Principal(auth.SUPABASE_ISSUER, auth.ALLOWED_USER_ID))
        assert require_permission(db, principal, "a", Permission.READ)
        with pytest.raises(ApplicationError) as error:
            require_permission(db, replace(principal, user_id="another-user"), "a", Permission.READ)
        assert error.value.kind == ErrorKind.NOT_FOUND
        db.get(User, "application-user").status = "disabled"
        db.commit()
        with pytest.raises(ApplicationError) as error:
            require_permission(db, principal, "a", Permission.READ)
        assert error.value.kind == ErrorKind.NOT_FOUND


def test_dependency_cache_is_request_local(boundary_client, signed_token, monkeypatch):
    client, engine = boundary_client
    add_user(engine)
    calls = {"jwt": 0, "principal": 0}
    original_key_lookup = auth.jwks_client.get_signing_key_from_jwt
    original_resolver = auth.access_service.resolve_principal

    def lookup(token):
        calls["jwt"] += 1
        return original_key_lookup(token)

    def resolve(db, identity):
        calls["principal"] += 1
        return original_resolver(db, identity)

    monkeypatch.setattr(auth.jwks_client, "get_signing_key_from_jwt", lookup)
    monkeypatch.setattr(auth.access_service, "resolve_principal", resolve)
    token = signed_token()
    for count in (1, 2):
        assert client.get("/legacy-claims", headers=headers(token)).status_code == 200
        assert calls == {"jwt": count, "principal": count}
