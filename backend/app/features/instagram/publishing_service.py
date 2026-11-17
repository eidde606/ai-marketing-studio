"""Tenant-authorized Instagram image publication workflow."""

import asyncio
import ipaddress
import logging
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal, TenantAccess
from app.features.drafts import repository as drafts_repository
from app.features.entitlements import service as entitlement_service
from app.features.media.image_processing import (
    MAX_INSTAGRAM_IMAGE_BYTES,
    validate_instagram_jpeg,
)
from app.models import InstagramConnection
from app.storage_service import download_marketing_image, get_marketing_image_url
from app.token_service import decrypt_token
from app.transactions import Transactions
from . import publishing_provider, repository

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = MAX_INSTAGRAM_IMAGE_BYTES
MAX_CAPTION_CHARACTERS = 2200
MAX_CONTAINER_POLLS = 5
CONTAINER_POLL_INTERVAL_SECONDS = 2
REQUIRED_PUBLISH_PERMISSIONS = {
    "instagram_basic",
    "instagram_content_publish",
}


def _failure(kind: ErrorKind, detail: str) -> ApplicationError:
    return ApplicationError(kind, detail)


def _token_expired(connection: InstagramConnection) -> bool:
    expires_at = connection.token_expires_at
    if expires_at is None:
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at <= datetime.now(timezone.utc)


def get_publish_ready_connection(
    db: Session,
    context: TenantAccess,
) -> InstagramConnection:
    connection = repository.get_publish_connection_scoped(db, context)
    if (
        connection is None
        or connection.status != "connected_and_authorized"
        or not connection.instagram_account_id
        or not connection.facebook_page_id
        or not connection.encrypted_access_token
    ):
        raise _failure(
            ErrorKind.CONFLICT,
            "Connect an authorized Instagram account to this business first",
        )
    if _token_expired(connection):
        raise _failure(
            ErrorKind.CONFLICT,
            "Instagram authorization expired. Reconnect Instagram before publishing",
        )
    permissions = set(connection.granted_permissions or [])
    if not REQUIRED_PUBLISH_PERMISSIONS.issubset(permissions):
        raise _failure(
            ErrorKind.CONFLICT,
            "Instagram publishing permission is missing. Reconnect Instagram",
        )
    page = repository.get_page_account_scoped(
        db,
        context,
        connection.facebook_page_id,
    )
    if page is None or page.connection_status != "connected":
        raise _failure(
            ErrorKind.CONFLICT,
            "The Facebook Page linked to Instagram is no longer connected",
        )
    return connection


def supports_instagram_image(draft) -> bool:
    return bool(
        draft.media_type == "image"
        and draft.image_status == "completed"
        and isinstance(draft.image_url, str)
        and draft.image_url.split("?", 1)[0].lower().endswith((".jpg", ".jpeg"))
        and len(draft.caption) <= MAX_CAPTION_CHARACTERS
    )


def _public_https_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or hostname.lower() in {"localhost", "localhost.localdomain"}
            or hostname.lower().endswith((".localhost", ".local", ".test", ".invalid"))
        ):
            return False
        try:
            if not ipaddress.ip_address(hostname).is_global:
                return False
        except ValueError:
            pass
        return True
    except (TypeError, ValueError):
        return False


def _instagram_permalink(value: str | None) -> str | None:
    if not isinstance(value, str) or not _public_https_url(value):
        return None
    if urlsplit(value).hostname.lower() not in {
        "instagram.com",
        "www.instagram.com",
    }:
        return None
    return value


def _prepare_image(draft, context: TenantAccess) -> str:
    if not supports_instagram_image(draft):
        raise _failure(
            ErrorKind.CONFLICT,
            "Instagram publishing requires an approved JPEG image and a caption of 2,200 characters or fewer",
        )
    try:
        image_bytes = download_marketing_image(
            draft.image_url,
            draft.business_id,
        )
        validate_instagram_jpeg(image_bytes)
        image_url = get_marketing_image_url(
            draft.image_url,
            expires_in=3600,
            context=context,
        )
    except Exception as exc:
        logger.warning(
            "Instagram image preparation failed (error_type=%s)",
            type(exc).__name__,
        )
        raise _failure(
            ErrorKind.INVALID_INPUT,
            "Instagram requires an accessible JPEG image smaller than 8 MB",
        ) from None
    if not _public_https_url(image_url):
        raise _failure(
            ErrorKind.INVALID_INPUT,
            "Instagram media must be available from a public HTTPS URL",
        )
    return image_url


