from datetime import datetime, timedelta, timezone
import json
from unittest.mock import Mock

from httpx import Request, Response
from openai import AuthenticationError, RateLimitError
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
from app.features.onboarding.schemas import OnboardingActivation
from app.models import (
    AIUsageReservation,
    Business,
    CustomerEntitlement,
    CustomerOrganization,
    Conversation,
    Draft,
    ImageRevision,
    OnboardingProgress,
)
from tests.tenancy_fixtures import grant_test_owner


def _trial_limits(**overrides):
    limits = {
        "businesses": 1,
        "leo_generations": 20,
        "sofia_requests": 5,
        "edian_analyses": 5,
        "campaigns": 2,
        "heygen_generations": 0,
    }
    limits.update(overrides)
    return limits


def _create_trial_business(
    engine, monkeypatch, *, subject="customer-account", **limit_overrides,
):
    monkeypatch.setenv("TRIALS_ENABLED", "true")
    monkeypatch.setenv("TRIAL_LIMITS_JSON", json.dumps(_trial_limits(**limit_overrides)))
    with Session(engine) as db:
        principal = grant_test_owner(db, subject=subject)
        db.commit()
    with Session(engine) as db:
        business = business_service.create_business(
            BusinessCreate(name="Customer business"),
            db,
            principal=principal,
        )
        return principal, business.id


def _create_business_without_entitlement(engine):
    with Session(engine) as db:
        business = Business(name="Unentitled business")
        db.add(business)
        db.flush()
        principal = grant_test_owner(db, [business.id])
        db.commit()
        return principal, business.id


def test_legacy_limit_configuration_inherits_the_additive_edian_allowance(
    monkeypatch,
):
    legacy = _trial_limits()
    legacy.pop("edian_analyses")
    monkeypatch.setenv("TRIAL_LIMITS_JSON", json.dumps(legacy))
    monkeypatch.setenv("STRIPE_MONTHLY_LIMITS_JSON", json.dumps(legacy))

    assert entitlement_service.trial_limits()["edian_analyses"] == 5
    assert entitlement_service.monthly_subscription_limits()["edian_analyses"] == 25


def test_ai_permissions_reservations_and_routes_fail_closed_without_entitlement(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    principal, business_id = _create_business_without_entitlement(engine)
    chat = Mock(return_value="Must not be called")
    generate = Mock(return_value={})
    monkeypatch.setattr("app.features.content.adapters.chat_with_sofia", chat)
    monkeypatch.setattr(
        "app.features.content.generation_service.generate_marketing_content",
        generate,
    )

    with Session(engine) as db:
        assert require_permission(
            db, principal, business_id, Permission.READ,
        ).business_id == business_id
        for permission in (
            Permission.USE_SOFIA,
            Permission.USE_LEO,
            Permission.USE_EDIAN,
            Permission.GENERATE_MEDIA,
        ):
            with pytest.raises(ApplicationError) as denied:
                require_permission(db, principal, business_id, permission)
            assert denied.value.kind is ErrorKind.LIMIT_EXCEEDED
        with pytest.raises(ApplicationError) as reservation_denied:
            entitlement_service.reserve_usage(
                db,
                principal,
                business_id=business_id,
                metric="sofia_request",
                idempotency_key="missing-entitlement",
            )
        assert reservation_denied.value.kind is ErrorKind.LIMIT_EXCEEDED

    chat_response = client.post(
        f"/businesses/{business_id}/sofia/chat",
        json={"message": "Plan a campaign", "idempotency_key": "missing-entitlement"},
    )
    generation_response = client.post(
        f"/businesses/{business_id}/generate-content",
        json={"idempotency_key": "missing-entitlement-generation"},
    )

    assert chat_response.status_code == generation_response.status_code == 429
    assert chat_response.headers["x-error-code"] == "ai_entitlement_required"
    assert chat_response.json() == {
        "detail": "An active trial or subscription is required to use AI features.",
    }
    chat.assert_not_called()
    generate.assert_not_called()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(AIUsageReservation)) == 0
        assert db.scalar(select(func.count()).select_from(Conversation)) == 0
        assert db.scalar(select(func.count()).select_from(Draft)) == 0


