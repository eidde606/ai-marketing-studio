from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import AsyncMock, Mock

import pytest
from httpx import Request, Response
from openai import APIConnectionError, APITimeoutError, BadRequestError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AIUsageReservation,
    Business,
    Draft,
    EdianAnalysis,
    SocialAccount,
)
from tests.tenancy_fixtures import (
    grant_test_active_entitlement,
    grant_test_owner,
)


def _business_with_published_posts(engine, *, limit=25, post_count=1):
    with Session(engine) as db:
        business = Business(name="Edian test business")
        db.add(business)
        db.flush()
        principal = grant_test_owner(db, [business.id])
        entitlement = grant_test_active_entitlement(
            db, [business.id], owner_user_id=principal.user_id,
        )
        entitlement.limits = {
            **entitlement.limits,
            "edian_analyses": limit,
        }
        account = SocialAccount(
            business_id=business.id,
            platform="facebook",
            platform_account_id="page-1",
            account_name="Facebook Page",
            encrypted_access_token="encrypted-token",
            connection_status="connected",
        )
        drafts = [
            Draft(
                business_id=business.id,
                title=f"Published post {index}",
                caption="Published caption",
                platform="facebook",
                status="approved",
                facebook_publish_status="published",
                facebook_post_id=f"page-1_post-{index}",
            )
            for index in range(post_count)
        ]
        db.add_all([account, *drafts])
        db.commit()
        return business.id, principal.user_id


def _mock_facebook(monkeypatch, response=None):
    monkeypatch.setattr(
        "app.features.analytics.service.decrypt_token",
        lambda _token: "test-access-token",
    )
    insights = AsyncMock(return_value=response or {
        "reactions": {"summary": {"total_count": 8}},
        "comments": {"summary": {"total_count": 3}},
        "shares": {"count": 2},
        "permalink_url": "https://facebook.test/post",
    })
    monkeypatch.setattr(
        "app.features.analytics.service.get_post_insights",
        insights,
    )
    return insights


def _request(client, business_id, key="edian-key-1", locale="en"):
    return client.post(
        f"/businesses/{business_id}/analytics/edian",
        json={"locale": locale, "idempotency_key": key},
    )


