from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

from sqlalchemy.orm import Session

from app.auth import SUPABASE_ISSUER
from app.errors import ApplicationError, ErrorKind
from app.features.access.principal import AuthenticatedPrincipal
from app.features.entitlements import repository as entitlement_repository
from app.features.entitlements import service as entitlement_service
from app.models import Business, BusinessMembership, CustomerEntitlement, CustomerOrganization, User
from tests.test_tenant_foundation_postgres import postgres_database


def _trial_data(engine):
    with Session(engine) as db:
        user = User(auth_issuer=SUPABASE_ISSUER, auth_subject="usage-trial-customer")
        db.add(user)
        db.flush()
        organization = CustomerOrganization(owner_user_id=user.id)
        db.add(organization)
        db.flush()
        business = Business(name="Usage Trial", customer_organization_id=organization.id)
        db.add(business)
        db.flush()
        db.add(BusinessMembership(
            business_id=business.id, user_id=user.id, role="owner", status="active",
        ))
        now = datetime.now(timezone.utc)
        db.add(CustomerEntitlement(
            organization_id=organization.id,
            status="trialing",
            trial_started_at=now,
            trial_expires_at=now + timedelta(days=14),
            limits={
                "businesses": 1,
                "leo_generations": 1,
                "sofia_requests": 1,
                "campaigns": 2,
                "heygen_generations": 0,
            },
        ))
        db.commit()
        return AuthenticatedPrincipal(SUPABASE_ISSUER, user.auth_subject, user.id), business.id


def test_concurrent_ai_reservations_cannot_exceed_trial_allowance(postgres_database, monkeypatch):
    engine, migrate = postgres_database
    migrate("head")
    principal, business_id = _trial_data(engine)
    monkeypatch.setenv("ALLOWED_USER_ID", "operator")
    barrier = Barrier(2)

    def reserve(key):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                record, replay = entitlement_service.reserve_usage(
                    db,
                    principal,
                    business_id=business_id,
                    metric="leo_generation",
                    idempotency_key=key,
                )
                db.commit()
                return record.id, replay
            except ApplicationError as exc:
                db.rollback()
                if exc.kind is ErrorKind.LIMIT_EXCEEDED:
                    return None
                raise

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(reserve, ("concurrent-a", "concurrent-b")))

    assert sum(result is not None for result in results) == 1
    successful_key = "concurrent-a" if results[0] is not None else "concurrent-b"
    with Session(engine) as db:
        record, replay = entitlement_service.reserve_usage(
            db,
            principal,
            business_id=business_id,
            metric="leo_generation",
            idempotency_key=successful_key,
        )
        assert replay is True
        assert record.id == (results[0] if results[0] is not None else results[1])[0]


def test_authentication_refund_is_idempotent_and_restores_one_concurrent_slot(
    postgres_database, monkeypatch,
):
    engine, migrate = postgres_database
    migrate("head")
    principal, business_id = _trial_data(engine)
    monkeypatch.setenv("ALLOWED_USER_ID", "operator")

    with Session(engine) as db:
        failed, replay = entitlement_service.reserve_usage(
            db,
            principal,
            business_id=business_id,
            metric="sofia_request",
            idempotency_key="authentication-failure",
        )
        assert replay is False
        organization_id = failed.organization_id
        db.commit()
        entitlement_service.release_usage_for_nonbillable_failure(
            db, [failed.id],
        )
        entitlement_service.release_usage_for_nonbillable_failure(
            db, [failed.id],
        )
        assert entitlement_repository.count_usage(
            db, organization_id, "sofia_request",
        ) == 0

    barrier = Barrier(2)

    def reserve(key):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                record, replay = entitlement_service.reserve_usage(
                    db,
                    principal,
                    business_id=business_id,
                    metric="sofia_request",
                    idempotency_key=key,
                )
                db.commit()
                return record.id, replay
            except ApplicationError as exc:
                db.rollback()
                if exc.kind is ErrorKind.LIMIT_EXCEEDED:
                    return None
                raise

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(reserve, ("after-refund-a", "after-refund-b")))

    assert sum(result is not None for result in results) == 1
    with Session(engine) as db:
        assert entitlement_repository.count_usage(
            db, organization_id, "sofia_request",
        ) == 1