def test_active_subscription_allows_ai_permission_and_usage_reservation(
    isolated_client, monkeypatch,
):
    _, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    now = datetime.now(timezone.utc)
    with Session(engine) as db:
        entitlement = entitlement_repository.entitlement_for_business(
            db, business_id,
        )
        entitlement.status = "active"
        entitlement.current_period_start = now - timedelta(days=1)
        entitlement.current_period_end = now + timedelta(days=29)
        entitlement.limits = _trial_limits(sofia_requests=1)
        db.commit()

    with Session(engine) as db:
        assert require_permission(
            db, principal, business_id, Permission.USE_SOFIA,
        ).business_id == business_id
        reservation, replay = entitlement_service.reserve_usage(
            db,
            principal,
            business_id=business_id,
            metric="sofia_request",
            idempotency_key="active-subscription-chat",
        )
        assert reservation is not None
        assert replay is False
        db.commit()
        entitlement_service.finish_usage(
            db, reservation.id, succeeded=True,
        )
        with pytest.raises(ApplicationError) as exhausted:
            entitlement_service.reserve_usage(
                db,
                principal,
                business_id=business_id,
                metric="sofia_request",
                idempotency_key="active-subscription-chat-2",
            )
        assert exhausted.value.kind is ErrorKind.LIMIT_EXCEEDED


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


def test_customer_onboarding_activates_one_trial_and_is_idempotent(
    isolated_client, monkeypatch,
):
    _, engine = isolated_client
    monkeypatch.setenv("TRIALS_ENABLED", "true")
    with Session(engine) as db:
        principal = grant_test_owner(db, subject="new-onboarding-customer")
        db.commit()
    request = OnboardingActivation(
        current_step=6,
        business_profile={"name": "Onboarded customer"},
        interface_language="es",
        conversation_language="en",
        marketing_content_language="es",
        social_accounts_skipped=True,
    )

    with Session(engine) as db:
        first = onboarding_service.activate_workspace(db, principal, request)
    with Session(engine) as db:
        second = onboarding_service.activate_workspace(db, principal, request)
        assert second.id == first.id
        organization = db.get(CustomerOrganization, first.customer_organization_id)
        entitlement = entitlement_repository.entitlement_for_organization(
            db, organization.id,
        )
        assert entitlement.status == "trialing"
        assert entitlement.trial_expires_at - entitlement.trial_started_at == timedelta(days=14)
        assert db.scalar(select(func.count()).select_from(CustomerEntitlement)) == 1
        progress = db.get(OnboardingProgress, principal.user_id)
        assert progress.completed_at is not None
        assert progress.business_id == first.id
        assert progress.data["social_accounts_skipped"] is True
        assert progress.data["interface_language"] == "es"


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
        with pytest.raises(ApplicationError) as reservation_blocked:
            entitlement_service.reserve_usage(
                db,
                principal,
                business_id=business_id,
                metric="sofia_request",
                idempotency_key="expired-trial-request",
            )
        assert reservation_blocked.value.kind is ErrorKind.LIMIT_EXCEEDED


@pytest.mark.parametrize("status", ["canceled", "past_due", "expired"])
def test_inactive_entitlements_cannot_reserve_ai_usage(
    isolated_client, monkeypatch, status,
):
    _, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    with Session(engine) as db:
        entitlement = entitlement_repository.entitlement_for_business(
            db, business_id,
        )
        entitlement.status = status
        entitlement.current_period_end = None
        db.commit()
        with pytest.raises(ApplicationError) as denied:
            entitlement_service.reserve_usage(
                db,
                principal,
                business_id=business_id,
                metric="sofia_request",
                idempotency_key=f"inactive-{status}",
            )
        assert denied.value.kind is ErrorKind.LIMIT_EXCEEDED


def test_failed_usage_reservation_never_calls_ai_provider(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    chat = Mock()
    generate = Mock()
    monkeypatch.setattr("app.features.content.adapters.chat_with_sofia", chat)
    monkeypatch.setattr(
        "app.features.content.generation_service.generate_marketing_content",
        generate,
    )
    monkeypatch.setattr(
        entitlement_service,
        "reserve_usage",
        Mock(side_effect=ApplicationError(
            ErrorKind.LIMIT_EXCEEDED, "Usage reservation unavailable",
        )),
    )

    chat_response = client.post(
        f"/businesses/{business_id}/sofia/chat",
        json={"message": "Plan a campaign", "idempotency_key": "failed-reservation-chat"},
    )
    generation_response = client.post(
        f"/businesses/{business_id}/generate-content",
        json={"idempotency_key": "failed-reservation-generation"},
    )

    assert chat_response.status_code == generation_response.status_code == 429
    assert chat_response.headers["x-error-code"] == "limit_exceeded"
    chat.assert_not_called()
    generate.assert_not_called()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Conversation)) == 0
        assert db.scalar(select(func.count()).select_from(Draft)) == 0


