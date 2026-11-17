"""Minimal Stripe API adapter; credentials remain server-side and test-mode only."""
from urllib.parse import urlparse

import httpx

from app.errors import ApplicationError, ErrorKind

_API_BASE = "https://api.stripe.com/v1"


def _secret_key() -> str:
    import os

    key = os.getenv("STRIPE_SECRET_KEY", "").strip()
    if not key.startswith("sk_test_"):
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Stripe test-mode billing is not configured",
        )
    return key


def checkout_available() -> bool:
    import os

    return bool(
        os.getenv("STRIPE_SECRET_KEY", "").strip().startswith("sk_test_")
        and os.getenv("STRIPE_MONTHLY_PRICE_ID", "").strip().startswith("price_")
    )


def monthly_price_id() -> str:
    import os

    price_id = os.getenv("STRIPE_MONTHLY_PRICE_ID", "").strip()
    if not price_id.startswith("price_"):
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "The monthly subscription plan is not configured",
        )
    return price_id


def _frontend_base_url() -> str:
    import os

    base_url = os.getenv("FRONTEND_BASE_URL", "").strip().rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "The billing return URL is not configured",
        )
    if parsed.username or parsed.password:
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "The billing return URL is invalid",
        )
    return base_url


def monthly_plan_details() -> dict[str, str | None]:
    import os

    return {
        "plan_name": os.getenv("STRIPE_MONTHLY_PLAN_NAME", "Monthly subscription").strip()
        or "Monthly subscription",
        "price_display": os.getenv("STRIPE_MONTHLY_PRICE_DISPLAY", "").strip() or None,
    }


def create_checkout_session(
    *,
    organization_id: str,
    business_id: str,
    customer_id: str | None,
) -> dict:
    price_id = monthly_price_id()
    _verify_monthly_price(price_id)
    base_url = _frontend_base_url()
    fields = {
        "mode": "subscription",
        "success_url": f"{base_url}/?billing=success",
        "cancel_url": f"{base_url}/?billing=cancelled",
        "client_reference_id": organization_id,
        "line_items[0][price]": price_id,
        "line_items[0][quantity]": "1",
        "metadata[organization_id]": organization_id,
        "metadata[business_id]": business_id,
        "subscription_data[metadata][organization_id]": organization_id,
        "subscription_data[metadata][business_id]": business_id,
    }
    if customer_id:
        fields["customer"] = customer_id
    return _request("POST", "checkout/sessions", fields)


def create_portal_session(*, customer_id: str) -> dict:
    return _request(
        "POST",
        "billing_portal/sessions",
        {
            "customer": customer_id,
            "return_url": f"{_frontend_base_url()}/?billing=returned",
        },
    )


def _request(method: str, path: str, fields: dict[str, str]) -> dict:
    key = _secret_key()
    try:
        response = httpx.request(
            method,
            f"{_API_BASE}/{path}",
            data=fields,
            auth=(key, ""),
            timeout=10.0,
        )
    except httpx.RequestError as exc:
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Stripe Billing could not be reached",
        ) from exc
    if response.status_code < 200 or response.status_code >= 300:
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Stripe Billing could not create the requested session",
        )
    try:
        result = response.json()
    except ValueError as exc:
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Stripe Billing returned an invalid response",
        ) from exc
    if not isinstance(result, dict):
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Stripe Billing returned an invalid response",
        )
    return result


def _verify_monthly_price(price_id: str) -> None:
    price = _request("GET", f"prices/{price_id}", {})
    recurring = price.get("recurring")
    if (
        price.get("id") != price_id
        or price.get("active") is not True
        or not isinstance(recurring, dict)
        or recurring.get("interval") != "month"
        or recurring.get("interval_count") != 1
    ):
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "The configured Stripe price is not an active monthly plan",
        )


def hosted_session_url(result: dict, *, expected_host: str) -> str:
    url = result.get("url")
    parsed = urlparse(url) if isinstance(url, str) else None
    if (
        parsed is None
        or parsed.scheme != "https"
        or parsed.hostname != expected_host
        or parsed.username
        or parsed.password
    ):
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Stripe Billing returned an invalid hosted-session URL",
        )
    return url
