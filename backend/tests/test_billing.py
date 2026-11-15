import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import auth
from app.errors import ApplicationError
from app.features.access.principal import AuthenticatedPrincipal
from app.features.billing import stripe_gateway
from app.features.entitlements import service as entitlement_service
from app.models import (
    Business,
    BusinessMembership,
    CustomerEntitlement,
    CustomerOrganization,
    StripeWebhookEvent,
    User,
)

_WEBHOOK_SECRET = "whsec_billing_test_secret"
_PRICE_ID = "price_test_monthly"


def _workspace(engine, *, business_id="billing-business", customer_id=None):
    with Session(engine) as db:
        user = db.scalar(
            select(User).where(
                User.auth_issuer == auth.SUPABASE_ISSUER,
                User.auth_subject == auth.ALLOWED_USER_ID,
            )
        )
        org = CustomerOrganization(owner_user_id=user.id)
        db.add(org)
        db.flush()
        db.add(Business(
            id=business_id,
            name=business_id,
            customer_organization_id=org.id,
        ))
        db.add(BusinessMembership(
            business_id=business_id,
            user_id=user.id,
            role="owner",
            status="active",
        ))
        db.add(CustomerEntitlement(
            organization_id=org.id,
            status="trialing",
            trial_started_at=datetime.now(timezone.utc),
            trial_expires_at=datetime.now(timezone.utc) + timedelta(days=14),
            limits={
                "businesses": 1,
                "leo_generations": 20,
                "sofia_requests": 0,
                "campaigns": 2,
                "heygen_generations": 0,
            },
            stripe_customer_id=customer_id,
        ))
        db.commit()
        return org.id, AuthenticatedPrincipal(
            auth.SUPABASE_ISSUER, auth.ALLOWED_USER_ID, user.id,
        )


def _signed_event(event, *, secret=_WEBHOOK_SECRET, timestamp=None):
    raw = json.dumps(event, separators=(",", ":")).encode()
    timestamp = timestamp or int(time.time())
    digest = hmac.new(
        secret.encode(),
        str(timestamp).encode() + b"." + raw,
        hashlib.sha256,
    ).hexdigest()
    return raw, f"t={timestamp},v1={digest}"


def _subscription_event(
    event_id,
    *,
    org_id,
    business_id,
    customer_id="cus_billing",
    subscription_id="sub_billing",
    status="active",
    event_type="customer.subscription.created",
):
    now = int(time.time())
    return {
        "id": event_id,
        "type": event_type,
        "livemode": False,
        "data": {
            "object": {
                "id": subscription_id,
                "customer": customer_id,
                "status": status,
                "metadata": {
                    "organization_id": org_id,
                    "business_id": business_id,
                },
                "current_period_start": now,
                "current_period_end": now + 30 * 24 * 60 * 60,
                "cancel_at_period_end": False,
                "items": {"data": [{"price": {"id": _PRICE_ID}}]},
            },
        },
    }


def _enable_stripe(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_billing_only")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", _WEBHOOK_SECRET)
    monkeypatch.setenv("STRIPE_MONTHLY_PRICE_ID", _PRICE_ID)
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://studio.example.test")


def test_webhook_rejects_bad_signatures_and_live_mode(isolated_client, monkeypatch):
    client, _ = isolated_client
    _enable_stripe(monkeypatch)
    event = {
        "id": "evt_bad",
        "type": "checkout.session.completed",
        "livemode": False,
        "data": {"object": {}},
    }
    raw, signature = _signed_event(event)
    bad = client.post(
        "/webhooks/stripe",
        content=raw,
        headers={"Stripe-Signature": signature.replace("v1=", "v1=bad")},
    )
    assert bad.status_code == 400

    live_event = {**event, "id": "evt_live", "livemode": True}
    live_raw, live_signature = _signed_event(live_event)
    response = client.post(
        "/webhooks/stripe",
        content=live_raw,
        headers={"Stripe-Signature": live_signature},
    )
    assert response.status_code == 400


