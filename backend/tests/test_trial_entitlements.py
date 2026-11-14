from datetime import datetime, timedelta, timezone
import json

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access.permissions import Permission
from app.features.access.service import require_permission
from app.features.businesses import service as business_service
from app.features.businesses.schemas import BusinessCreate
from app.features.entitlements import repository as entitlement_repository
from app.features.entitlements import service as entitlement_service
from app.features.media import usage_service as heygen_usage_service
from app.features.onboarding import service as onboarding_service
from app.models import Business, CustomerEntitlement, CustomerOrganization
from tests.tenancy_fixtures import grant_test_owner


def _trial_limits(**overrides):
    limits = {
        "businesses": 1,
        "leo_generations": 20,
        "sofia_requests": 2,
        "campaigns": 2,
        "heygen_generations": 0,
    }
    limits.update(overrides)
    return limits


def _create_trial_business(engine, monkeypatch, **limit_overrides):
    monkeypatch.setenv("TRIALS_ENABLED", "true")
    monkeypatch.setenv("TRIAL_LIMITS_JSON", json.dumps(_trial_limits(**limit_overrides)))
    with Session(engine) as db:
        principal = grant_test_owner(db, subject="customer-account")
        db.commit()
    with Session(engine) as db:
        business = business_service.create_business(
            BusinessCreate(name="Customer business"),
            db,
            principal=principal,
        )
        return principal, business.id


def test_trial_starts_on_first_workspace_and_prevents_another_business(isolated_client, monkeypatch):
    _, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    with Session(engine) as db:
        business = db.get(Business, business_id)
        organization = db.get(CustomerOrganization, business.customer_organization_id)
        entitlement = entitlement_repository.entitlement_for_organization(db, organization.id)
        assert entitlement.status == "trialing"
        assert entitlement.trial_expires_at - entitlement.trial_started_at == timedelta(days=14)
        assert entitlement.limits == _trial_limits()
        with pytest.raises(ApplicationError) as second_workspace:
            business_service.create_business(
                BusinessCreate(name="Second business"),
                db,
                principal=principal,
            )
        assert second_workspace.value.kind is ErrorKind.LIMIT_EXCEEDED
        assert db.scalar(select(func.count()).select_from(Business)) == 1
        with pytest.raises(ApplicationError) as repeated_trial:
            entitlement_service.activate_trial(db, organization.id)
        assert repeated_trial.value.kind is ErrorKind.CONFLICT


def test_expired_trial_preserves_reads_and_business_settings_but_blocks_mutations(isolated_client, monkeypatch):
    _, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    with Session(engine) as db:
        entitlement = entitlement_repository.entitlement_for_business(db, business_id)
        expired_at = datetime.now(timezone.utc) - timedelta(days=1)
        entitlement.trial_started_at = expired_at - timedelta(days=14)
        entitlement.trial_expires_at = expired_at
        db.commit()
        assert require_permission(db, principal, business_id, Permission.READ).business_id == business_id
        assert require_permission(db, principal, business_id, Permission.EDIT_BUSINESS).business_id == business_id
        assert require_permission(
            db, principal, business_id, Permission.PUBLISH,
        ).business_id == business_id
        with pytest.raises(ApplicationError) as publish_blocked:
            entitlement_service.assert_publishing_allowed(db, business_id)
        assert publish_blocked.value.kind is ErrorKind.LIMIT_EXCEEDED
        for permission in (Permission.USE_SOFIA, Permission.USE_LEO, Permission.MANAGE_CAMPAIGNS):
            with pytest.raises(ApplicationError) as blocked:
                require_permission(db, principal, business_id, permission)
            assert blocked.value.kind is ErrorKind.LIMIT_EXCEEDED


def test_usage_is_idempotent_concurrency_safe_and_conservatively_accounted(isolated_client, monkeypatch):
    _, engine = isolated_client
    principal, business_id = _create_trial_business(
        engine, monkeypatch, leo_generations=1, sofia_requests=2,
    )
    with Session(engine) as db:
        first, replay = entitlement_service.reserve_usage(
            db, principal, business_id=business_id, metric="leo_generation",
            idempotency_key="same-generation",
        )
        assert replay is False
        first_id = first.id
        db.commit()
    with Session(engine) as db:
        duplicate, replay = entitlement_service.reserve_usage(
            db, principal, business_id=business_id, metric="leo_generation",
            idempotency_key="same-generation",
        )
        assert replay is True
        assert duplicate.id == first_id
        db.commit()
        entitlement_service.finish_usage(db, first_id, succeeded=True, result_id="draft-id")
        with pytest.raises(ApplicationError) as exhausted:
            entitlement_service.reserve_usage(
                db, principal, business_id=business_id, metric="leo_generation",
                idempotency_key="new-generation",
            )
        assert exhausted.value.kind is ErrorKind.LIMIT_EXCEEDED

        released, replay = entitlement_service.reserve_usage(
            db, principal, business_id=business_id, metric="sofia_request",
            idempotency_key="not-sent",
        )
        assert not replay
        db.commit()
        entitlement_service.release_usage_before_provider_call(db, released.id)
        assert entitlement_repository.count_usage(
            db, entitlement_repository.organization_for_business(db, business_id).id,
            "sofia_request",
        ) == 0

        uncertain, _ = entitlement_service.reserve_usage(
            db, principal, business_id=business_id, metric="sofia_request",
            idempotency_key="provider-outcome-unknown",
        )
        db.commit()
        entitlement_service.finish_usage(db, uncertain.id, succeeded=False)
        assert entitlement_repository.usage_reservation(db, uncertain.id).status == "uncertain"
        assert entitlement_repository.count_usage(
            db, entitlement_repository.organization_for_business(db, business_id).id,
            "sofia_request",
        ) == 1


def test_trial_heygen_zero_limit_overrides_operator_allowance(isolated_client, monkeypatch):
    _, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    monkeypatch.setenv(
        "HEYGEN_BUSINESS_ALLOWANCES",
        json.dumps({
            business_id: {
                "max_generations": 100,
                "max_script_characters": 5000,
                "max_concurrent_jobs": 10,
            },
        }),
    )
    with Session(engine) as db:
        context = require_permission(
            db, principal, business_id, Permission.GENERATE_MEDIA, lock=True,
        )
        with pytest.raises(ApplicationError) as blocked:
            heygen_usage_service.require_capacity(db, context, "A test script")
        assert blocked.value.kind is ErrorKind.LIMIT_EXCEEDED


def test_trial_status_reports_heygen_attempt_usage(isolated_client, monkeypatch):
    _, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    monkeypatch.setattr(heygen_usage_service, "attempt_count", lambda *_: 3)
    with Session(engine) as db:
        status = onboarding_service.entitlement_status(db, principal, business_id)
    assert status["usage"]["heygen_generations"] == {"used": 3, "limit": 0}
