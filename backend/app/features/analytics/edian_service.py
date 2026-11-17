"""Explicit, quota-limited Edian interpretation of verified Facebook metrics."""
import asyncio
import hashlib
import json
import logging
import re

from openai import APIStatusError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from app.features.drafts import repository as drafts_repository
from app.features.entitlements import repository as entitlements_repository
from app.features.entitlements import service as entitlements
from app.models import EdianAnalysis
from app.transactions import Transactions
from . import edian_provider, repository
from .service import facebook_post_analytics

logger = logging.getLogger(__name__)
_MAX_POSTS = 10
_METRICS = ("reactions", "comments", "shares")
_SAFE_PROVIDER_LABEL = re.compile(r"[A-Za-z0-9_.-]{1,80}\Z")


def _safe_provider_label(value: object) -> str:
    if isinstance(value, str) and _SAFE_PROVIDER_LABEL.fullmatch(value):
        return value
    return "unknown"


def _validate_idempotency_replay(db, context, principal, key, locale):
    organization = entitlements_repository.organization_for_business_scoped(
        db, context,
    )
    if organization is None:
        raise ApplicationError(ErrorKind.FORBIDDEN, "Customer organization is unavailable")
    reservation = entitlements_repository.usage_reservation_by_key_scoped(
        db, context, "edian_analysis", key,
    )
    if reservation is None:
        return None
    if reservation.business_id != context.business_id or reservation.user_id != principal.user_id:
        raise ApplicationError(ErrorKind.CONFLICT, "This idempotency key was already used")
    if reservation.status != "succeeded" or not reservation.result_id:
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "This request was already processed; use a new idempotency key",
        )
    analysis = repository.edian_analysis_by_id_scoped(
        db, context, reservation.result_id,
    )
    if analysis is None or analysis.status != "succeeded" or not analysis.result:
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "This request was already processed; use a new idempotency key",
        )
    if analysis.result.get("locale") != locale:
        raise ApplicationError(ErrorKind.CONFLICT, "This idempotency key was already used")
    return {**analysis.result, "reused": True}


def _numeric_metric(value: object) -> int | None:
    if type(value) is int and value >= 0:
        return value
    return None