def test_subscription_webhook_is_tenant_bound_and_idempotent(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    _enable_stripe(monkeypatch)
    monkeypatch.setenv(
        "STRIPE_MONTHLY_LIMITS_JSON",
        '{"businesses":1,"leo_generations":1,"sofia_requests":1,'
        '"campaigns":1,"heygen_generations":0}',
    )
    organization_id, principal = _workspace(engine)
    event = _subscription_event(
        "evt_subscription_created",
        org_id=organization_id,
        business_id="billing-business",
    )
    raw, signature = _signed_event(event)

    response = client.post(
        "/webhooks/stripe",
        content=raw,
        headers={"Stripe-Signature": signature},
    )
    assert response.status_code == 200
    assert response.json() == {
        "received": True, "duplicate": False, "processed": True,
    }
    with Session(engine) as db:
        entitlement = db.scalar(select(CustomerEntitlement))
        assert entitlement.status == "active"
        assert entitlement.stripe_customer_id == "cus_billing"
        assert entitlement.stripe_subscription_id == "sub_billing"
        assert entitlement.stripe_price_id == _PRICE_ID
        assert entitlement.limits["leo_generations"] == 1
        reservation, replay = entitlement_service.reserve_usage(
            db,
            principal,
            business_id="billing-business",
            metric="leo_generation",
            idempotency_key="monthly-limit-first",
        )
        assert reservation is not None
        assert replay is False
        with pytest.raises(ApplicationError):
            entitlement_service.reserve_usage(
                db,
                principal,
                business_id="billing-business",
                metric="leo_generation",
                idempotency_key="monthly-limit-second",
            )

    changed_event = {
        **event,
        "data": {
            "object": {
                **event["data"]["object"],
                "status": "canceled",
            },
        },
    }
    changed_raw, changed_signature = _signed_event(changed_event)
    duplicate = client.post(
        "/webhooks/stripe",
        content=changed_raw,
        headers={"Stripe-Signature": changed_signature},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(StripeWebhookEvent)) == 1


def test_subscription_updates_and_cancellation_follow_stripe_state(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    _enable_stripe(monkeypatch)
    organization_id, _ = _workspace(engine, customer_id="cus_billing")
    event = _subscription_event(
        "evt_subscription_created",
        org_id=organization_id,
        business_id="billing-business",
    )
    event["created"] = int(time.time())
    raw, signature = _signed_event(event)
    assert client.post(
        "/webhooks/stripe",
        content=raw,
        headers={"Stripe-Signature": signature},
    ).json()["processed"] is True

    updated_event = {
        **event,
        "id": "evt_subscription_updated",
        "type": "customer.subscription.updated",
        "created": event["created"] + 1,
        "data": {
            "object": {
                **event["data"]["object"],
                "cancel_at_period_end": True,
            },
        },
    }
    raw, signature = _signed_event(updated_event)
    assert client.post(
        "/webhooks/stripe",
        content=raw,
        headers={"Stripe-Signature": signature},
    ).json()["processed"] is True
    with Session(engine) as db:
        entitlement = db.scalar(select(CustomerEntitlement))
        assert entitlement.status == "active"
        assert entitlement.cancel_at_period_end is True

    deleted_event = {
        **updated_event,
        "id": "evt_subscription_deleted",
        "type": "customer.subscription.deleted",
        "created": event["created"] + 2,
        "data": {
            "object": {
                **updated_event["data"]["object"],
                "status": "canceled",
                "cancel_at_period_end": False,
            },
        },
    }
    raw, signature = _signed_event(deleted_event)
    assert client.post(
        "/webhooks/stripe",
        content=raw,
        headers={"Stripe-Signature": signature},
    ).json()["processed"] is True
    with Session(engine) as db:
        entitlement = db.scalar(select(CustomerEntitlement))
        assert entitlement.status == "canceled"
        assert entitlement_service.effective_status(entitlement) == "canceled"
        assert entitlement.cancel_at_period_end is False


def test_webhook_cannot_bind_another_tenant_customer(isolated_client, monkeypatch):
    client, engine = isolated_client
    _enable_stripe(monkeypatch)
    organization_a, _ = _workspace(engine, business_id="business-a")

    with Session(engine) as db:
        user = db.scalar(
            select(User).where(User.auth_subject == auth.ALLOWED_USER_ID)
        )
        org_b = CustomerOrganization(owner_user_id=user.id + "-other")
        # A distinct owner is required by the organization uniqueness constraint.
        other_user = User(
            id=user.id + "-other",
            auth_issuer=auth.SUPABASE_ISSUER,
            auth_subject="another-customer",
            status="active",
        )
        db.add(other_user)
        db.flush()
        org_b.owner_user_id = other_user.id
        db.add(org_b)
        db.flush()
        db.add(Business(
            id="business-b", name="Business B", customer_organization_id=org_b.id,
        ))
        db.add(CustomerEntitlement(
            organization_id=org_b.id,
            status="trialing",
            trial_started_at=datetime.now(timezone.utc),
            trial_expires_at=datetime.now(timezone.utc) + timedelta(days=14),
            stripe_customer_id="cus_other_tenant",
            limits={"businesses": 1},
        ))
        db.commit()

    event = _subscription_event(
        "evt_cross_tenant",
        org_id=organization_a,
        business_id="business-a",
        customer_id="cus_other_tenant",
    )
    raw, signature = _signed_event(event)
    response = client.post(
        "/webhooks/stripe",
        content=raw,
        headers={"Stripe-Signature": signature},
    )
    assert response.status_code == 409
    with Session(engine) as db:
        assert db.scalar(
            select(CustomerEntitlement).where(
                CustomerEntitlement.organization_id == organization_a,
            )
        ).status == "trialing"
        assert db.scalar(
            select(CustomerEntitlement).where(
                CustomerEntitlement.stripe_customer_id == "cus_other_tenant",
            )
        ).stripe_subscription_id is None


def test_payment_failure_blocks_ai_but_preserves_the_workspace(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    _enable_stripe(monkeypatch)
    organization_id, principal = _workspace(engine, customer_id="cus_billing")
    created, signature = _signed_event(_subscription_event(
        "evt_subscription_created",
        org_id=organization_id,
        business_id="billing-business",
    ))
    assert client.post(
        "/webhooks/stripe",
        content=created,
        headers={"Stripe-Signature": signature},
    ).status_code == 200

    failed_event = {
        "id": "evt_payment_failed",
        "type": "invoice.payment_failed",
        "livemode": False,
        "data": {
            "object": {
                "customer": "cus_billing",
                "parent": {
                    "subscription_details": {"subscription": "sub_billing"},
                },
            },
        },
    }
    raw, signature = _signed_event(failed_event)
    response = client.post(
        "/webhooks/stripe",
        content=raw,
        headers={"Stripe-Signature": signature},
    )
    assert response.status_code == 200
    assert response.json()["processed"] is True
    with Session(engine) as db:
        entitlement = db.scalar(select(CustomerEntitlement))
        assert entitlement.status == "past_due"
        assert db.get(Business, "billing-business") is not None
        with pytest.raises(ApplicationError):
            entitlement_service.reserve_usage(
                db,
                principal,
                business_id="billing-business",
                metric="leo_generation",
                idempotency_key="after-payment-failure",
            )


def test_incomplete_upgrade_does_not_consume_the_no_card_trial(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    _enable_stripe(monkeypatch)
    organization_id, _ = _workspace(engine)
    event = _subscription_event(
        "evt_incomplete_checkout",
        org_id=organization_id,
        business_id="billing-business",
        status="incomplete",
    )
    raw, signature = _signed_event(event)
    response = client.post(
        "/webhooks/stripe",
        content=raw,
        headers={"Stripe-Signature": signature},
    )
    assert response.status_code == 200
    with Session(engine) as db:
        entitlement = db.scalar(select(CustomerEntitlement))
        assert entitlement.status == "trialing"
        assert entitlement.limits["leo_generations"] == 20


def test_checkout_uses_server_config_and_owner_authorization(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    _enable_stripe(monkeypatch)
    org_id, _ = _workspace(engine, business_id="checkout-business")
    requests = []

    class Response:
        status_code = 200

        def __init__(self, value):
            self.value = value

        def json(self):
            return self.value

    def fake_request(method, url, *, data, auth, timeout):
        requests.append((method, url, data, auth, timeout))
        if url.endswith(f"/prices/{_PRICE_ID}"):
            return Response({
                "id": _PRICE_ID,
                "active": True,
                "recurring": {"interval": "month", "interval_count": 1},
            })
        return Response({"url": "https://checkout.stripe.com/c/pay_test"})

    monkeypatch.setattr(stripe_gateway.httpx, "request", fake_request)
    response = client.post("/businesses/checkout-business/billing/checkout")
    assert response.status_code == 200
    assert response.json() == {"url": "https://checkout.stripe.com/c/pay_test"}
    method, url, data, auth_pair, timeout = requests[0]
    assert method == "GET"
    assert url.endswith(f"/prices/{_PRICE_ID}")
    method, url, data, auth_pair, timeout = requests[1]
    assert method == "POST"
    assert url.endswith("/checkout/sessions")
    assert data["line_items[0][price]"] == _PRICE_ID
    assert data["client_reference_id"] == org_id
    assert data["subscription_data[metadata][organization_id]"] == org_id
    assert auth_pair[0] == "sk_test_billing_only"
    assert timeout > 0


def test_members_cannot_manage_billing(isolated_client, monkeypatch):
    client, engine = isolated_client
    _enable_stripe(monkeypatch)
    _, _ = _workspace(engine, business_id="member-business")
    with Session(engine) as db:
        operator = db.scalar(
            select(User).where(User.auth_subject == auth.ALLOWED_USER_ID)
        )
        member = User(
            id="billing-member",
            auth_issuer=auth.SUPABASE_ISSUER,
            auth_subject="billing-member-subject",
            status="active",
        )
        db.add(member)
        db.flush()
        db.add(BusinessMembership(
            business_id="member-business",
            user_id=member.id,
            role="member",
            status="active",
        ))
        db.commit()
        principal = AuthenticatedPrincipal(
            auth.SUPABASE_ISSUER, member.auth_subject, member.id,
        )
    from app.auth import get_authenticated_principal

    client.app.dependency_overrides[get_authenticated_principal] = lambda: principal
    response = client.post("/businesses/member-business/billing/checkout")
    assert response.status_code == 403