def _save_claimed_status(
    db: Session,
    context: TenantAccess,
    draft_id: str,
    status: str,
    *,
    media_id: str | None = None,
    permalink: str | None = None,
    published_at: datetime | None = None,
) -> None:
    values = {"instagram_publish_status": status}
    if media_id is not None:
        values["instagram_media_id"] = media_id
    if permalink is not None:
        values["instagram_permalink"] = permalink
    if published_at is not None:
        values["instagram_published_at"] = published_at
    if not repository.save_claimed_publication_scoped(
        db,
        context,
        draft_id,
        values=values,
    ):
        raise _failure(
            ErrorKind.CONFLICT,
            "Instagram publication claim is no longer active",
        )
    Transactions(db).commit()


def _mark_connection_unusable(
    db: Session,
    context: TenantAccess,
    category: str,
) -> None:
    values = {
        "status": (
            "reauthorization_required"
            if category == "credentials_expired"
            else "permission_error"
        ),
        "last_error": (
            "La autorización de Instagram expiró. Vuelve a conectar la cuenta."
            if category == "credentials_expired"
            else "Meta no concedió el permiso necesario para publicar. Vuelve a autorizar."
        ),
    }
    if repository.update_connection_scoped(db, context, values):
        Transactions(db).commit()


def _recheck_before_publish(
    db: Session,
    principal: AuthenticatedPrincipal,
    draft_id: str,
    context: TenantAccess,
    encrypted_token: str,
    instagram_account_id: str,
) -> TenantAccess:
    context = access.require_draft_permission(
        db,
        principal,
        draft_id,
        Permission.PUBLISH,
        include_deleted=True,
    )
    connection = get_publish_ready_connection(db, context)
    if (
        connection.encrypted_access_token != encrypted_token
        or connection.instagram_account_id != instagram_account_id
    ):
        raise _failure(
            ErrorKind.CONFLICT,
            "Instagram connection changed during publication. Start again",
        )
    return context


def _provider_failure_status(
    error: Exception,
    *,
    publication_requested: bool,
) -> str:
    if not publication_requested:
        return "failed"
    if isinstance(error, publishing_provider.InstagramPublishingProviderError):
        if error.status_code is not None and 400 <= error.status_code < 500:
            return "failed"
    return "needs_review"


def _provider_failure_detail(
    error: Exception,
    status: str,
) -> str:
    if isinstance(error, publishing_provider.InstagramPublishingProviderError):
        if error.category == "rate_limited":
            return "Instagram is rate limited. Wait and retry publication"
        if error.category == "credentials_expired":
            return "Instagram authorization expired. Reconnect Instagram before retrying"
        if error.category == "permission":
            return "Instagram publishing permission is missing. Reconnect Instagram"
    if status == "needs_review":
        return "Instagram may have published this post. Check Instagram before retrying"
    return "Instagram could not publish this image. You can safely retry"