async def analyze_business(
    business_id: str,
    *,
    locale: str,
    idempotency_key: str,
    db: Session,
    principal: AuthenticatedPrincipal,
) -> dict[str, object]:
    context = access.require_permission(
        db, principal, business_id, Permission.USE_EDIAN,
    )
    replay = _validate_idempotency_replay(
        db, context, principal, idempotency_key, locale,
    )
    if replay is not None:
        return replay

    published = [
        draft
        for draft in drafts_repository.list_drafts_scoped(
            db, context, include_deleted_published=True, limit=100,
        )
        if draft.facebook_publish_status == "published" and draft.facebook_post_id
    ][: _MAX_POSTS]
    if not published:
        return {
            "status": "no_data",
            "locale": locale,
            "source": "Facebook",
            "posts_analyzed": 0,
            "observed": None,
            "interpretation": None,
            "reused": False,
        }

    if repository.get_connected_facebook_account_scoped(db, context) is None:
        return {
            "status": "unavailable",
            "locale": locale,
            "source": "Facebook",
            "posts_analyzed": 0,
            "observed": None,
            "interpretation": None,
            "reused": False,
        }

    values_by_post: list[dict[str, int | str]] = []
    provider_failures = 0
    for draft in published:
        try:
            response = await facebook_post_analytics(
                draft.id, db=db, principal=principal,
            )
        except ApplicationError as exc:
            if exc.kind != ErrorKind.UPSTREAM_FAILURE:
                raise
            provider_failures += 1
            continue
        metrics = {
            name: value
            for name in _METRICS
            if (value := _numeric_metric(response.get(name))) is not None
        }
        if metrics:
            values_by_post.append({"draft_id": draft.id, **metrics})

    access.require_permission(db, principal, business_id, Permission.USE_EDIAN)
    if provider_failures == len(published):
        return {
            "status": "unavailable",
            "locale": locale,
            "source": "Facebook",
            "posts_analyzed": len(published),
            "observed": None,
            "interpretation": None,
            "reused": False,
        }
    if not values_by_post:
        return {
            "status": "no_data",
            "locale": locale,
            "source": "Facebook",
            "posts_analyzed": len(published),
            "observed": None,
            "interpretation": None,
            "reused": False,
        }

    summary_metrics: dict[str, dict[str, int | None]] = {}
    for name in _METRICS:
        available = [
            row[name] for row in values_by_post if name in row
        ]
        summary_metrics[name] = {
            "total": sum(available) if available else None,
            "posts_with_data": len(available),
        }
    snapshot = {
        "platform": "Facebook",
        "posts_analyzed": len(published),
        "posts_with_any_data": len(values_by_post),
        "metrics": summary_metrics,
    }
    fingerprint_input = {
        "business_id": context.business_id,
        "locale": locale,
        "posts": values_by_post,
        "snapshot": snapshot,
    }
    fingerprint = hashlib.sha256(
        json.dumps(
            fingerprint_input,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()

    access.require_permission(db, principal, business_id, Permission.USE_EDIAN)
    organization = entitlements_repository.organization_for_business_scoped(
        db, context, lock=True,
    )
    if organization is None:
        raise ApplicationError(ErrorKind.FORBIDDEN, "Customer organization is unavailable")
    context = access.require_permission(
        db, principal, business_id, Permission.USE_EDIAN,
    )
    replay = _validate_idempotency_replay(
        db, context, principal, idempotency_key, locale,
    )
    if replay is not None:
        Transactions(db).rollback()
        return replay

    cached = repository.edian_analysis_scoped(db, context, fingerprint, lock=True)
    if cached is not None and cached.status == "succeeded" and cached.result:
        result = {**cached.result, "reused": True}
        Transactions(db).rollback()
        return result
    if cached is not None and cached.status == "processing":
        Transactions(db).rollback()
        raise ApplicationError(
            ErrorKind.CONFLICT,
            "Edian is already analyzing this unchanged data. Try again shortly.",
        )

    try:
        reservation, replayed = entitlements.reserve_usage(
            db,
            principal,
            business_id=business_id,
            metric="edian_analysis",
            idempotency_key=idempotency_key,
        )
        if replayed:
            Transactions(db).rollback()
            replay = _validate_idempotency_replay(
                db, context, principal, idempotency_key, locale,
            )
            if replay is not None:
                return replay
            raise ApplicationError(
                ErrorKind.CONFLICT,
                "This request was already processed; use a new idempotency key",
            )
        if cached is None:
            cached = EdianAnalysis(
                business_id=business_id,
                input_fingerprint=fingerprint,
                status="processing",
            )
            repository.add_edian_analysis_scoped(db, context, cached)
        else:
            cached.status = "processing"
            cached.result = None
        reservation_id = reservation.id
        Transactions(db).commit()
    except IntegrityError:
        Transactions(db).rollback()
        context = access.require_permission(
            db, principal, business_id, Permission.USE_EDIAN,
        )
        replay = _validate_idempotency_replay(
            db, context, principal, idempotency_key, locale,
        )
        if replay is not None:
            return replay
        cached = repository.edian_analysis_scoped(db, context, fingerprint)
        if cached is not None and cached.status == "succeeded" and cached.result:
            return {**cached.result, "reused": True}
        if cached is not None and cached.status == "processing":
            raise ApplicationError(
                ErrorKind.CONFLICT,
                "Edian is already analyzing this unchanged data. Try again shortly.",
            ) from None
        raise
    Transactions(db).rollback()

    try:
        access.require_permission(db, principal, business_id, Permission.USE_EDIAN)
    except ApplicationError:
        cached = repository.edian_analysis_scoped(db, context, fingerprint, lock=True)
        if cached is not None:
            cached.status = "failed"
        entitlements.release_usage_before_provider_call(db, reservation_id)
        raise
    Transactions(db).rollback()

    try:
        interpretation = await asyncio.to_thread(
            edian_provider.interpret_metrics, snapshot, locale,
        )
        context = access.require_permission(
            db, principal, business_id, Permission.USE_EDIAN,
        )
        result = {
            "status": "ready",
            "locale": locale,
            "source": "Facebook",
            "posts_analyzed": len(published),
            "observed": snapshot,
            "interpretation": interpretation,
            "reused": False,
        }
        cached = repository.edian_analysis_scoped(db, context, fingerprint, lock=True)
        if cached is None:
            raise ApplicationError(ErrorKind.CONFLICT, "Edian analysis record is unavailable")
        cached.status = "succeeded"
        cached.result = result
        repository.flush(db)
        entitlements.finish_usage(
            db, reservation_id, succeeded=True, result_id=cached.id,
        )
        return result
    except APIStatusError as exc:

        logger.warning(
            "Edian OpenAI request failed: status=%s code=%s param=%s "
            "type=%s request_id=%s",
            exc.status_code,
            _safe_provider_label(exc.code),
            _safe_provider_label(exc.param),
            _safe_provider_label(exc.type),
            _safe_provider_label(exc.request_id),
        )
        cached = repository.edian_analysis_scoped(db, context, fingerprint, lock=True)
        if cached is not None:
            cached.status = "failed"
            cached.result = None
        if 400 <= exc.status_code < 500:
            entitlements.release_usage_for_nonbillable_failure(
                db, [reservation_id],
            )
        else:
            entitlements.finish_usage(db, reservation_id, succeeded=False)
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Edian could not prepare recommendations. Please try again later.",
        ) from None
    except ApplicationError:
        cached = repository.edian_analysis_scoped(db, context, fingerprint, lock=True)
        if cached is not None:
            cached.status = "failed"
            cached.result = None
        entitlements.finish_usage(db, reservation_id, succeeded=False)
        raise
    except Exception as exc:
        logger.warning("Edian interpretation failed (%s)", type(exc).__name__)
        cached = repository.edian_analysis_scoped(db, context, fingerprint, lock=True)
        if cached is not None:
            cached.status = "failed"
            cached.result = None
        entitlements.finish_usage(db, reservation_id, succeeded=False)
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Edian could not prepare recommendations. Please try again later.",
        ) from None
