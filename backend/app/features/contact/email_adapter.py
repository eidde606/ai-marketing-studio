"""SMTP delivery adapter for public support requests."""

import os
import smtplib
import ssl
from email.headerregistry import Address
from email.message import EmailMessage
from email.errors import HeaderParseError

from app.errors import ApplicationError, ErrorKind
from .schemas import ContactSubmission

_CATEGORY_LABELS = {
    "general": "General inquiries",
    "technical": "Technical support",
    "billing": "Billing and subscriptions",
    "privacy": "Privacy and data deletion",
    "problem": "Report a problem",
}


def _mailbox(value: str) -> str | None:
    try:
        mailbox = Address(addr_spec=value)
    except (ValueError, HeaderParseError):
        return None
    return value if mailbox.addr_spec == value else None


def _smtp_settings() -> tuple[str, int, str, str, str, str, bool, bool]:
    host = os.getenv("SUPPORT_SMTP_HOST", "").strip()
    destination = os.getenv("SUPPORT_EMAIL_TO", "").strip()
    sender = os.getenv("SUPPORT_EMAIL_FROM", "").strip()
    username = os.getenv("SUPPORT_SMTP_USERNAME", "").strip()
    password = os.getenv("SUPPORT_SMTP_PASSWORD", "")
    if not host or not _mailbox(destination) or not _mailbox(sender):
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Support email is not configured",
        )
    if bool(username) != bool(password):
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Support email is not configured",
        )
    try:
        port = int(os.getenv("SUPPORT_SMTP_PORT", "587"))
    except ValueError:
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Support email is not configured",
        ) from None
    if not 1 <= port <= 65535:
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Support email is not configured",
        )
    use_ssl = os.getenv("SUPPORT_SMTP_USE_SSL", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    starttls = os.getenv("SUPPORT_SMTP_STARTTLS", "true").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    if username and not (use_ssl or starttls):
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Support email is not configured",
        )
    return host, port, username, password, sender, destination, use_ssl, starttls


def ensure_configured() -> None:
    _smtp_settings()


def send_contact_email(submission: ContactSubmission) -> None:
    host, port, username, password, sender, destination, use_ssl, starttls = (
        _smtp_settings()
    )
    message = EmailMessage()
    message["From"] = sender
    message["To"] = destination
    message["Reply-To"] = submission.email
    message["Subject"] = (
        f"AI Marketing Studio support: "
        f"{_CATEGORY_LABELS[submission.category]}"
    )
    message.set_content(
        "\n".join(
            (
                f"Name: {submission.name}",
                f"Reply email: {submission.email}",
                f"Category: {_CATEGORY_LABELS[submission.category]}",
                "",
                submission.message,
            )
        )
    )
    context = ssl.create_default_context()

    try:
        if use_ssl:
            with smtplib.SMTP_SSL(
                host,
                port,
                timeout=10,
                context=context,
            ) as client:
                _deliver(client, username, password, message)
        else:
            with smtplib.SMTP(host, port, timeout=10) as client:
                client.ehlo()
                if starttls:
                    client.starttls(context=context)
                    client.ehlo()
                _deliver(client, username, password, message)
    except (OSError, smtplib.SMTPException, UnicodeError) as exc:
        raise ApplicationError(
            ErrorKind.UNAVAILABLE,
            "Support email could not be sent",
        ) from exc


def _deliver(
    client: smtplib.SMTP,
    username: str,
    password: str,
    message: EmailMessage,
) -> None:
    if username:
        client.login(username, password)
    client.send_message(message)