async def publish_image(
    draft_id: str,
    *,
    db: Session,
    principal: AuthenticatedPrincipal,
) -> dict[str, str | None]:
    context = access.require_draft_permission(
        db,
        principal,
        draft_id,
        Permission.PUBLISH,
    )
    draft = drafts_repository.get_draft_scoped(db, context, draft_id)
    if draft is None:
        raise _failure(ErrorKind.NOT_FOUND, "Draft not found")
    if draft.status != "approved":
        raise _failure(ErrorKind.CONFLICT, "Only approved content can be published")
    if "instagram" not in (draft.publish_destinations or []):
        raise _failure(
            ErrorKind.CONFLICT,
            "Instagram is not selected for this draft",
        )

    connection = get_publish_ready_connection(db, context)
    image_url = _prepare_image(draft, context)
    try:
        access_token = decrypt_token(connection.encrypted_access_token)
    except Exception:
        raise _failure(
            ErrorKind.CONFLICT,
            "Instagram credentials are unavailable. Reconnect Instagram",
        ) from None

    access.require_permission(
        db,
        principal,
        draft.business_id,
        Permission.PUBLISH,
        lock=True,
    )
    entitlement_service.assert_publishing_allowed(db, draft.business_id)
    if not repository.claim_publication_scoped(db, context, draft_id):
        Transactions(db).rollback()
        raise _failure(
            ErrorKind.CONFLICT,
            "Instagram publication is already running or cannot be retried safely",
        )
    Transactions(db).commit()

    try:
        context = _recheck_before_publish(
            db,
            principal,
            draft_id,
            context,
            connection.encrypted_access_token,
            connection.instagram_account_id,
        )
    except ApplicationError:
        Transactions(db).rollback()
        _save_claimed_status(db, context, draft_id, "failed")
        raise

    publication_requested = False
    try:
        container_id = await publishing_provider.create_image_container(
            connection.instagram_account_id,
            access_token,
            image_url,
            draft.caption,
        )
        container_status = ""
        for attempt in range(MAX_CONTAINER_POLLS):
            container_status = await publishing_provider.get_container_status(
                container_id,
                access_token,
            )
            if container_status == "FINISHED":
                break
            if container_status in {"ERROR", "EXPIRED"}:
                raise _failure(
                    ErrorKind.UPSTREAM_FAILURE,
                    "Instagram could not process this image. You can safely retry",
                )
            if container_status != "IN_PROGRESS":
                raise _failure(
                    ErrorKind.UPSTREAM_FAILURE,
                    "Instagram returned an unknown image-processing status",
                )
            if attempt + 1 < MAX_CONTAINER_POLLS:
                await asyncio.sleep(CONTAINER_POLL_INTERVAL_SECONDS)
        if container_status != "FINISHED":
            raise _failure(
                ErrorKind.UPSTREAM_FAILURE,
                "Instagram image processing timed out. You can safely retry",
            )

        context = _recheck_before_publish(
            db,
            principal,
            draft_id,
            context,
            connection.encrypted_access_token,
            connection.instagram_account_id,
        )
        publication_requested = True
        media_id = await publishing_provider.publish_container(
            connection.instagram_account_id,
            container_id,
            access_token,
        )
    except ApplicationError:
        Transactions(db).rollback()
        _save_claimed_status(db, context, draft_id, "failed")
        raise
    except (httpx.HTTPError, publishing_provider.InstagramPublishingProviderError) as exc:
        Transactions(db).rollback()
        failure_status = _provider_failure_status(
            exc,
            publication_requested=publication_requested,
        )
        if (
            isinstance(exc, publishing_provider.InstagramPublishingProviderError)
            and exc.category in {"credentials_expired", "permission"}
        ):
            _mark_connection_unusable(db, context, exc.category)
        _save_claimed_status(db, context, draft_id, failure_status)
        logger.warning(
            "Instagram publication failed (status=%s, category=%s, error_type=%s)",
            failure_status,
            (
                exc.category
                if isinstance(
                    exc,
                    publishing_provider.InstagramPublishingProviderError,
                )
                else "transport",
            ),
            type(exc).__name__,
        )
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            _provider_failure_detail(exc, failure_status),
        ) from None
    except Exception as exc:
        Transactions(db).rollback()
        failure_status = (
            "needs_review" if publication_requested else "failed"
        )
        _save_claimed_status(db, context, draft_id, failure_status)
        logger.warning(
            "Instagram publication failed (status=%s, error_type=%s)",
            failure_status,
            type(exc).__name__,
        )
        raise _failure(
            ErrorKind.UPSTREAM_FAILURE,
            _provider_failure_detail(exc, failure_status),
        ) from None

    published_at = datetime.now(timezone.utc)
    _save_claimed_status(
        db,
        context,
        draft_id,
        "published",
        media_id=media_id,
        published_at=published_at,
    )

    permalink = None
    try:
        permalink = _instagram_permalink(
            await publishing_provider.get_media_permalink(media_id, access_token),
        )
    except (httpx.HTTPError, publishing_provider.InstagramPublishingProviderError) as exc:
        logger.warning(
            "Instagram permalink lookup failed (error_type=%s)",
            type(exc).__name__,
        )
    if permalink is not None and repository.save_publication_permalink_scoped(
        db,
        context,
        draft_id,
        media_id=media_id,
        permalink=permalink,
    ):
        Transactions(db).commit()

    access.require_draft_permission(
        db,
        principal,
        draft_id,
        Permission.PUBLISH,
        include_deleted=True,
    )
    return {
        "status": "published",
        "instagram_media_id": media_id,
        "instagram_permalink": permalink,
    }