def test_exhausted_chat_quota_blocks_direct_api_before_provider_call(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    principal, business_id = _create_trial_business(
        engine, monkeypatch, sofia_requests=0,
    )
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    provider = Mock()
    monkeypatch.setattr("app.features.content.adapters.chat_with_sofia", provider)

    response = client.post(
        f"/businesses/{business_id}/sofia/chat",
        json={"message": "Plan a campaign", "idempotency_key": "exhausted-chat"},
    )

    assert response.status_code == 429
    assert response.headers["x-error-code"] == "ai_quota_exhausted"
    provider.assert_not_called()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(AIUsageReservation)) == 0


@pytest.mark.parametrize("workflow", ["chat", "generation"])
@pytest.mark.parametrize(
    "key",
    [None, "", "   ", "x" * 129],
    ids=["missing", "empty", "whitespace", "too-long"],
)
def test_missing_or_invalid_idempotency_key_denied_before_provider_call(
    isolated_client, monkeypatch, workflow, key,
):
    client, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    chat = Mock()
    generate = Mock()
    monkeypatch.setattr("app.features.content.adapters.chat_with_sofia", chat)
    monkeypatch.setattr(
        "app.features.content.generation_service.generate_marketing_content",
        generate,
    )
    payload = {"message": "Plan a campaign"} if workflow == "chat" else {}
    if key is not None:
        payload["idempotency_key"] = key
    endpoint = (
        f"/businesses/{business_id}/sofia/chat"
        if workflow == "chat"
        else f"/businesses/{business_id}/generate-content"
    )

    response = client.post(endpoint, json=payload)

    assert response.status_code == 400
    assert response.json() == {"detail": "A valid idempotency key is required"}
    chat.assert_not_called()
    generate.assert_not_called()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(AIUsageReservation)) == 0