def test_edian_uses_only_returned_facebook_metrics_and_bounds_sample(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    business_id, _ = _business_with_published_posts(
        engine, post_count=12,
    )
    insights = _mock_facebook(
        monkeypatch,
        {
            "reactions": {"summary": {"total_count": 8}},
            "comments": {"summary": {"total_count": 0}},
            "shares": {},
        },
    )
    interpret = Mock(return_value={
        "summary": "Facebook returned 8 reactions and no comments for the sample.",
        "recommendations": ["Try a different post format."],
    })
    monkeypatch.setattr(
        "app.features.analytics.edian_provider.interpret_metrics",
        interpret,
    )

    response = _request(client, business_id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ready"
    assert body["posts_analyzed"] == 10
    assert body["observed"]["metrics"] == {
        "reactions": {"total": 80, "posts_with_data": 10},
        "comments": {"total": 0, "posts_with_data": 10},
        "shares": {"total": None, "posts_with_data": 0},
    }
    assert body["interpretation"]["recommendations"] == [
        "Try a different post format.",
    ]
    assert interpret.call_count == 1
    supplied_snapshot = interpret.call_args.args[0]
    assert supplied_snapshot["metrics"]["shares"]["total"] is None
    assert "instagram" not in str(supplied_snapshot).lower()
    assert insights.await_count == 10
    with Session(engine) as db:
        reservation = db.scalar(select(AIUsageReservation))
        assert reservation.metric == "edian_analysis"
        assert reservation.status == "succeeded"
        original_business = db.get(Business, business_id)
        shared_business = Business(
            name="Second business",
            customer_organization_id=original_business.customer_organization_id,
        )
        db.add(shared_business)
        db.flush()
        grant_test_owner(db, [shared_business.id])
        shared_business_id = shared_business.id
        db.commit()
    usage = client.get(
        f"/businesses/{shared_business_id}/entitlement",
    )
    assert usage.status_code == 200
    assert usage.json()["usage"]["edian_analyses"] == {
        "used": 1,
        "limit": 25,
    }


def test_edian_empty_and_unavailable_metrics_do_not_call_openai(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    empty_business, _ = _business_with_published_posts(engine, post_count=0)
    insights = _mock_facebook(
        monkeypatch,
        {"reactions": {}, "comments": {}, "shares": {}},
    )
    interpret = Mock()
    monkeypatch.setattr(
        "app.features.analytics.edian_provider.interpret_metrics",
        interpret,
    )

    empty = _request(client, empty_business, "edian-empty")
    assert empty.status_code == 200
    assert empty.json()["status"] == "no_data"
    assert empty.json()["posts_analyzed"] == 0
    assert insights.await_count == 0
    assert interpret.call_count == 0

    with Session(engine) as db:
        db.add(Draft(
            business_id=empty_business,
            title="Published post",
            caption="Published caption",
            platform="facebook",
            status="approved",
            facebook_publish_status="published",
            facebook_post_id="page-1_post-1",
        ))
        db.commit()
    unavailable = _request(client, empty_business, "edian-no-metrics")
    assert unavailable.status_code == 200
    assert unavailable.json()["status"] == "no_data"
    assert unavailable.json()["observed"] is None
    assert interpret.call_count == 0
    with Session(engine) as db:
        assert db.scalar(select(AIUsageReservation)) is None


def test_edian_tenant_isolation_rejects_an_unassigned_business(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    with Session(engine) as db:
        foreign_business = Business(name="Other tenant")
        db.add(foreign_business)
        db.commit()
        foreign_id = foreign_business.id
    insights = _mock_facebook(monkeypatch)
    interpret = Mock()
    monkeypatch.setattr(
        "app.features.analytics.edian_provider.interpret_metrics",
        interpret,
    )

    response = _request(client, foreign_id)

    assert response.status_code == 404
    assert insights.await_count == 0
    assert interpret.call_count == 0


def test_edian_denies_missing_entitlement_and_exhausted_quota_before_openai(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    business_id, _ = _business_with_published_posts(engine, limit=0)
    insights = _mock_facebook(monkeypatch)
    interpret = Mock()
    monkeypatch.setattr(
        "app.features.analytics.edian_provider.interpret_metrics",
        interpret,
    )

    response = _request(client, business_id, "edian-no-quota")
    assert response.status_code == 429
    assert interpret.call_count == 0
    reads_after_quota_denial = insights.await_count

    with Session(engine) as db:
        unentitled_business = Business(name="Unentitled business")
        db.add(unentitled_business)
        db.flush()
        grant_test_owner(db, [unentitled_business.id])
        unentitled_id = unentitled_business.id
        db.commit()
    missing_entitlement = _request(client, unentitled_id, "edian-no-entitlement")
    assert missing_entitlement.status_code == 429

    assert insights.await_count == reads_after_quota_denial
    assert interpret.call_count == 0
    with Session(engine) as db:
        assert db.scalar(select(AIUsageReservation)) is None


def test_edian_idempotency_and_unchanged_data_are_deduplicated(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    business_id, _ = _business_with_published_posts(engine)
    insights = _mock_facebook(monkeypatch)
    interpret = Mock(return_value={
        "summary": "Facebook engagement metrics are available.",
        "recommendations": ["Compare another post when its metrics are available."],
    })
    monkeypatch.setattr(
        "app.features.analytics.edian_provider.interpret_metrics",
        interpret,
    )

    first = _request(client, business_id, "edian-replay")
    replay = _request(client, business_id, "edian-replay")
    cached = _request(client, business_id, "edian-new-key")

    assert first.status_code == replay.status_code == cached.status_code == 200
    assert replay.json()["reused"] is True
    assert cached.json()["reused"] is True
    assert interpret.call_count == 1
    assert insights.await_count == 2
    with Session(engine) as db:
        reservations = db.scalars(select(AIUsageReservation).where(
            AIUsageReservation.metric == "edian_analysis",
        )).all()
        assert len(reservations) == 1
        assert reservations[0].status == "succeeded"
        assert len(db.scalars(select(EdianAnalysis)).all()) == 1


def test_edian_requires_idempotency_key_and_finalizes_provider_failures(
    isolated_client, monkeypatch, caplog,
):
    client, engine = isolated_client
    business_id, _ = _business_with_published_posts(engine)
    _mock_facebook(monkeypatch)
    interpret = Mock(side_effect=RuntimeError("PRIVATE_OPENAI_RESPONSE"))
    monkeypatch.setattr(
        "app.features.analytics.edian_provider.interpret_metrics",
        interpret,
    )

    missing_key = client.post(
        f"/businesses/{business_id}/analytics/edian",
        json={"locale": "en"},
    )
    assert missing_key.status_code == 422

    response = _request(client, business_id, "edian-provider-failure")
    assert response.status_code == 502
    assert "PRIVATE_OPENAI_RESPONSE" not in caplog.text
    with Session(engine) as db:
        reservation = db.scalar(select(AIUsageReservation))
        analysis = db.scalar(select(EdianAnalysis))
        assert reservation.status == "uncertain"
        assert analysis.status == "failed"


def test_edian_bad_request_refunds_quota_and_retry_counts_success_once(
    isolated_client, monkeypatch, caplog,
):
    client, engine = isolated_client
    business_id, _ = _business_with_published_posts(engine)
    _mock_facebook(monkeypatch)
    response = Response(
        400,
        request=Request("POST", "https://api.openai.com/v1/responses"),
    )
    bad_request = BadRequestError(
        "PRIVATE_PROVIDER_MESSAGE",
        response=response,
        body={
            "message": "PRIVATE_PROVIDER_MESSAGE",
            "type": "invalid_request_error",
            "param": "text.format.type",
            "code": "invalid_value",
        },
    )
    interpret = Mock(side_effect=[
        bad_request,
        {
            "summary": "Facebook engagement was observed.",
            "recommendations": ["Review the post format."],
        },
    ])
    monkeypatch.setattr(
        "app.features.analytics.edian_provider.interpret_metrics",
        interpret,
    )

    failed = _request(client, business_id, "edian-bad-request")
    assert failed.status_code == 502
    assert "status=400" in caplog.text
    assert "code=invalid_value" in caplog.text
    assert "param=text.format.type" in caplog.text
    assert "type=invalid_request_error" in caplog.text
    assert "PRIVATE_PROVIDER_MESSAGE" not in caplog.text
    with Session(engine) as db:
        reservation = db.scalar(select(AIUsageReservation))
        analysis = db.scalar(select(EdianAnalysis))
        assert reservation.status == "failed"
        assert reservation.result_id is None
        assert analysis.status == "failed"
        assert analysis.result is None
    usage_after_failure = client.get(
        f"/businesses/{business_id}/entitlement",
    )
    assert usage_after_failure.status_code == 200
    assert usage_after_failure.json()["usage"]["edian_analyses"]["used"] == 0

    retry = _request(client, business_id, "edian-retry-after-bad-request")
    assert retry.status_code == 200
    assert retry.json()["status"] == "ready"
    usage = client.get(f"/businesses/{business_id}/entitlement")
    assert usage.status_code == 200
    assert usage.json()["usage"]["edian_analyses"]["used"] == 1
    with Session(engine) as db:
        reservations = db.scalars(select(AIUsageReservation)).all()
        assert sorted(item.status for item in reservations) == [
            "failed",
            "succeeded",
        ]
        analysis = db.scalar(select(EdianAnalysis))
        assert analysis.status == "succeeded"
        assert analysis.result is not None
    assert interpret.call_count == 2


@pytest.mark.parametrize("failure", ["timeout", "connection"])
def test_edian_ambiguous_provider_failures_remain_uncertain(
    isolated_client, monkeypatch, failure,
):
    client, engine = isolated_client
    business_id, _ = _business_with_published_posts(engine)
    _mock_facebook(monkeypatch)
    request = Request("POST", "https://api.openai.com/v1/responses")
    error = (
        APITimeoutError(request=request)
        if failure == "timeout"
        else APIConnectionError(request=request)
    )
    interpret = Mock(side_effect=error)
    monkeypatch.setattr(
        "app.features.analytics.edian_provider.interpret_metrics",
        interpret,
    )

    failed = _request(client, business_id, f"edian-{failure}")

    assert failed.status_code == 502
    with Session(engine) as db:
        reservation = db.scalar(select(AIUsageReservation))
        analysis = db.scalar(select(EdianAnalysis))
        assert reservation.status == "uncertain"
        assert analysis.status == "failed"
        assert analysis.result is None


def test_edian_concurrent_unchanged_data_has_only_one_provider_call(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    business_id, _ = _business_with_published_posts(engine)
    insights = _mock_facebook(monkeypatch)
    started = Event()
    release = Event()
    interpret = Mock(
        side_effect=lambda *_args: (
            started.set(),
            release.wait(timeout=5),
            {
                "summary": "Facebook metrics are available.",
                "recommendations": ["Review another confirmed post later."],
            },
        )[-1],
    )
    monkeypatch.setattr(
        "app.features.analytics.edian_provider.interpret_metrics",
        interpret,
    )

    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(
            _request, client, business_id, "edian-concurrent-1",
        )
        assert started.wait(timeout=5)
        second = _request(client, business_id, "edian-concurrent-2")
        release.set()
        first_response = first.result(timeout=5)

    assert first_response.status_code == 200
    assert second.status_code == 409
    assert interpret.call_count == 1
    assert insights.await_count == 2
    with Session(engine) as db:
        reservations = db.scalars(select(AIUsageReservation)).all()
        assert len(reservations) == 1
        assert reservations[0].status == "succeeded"
