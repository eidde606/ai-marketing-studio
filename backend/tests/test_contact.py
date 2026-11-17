import smtplib

import pytest
from fastapi.testclient import TestClient

from app.errors import ApplicationError
from app.features.contact import email_adapter, service
from app.features.contact.schemas import ContactSubmission
from app.main import app


@pytest.fixture
def contact_client(monkeypatch):
    monkeypatch.setenv("SUPPORT_EMAIL_TO", "support@example.test")
    monkeypatch.setenv("SUPPORT_EMAIL_FROM", "studio@example.test")
    monkeypatch.setenv("SUPPORT_SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SUPPORT_SMTP_PORT", "587")
    monkeypatch.delenv("SUPPORT_SMTP_USERNAME", raising=False)
    monkeypatch.delenv("SUPPORT_SMTP_PASSWORD", raising=False)
    monkeypatch.setenv("SUPPORT_SMTP_STARTTLS", "true")
    service._rate_limiter.clear()
    with TestClient(app) as client:
        yield client
    service._rate_limiter.clear()


def _payload(**changes):
    return {
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "category": "general",
        "message": "I need help with my workspace.",
        "website": "",
        **changes,
    }


def test_public_contact_sends_a_valid_request_without_authentication(
    contact_client,
    monkeypatch,
):
    delivered = []
    monkeypatch.setattr(
        email_adapter,
        "send_contact_email",
        lambda submission: delivered.append(submission),
    )

    response = contact_client.post("/public/contact", json=_payload())

    assert response.status_code == 201
    assert response.json() == {"status": "submitted"}
    assert len(delivered) == 1
    assert delivered[0].name == "Ada Lovelace"
    assert delivered[0].category == "general"


@pytest.mark.parametrize(
    "changes",
    [
        {"email": "not-an-email"},
        {"email": "ada@example.com\r\nBcc: other@example.test"},
        {"name": "Ada\nBcc: other@example.test"},
        {"category": "unknown"},
        {"message": "short"},
        {"unexpected": "field"},
    ],
)
def test_contact_rejects_invalid_or_injected_input(
    contact_client,
    monkeypatch,
    changes,
):
    send = []
    monkeypatch.setattr(
        email_adapter,
        "send_contact_email",
        lambda submission: send.append(submission),
    )

    response = contact_client.post("/public/contact", json=_payload(**changes))

    assert response.status_code == 422
    assert not send


def test_honeypot_submission_is_rejected_without_delivery(
    contact_client,
    monkeypatch,
):
    send = []
    monkeypatch.setattr(
        email_adapter,
        "send_contact_email",
        lambda submission: send.append(submission),
    )

    response = contact_client.post(
        "/public/contact",
        json=_payload(website="https://spam.example"),
    )

    assert response.status_code == 400
    assert not send


def test_contact_rate_limit_is_per_client_address(
    contact_client,
    monkeypatch,
):
    send = []
    monkeypatch.setattr(
        email_adapter,
        "send_contact_email",
        lambda submission: send.append(submission),
    )

    responses = [
        contact_client.post("/public/contact", json=_payload())
        for _ in range(6)
    ]

    assert [response.status_code for response in responses] == [
        201,
        201,
        201,
        201,
        201,
        429,
    ]
    assert len(send) == 5


def test_contact_returns_unavailable_when_support_email_is_not_configured(
    contact_client,
    monkeypatch,
):
    monkeypatch.delenv("SUPPORT_EMAIL_TO")
    send = []
    monkeypatch.setattr(
        email_adapter,
        "send_contact_email",
        lambda submission: send.append(submission),
    )

    response = contact_client.post("/public/contact", json=_payload())

    assert response.status_code == 503
    assert response.json()["detail"] == "Support email is not configured"
    assert not send


def test_smtp_adapter_uses_configured_destination_and_safe_headers(monkeypatch):
    sent_messages = []
    tls_starts = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            assert host == "smtp.example.test"
            assert port == 587
            assert timeout == 10

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def ehlo(self):
            return None

        def starttls(self, *, context):
            tls_starts.append(context)

        def send_message(self, message):
            sent_messages.append(message)

    monkeypatch.setenv("SUPPORT_EMAIL_TO", "support@example.test")
    monkeypatch.setenv("SUPPORT_EMAIL_FROM", "studio@example.test")
    monkeypatch.setenv("SUPPORT_SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SUPPORT_SMTP_PORT", "587")
    monkeypatch.setenv("SUPPORT_SMTP_STARTTLS", "true")
    monkeypatch.delenv("SUPPORT_SMTP_USERNAME", raising=False)
    monkeypatch.delenv("SUPPORT_SMTP_PASSWORD", raising=False)
    monkeypatch.setattr(email_adapter.smtplib, "SMTP", FakeSMTP)

    email_adapter.send_contact_email(ContactSubmission(**_payload()))

    assert len(tls_starts) == 1
    assert len(sent_messages) == 1
    assert sent_messages[0]["To"] == "support@example.test"
    assert sent_messages[0]["Reply-To"] == "ada@example.com"
    assert sent_messages[0]["Subject"] == (
        "AI Marketing Studio support: General inquiries"
    )
    assert "Ada Lovelace" in sent_messages[0].get_content()


def test_smtp_credentials_require_encrypted_transport(monkeypatch):
    monkeypatch.setenv("SUPPORT_EMAIL_TO", "support@example.test")
    monkeypatch.setenv("SUPPORT_EMAIL_FROM", "studio@example.test")
    monkeypatch.setenv("SUPPORT_SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SUPPORT_SMTP_USERNAME", "studio-user")
    monkeypatch.setenv("SUPPORT_SMTP_PASSWORD", "studio-password")
    monkeypatch.setenv("SUPPORT_SMTP_USE_SSL", "false")
    monkeypatch.setenv("SUPPORT_SMTP_STARTTLS", "false")

    with pytest.raises(ApplicationError) as error:
        email_adapter.ensure_configured()

    assert error.value.detail == "Support email is not configured"


def test_smtp_failure_does_not_expose_provider_details(monkeypatch):
    class FailingSMTP:
        def __init__(self, *_args, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def ehlo(self):
            return None

        def starttls(self, *, context):
            return None

        def send_message(self, _message):
            raise smtplib.SMTPAuthenticationError(535, b"private server detail")

    monkeypatch.setenv("SUPPORT_EMAIL_TO", "support@example.test")
    monkeypatch.setenv("SUPPORT_EMAIL_FROM", "studio@example.test")
    monkeypatch.setenv("SUPPORT_SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SUPPORT_SMTP_PORT", "587")
    monkeypatch.setenv("SUPPORT_SMTP_STARTTLS", "true")
    monkeypatch.delenv("SUPPORT_SMTP_USERNAME", raising=False)
    monkeypatch.delenv("SUPPORT_SMTP_PASSWORD", raising=False)
    monkeypatch.setattr(email_adapter.smtplib, "SMTP", FailingSMTP)

    with pytest.raises(ApplicationError) as error:
        email_adapter.send_contact_email(ContactSubmission(**_payload()))

    assert error.value.detail == "Support email could not be sent"
    assert "private server detail" not in str(error.value)