def test_repeated_chat_request_with_same_key_reuses_billable_operation(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    provider = Mock(return_value="A safe planning reply")
    monkeypatch.setattr("app.features.content.adapters.chat_with_sofia", provider)
    request = {
        "message": "Help me plan",
        "idempotency_key": "same-billable-chat",
    }

    first = client.post(f"/businesses/{business_id}/sofia/chat", json=request)
    retry = client.post(f"/businesses/{business_id}/sofia/chat", json=request)

    assert first.status_code == retry.status_code == 200
    assert first.json() == retry.json()
    provider.assert_called_once()
    with Session(engine) as db:
        reservations = db.scalars(select(AIUsageReservation).where(
            AIUsageReservation.business_id == business_id,
            AIUsageReservation.metric == "sofia_request",
        )).all()
        assert len(reservations) == 1
        assert reservations[0].status == "succeeded"
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        assert entitlement_repository.count_usage(
            db, organization.id, "sofia_request",
        ) == 1


def test_repeated_generation_request_with_same_key_reuses_billable_operation(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    provider = Mock(return_value={
        "title": "A test draft",
        "caption": "A test caption",
        "platform": "Facebook",
        "image_prompt": "A test image prompt",
        "video_script": "A test video script",
    })
    monkeypatch.setattr(
        "app.features.content.generation_service.generate_marketing_content",
        provider,
    )
    request = {"idempotency_key": "same-billable-generation"}

    first = client.post(
        f"/businesses/{business_id}/generate-content", json=request,
    )
    retry = client.post(
        f"/businesses/{business_id}/generate-content", json=request,
    )

    assert first.status_code == retry.status_code == 201
    assert first.json()["id"] == retry.json()["id"]
    provider.assert_called_once()
    with Session(engine) as db:
        reservations = db.scalars(select(AIUsageReservation).where(
            AIUsageReservation.business_id == business_id,
        )).all()
        assert {reservation.metric for reservation in reservations} == {
            "leo_generation",
        }
        assert {reservation.status for reservation in reservations} == {"succeeded"}
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        assert entitlement_repository.count_usage(
            db, organization.id, "sofia_request",
        ) == 0
        assert entitlement_repository.count_usage(
            db, organization.id, "leo_generation",
        ) == 1
        assert db.scalar(select(func.count()).select_from(Draft).where(
            Draft.business_id == business_id,
        )) == 1


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


def test_trial_allows_exactly_five_organization_scoped_sofia_requests(
    isolated_client, monkeypatch,
):
    _, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    with Session(engine) as db:
        for index in range(5):
            reservation, replay = entitlement_service.reserve_usage(
                db,
                principal,
                business_id=business_id,
                metric="sofia_request",
                idempotency_key=f"sofia-{index}",
            )
            assert reservation is not None
            assert replay is False
            db.commit()
        with pytest.raises(ApplicationError) as exhausted:
            entitlement_service.reserve_usage(
                db,
                principal,
                business_id=business_id,
                metric="sofia_request",
                idempotency_key="sofia-sixth",
            )
        assert exhausted.value.kind is ErrorKind.LIMIT_EXCEEDED


def test_provider_authentication_failure_refunds_once_and_success_counts(
    isolated_client, monkeypatch, caplog,
):
    client, engine = isolated_client
    principal, business_id = _create_trial_business(
        engine, monkeypatch, subject="sofia-provider-auth-customer",
    )
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    provider = Mock()
    provider.side_effect = AuthenticationError(
        "sensitive provider response",
        response=Response(
            401,
            request=Request("POST", "https://api.openai.com/v1/responses"),
        ),
        body={"detail": "sensitive provider response"},
    )
    monkeypatch.setattr("app.features.content.adapters.chat_with_sofia", provider)

    failed = client.post(
        f"/businesses/{business_id}/sofia/chat",
        json={"message": "Help me plan", "idempotency_key": "auth-failure"},
    )

    assert failed.status_code == 502
    assert failed.json() == {"detail": "Sebastián could not respond. Please try again."}
    assert "sensitive provider response" not in failed.text
    assert "sensitive provider response" not in caplog.text
    with Session(engine) as db:
        reservation = db.scalar(select(AIUsageReservation).where(
            AIUsageReservation.business_id == business_id,
            AIUsageReservation.metric == "sofia_request",
        ))
        assert reservation is not None
        assert reservation.status == "failed"
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        assert entitlement_repository.count_usage(
            db, organization.id, "sofia_request",
        ) == 0

    replay = client.post(
        f"/businesses/{business_id}/sofia/chat",
        json={"message": "Help me plan", "idempotency_key": "auth-failure"},
    )
    assert replay.status_code == 409
    provider.assert_called_once()

    provider.side_effect = None
    provider.return_value = "A safe planning reply"
    succeeded = client.post(
        f"/businesses/{business_id}/sofia/chat",
        json={"message": "Help me plan", "idempotency_key": "successful-chat"},
    )
    assert succeeded.status_code == 200
    with Session(engine) as db:
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        assert entitlement_repository.count_usage(
            db, organization.id, "sofia_request",
        ) == 1


def test_provider_authentication_failure_releases_both_content_reservations(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    principal, business_id = _create_trial_business(
        engine, monkeypatch, subject="content-provider-auth-customer",
    )
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    monkeypatch.setattr(
        "app.features.content.generation_service.generate_marketing_content",
        Mock(side_effect=AuthenticationError(
            "provider authentication failed",
            response=Response(
                401,
                request=Request("POST", "https://api.openai.com/v1/responses"),
            ),
            body={},
        )),
    )

    failed = client.post(
        f"/businesses/{business_id}/generate-content",
        json={"idempotency_key": "content-auth-failure"},
    )

    assert failed.status_code == 502
    with Session(engine) as db:
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        reservations = db.scalars(select(AIUsageReservation).where(
            AIUsageReservation.business_id == business_id,
        )).all()
        assert {reservation.metric for reservation in reservations} == {
            "leo_generation",
        }
        assert {reservation.status for reservation in reservations} == {"failed"}
        assert entitlement_repository.count_usage(
            db, organization.id, "sofia_request",
        ) == 0
        assert entitlement_repository.count_usage(
            db, organization.id, "leo_generation",
        ) == 0


def test_valeria_generation_remains_available_when_sofia_quota_is_exhausted(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    principal, business_id = _create_trial_business(engine, monkeypatch)
    with Session(engine) as db:
        for metric, prefix in (
            ("sofia_request", "sofia-exhausted"),
            ("leo_generation", "valeria-used"),
        ):
            for index in range(5):
                reservation, replay = entitlement_service.reserve_usage(
                    db,
                    principal,
                    business_id=business_id,
                    metric=metric,
                    idempotency_key=f"{prefix}-{index}",
                )
                assert reservation is not None
                assert replay is False
                db.commit()
                entitlement_service.finish_usage(
                    db, reservation.id, succeeded=True,
                )
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        assert entitlement_repository.count_usage(
            db, organization.id, "sofia_request",
        ) == 5
        assert entitlement_repository.count_usage(
            db, organization.id, "leo_generation",
        ) == 5
        entitlement = db.scalar(select(CustomerEntitlement).where(
            CustomerEntitlement.organization_id == organization.id,
        ))
        assert entitlement is not None
        assert (
            entitlement.limits["leo_generations"]
            - entitlement_repository.count_usage(
                db, organization.id, "leo_generation",
            )
        ) == 15
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    provider = Mock(return_value={
        "title": "A test draft",
        "caption": "A test caption",
        "platform": "Facebook",
        "image_prompt": "A test image prompt",
        "video_script": "A test video script",
    })
    monkeypatch.setattr(
        "app.features.content.generation_service.generate_marketing_content",
        provider,
    )

    response = client.post(
        f"/businesses/{business_id}/generate-content",
        json={"idempotency_key": "valeria-independent-generation"},
    )

    assert response.status_code == 201
    provider.assert_called_once()
    with Session(engine) as db:
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        reservations = db.scalars(select(AIUsageReservation).where(
            AIUsageReservation.business_id == business_id,
        )).all()
        assert sum(
            reservation.metric == "sofia_request" for reservation in reservations
        ) == 5
        assert sum(
            reservation.metric == "leo_generation" for reservation in reservations
        ) == 6
        assert entitlement_repository.count_usage(
            db, organization.id, "sofia_request",
        ) == 5
        entitlement = db.scalar(select(CustomerEntitlement).where(
            CustomerEntitlement.organization_id == organization.id,
        ))
        assert entitlement is not None
        assert entitlement.limits["sofia_requests"] == 5
        assert entitlement_repository.count_usage(
            db, organization.id, "leo_generation",
        ) == 6
        assert entitlement.limits["leo_generations"] == 20


def test_provider_rate_limit_has_a_distinct_error_code(isolated_client, monkeypatch):
    client, engine = isolated_client
    principal, business_id = _create_trial_business(
        engine, monkeypatch, subject="provider-rate-limit-customer",
    )
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    monkeypatch.setattr(
        "app.features.content.adapters.chat_with_sofia",
        Mock(side_effect=RateLimitError(
            "provider limit reached",
            response=Response(
                429,
                request=Request("POST", "https://api.openai.com/v1/responses"),
            ),
            body={},
        )),
    )

    response = client.post(
        f"/businesses/{business_id}/sofia/chat",
        json={"message": "Help me plan", "idempotency_key": "provider-throttle"},
    )

    assert response.status_code == 502
    assert response.headers["x-error-code"] == "provider_rate_limited"
    assert "429" not in response.json()["detail"]


def test_trial_disables_image_generation_and_revisions_before_provider_calls(
    isolated_client, monkeypatch,
):
    from unittest.mock import Mock

    client, engine = isolated_client
    principal, business_id = _create_trial_business(
        engine, monkeypatch, subject="trial-media-customer",
    )
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    draft_id = "trial-image-draft"
    with Session(engine) as db:
        db.add(Draft(
            id=draft_id,
            business_id=business_id,
            title="Trial draft",
            caption="Caption",
            platform="facebook",
            status="pending",
            image_prompt="A product on a blue background",
            image_status="completed",
            image_url=f"businesses/{business_id}/original.png",
        ))
        db.commit()

    generate = Mock(return_value=f"businesses/{business_id}/generated.png")
    edit = Mock(return_value=f"businesses/{business_id}/revised.png")
    monkeypatch.setattr(
        "app.features.media.workflows_service.generate_marketing_image", generate,
    )
    monkeypatch.setattr(
        "app.features.media.workflows_service.edit_marketing_image", edit,
    )

    generated = client.post(f"/drafts/{draft_id}/generate-image")
    revised = client.post(
        f"/drafts/{draft_id}/image-revisions",
        json={"instructions": "Change the background"},
    )

    assert generated.status_code == 429
    assert revised.status_code == 429
    assert generated.json()["detail"] == (
        "AI image generation and editing are not available during the free trial."
    )
    generate.assert_not_called()
    edit.assert_not_called()
    with Session(engine) as db:
        draft = db.get(Draft, draft_id)
        assert draft.image_url == f"businesses/{business_id}/original.png"
        assert db.query(ImageRevision).filter_by(draft_id=draft_id).count() == 0


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
