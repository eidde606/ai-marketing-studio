"""Application authorization for HeyGen assets."""
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from app.transactions import Transactions
from . import repository, service as provider_service


def _failure(kind: ErrorKind, detail: str) -> ApplicationError:
    return ApplicationError(kind, detail)


def assign_private_asset(
    db: Session,
    principal: AuthenticatedPrincipal,
    business_id: str,
    asset_type: str,
    provider_asset_id: str,
) -> dict[str, str]:
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_HEYGEN_ASSETS, lock=True,
    )
    existing = repository.heygen_asset_accessible_scoped(
        db, context, asset_type, provider_asset_id,
    )
    if existing is not None:
        if (
            existing.access_scope == "business_private"
            and existing.business_id == business_id
        ):
            return {"asset_type": asset_type, "provider_asset_id": provider_asset_id}
        raise _failure(
            ErrorKind.CONFLICT,
            "This HeyGen asset is already assigned or designated as platform stock",
        )

    try:
        repository.assign_private_heygen_asset_scoped(
            db, context, principal.user_id, asset_type, provider_asset_id,
        )
        Transactions(db).commit()
    except ValueError as exc:
        Transactions(db).rollback()
        raise _failure(ErrorKind.INVALID_INPUT, str(exc)) from exc
    except IntegrityError as exc:
        Transactions(db).rollback()
        raise _failure(
            ErrorKind.CONFLICT,
            "This HeyGen asset is already assigned to another access scope",
        ) from exc
    return {"asset_type": asset_type, "provider_asset_id": provider_asset_id}


def remove_private_asset(
    db: Session,
    principal: AuthenticatedPrincipal,
    business_id: str,
    asset_type: str,
    provider_asset_id: str,
) -> None:
    context = access.require_permission(
        db, principal, business_id, Permission.MANAGE_HEYGEN_ASSETS, lock=True,
    )
    if not repository.remove_private_heygen_asset_scoped(
        db, context, asset_type, provider_asset_id,
    ):
        Transactions(db).rollback()
        raise _failure(ErrorKind.NOT_FOUND, "Assigned HeyGen asset not found")
    Transactions(db).commit()


def require_generation_assets(
    db: Session,
    principal: AuthenticatedPrincipal,
    business_id: str,
    avatar_id: str,
    voice_id: str,
    *,
    lock: bool = False,
):
    context = access.require_permission(
        db, principal, business_id, Permission.GENERATE_MEDIA, lock=lock,
    )
    for asset_type, asset_id in (("avatar", avatar_id), ("voice", voice_id)):
        if repository.heygen_asset_accessible_scoped(
            db, context, asset_type, asset_id,
        ) is None:
            raise _failure(
                ErrorKind.FORBIDDEN,
                f"The selected HeyGen {asset_type} is not available to this business",
            )
    return context


def list_accessible_asset_ids(
    db: Session,
    principal: AuthenticatedPrincipal,
    business_id: str | None,
    asset_type: str,
    access_scope: str,
) -> set[str]:
    context = None
    if access_scope == "business_private":
        if business_id is None:
            raise _failure(ErrorKind.INVALID_INPUT, "business_id is required for private assets")
        context = access.require_permission(
            db, principal, business_id, Permission.READ,
        )
    if access_scope == "business_private":
        return repository.list_business_private_heygen_asset_ids_scoped(
            db, context, asset_type,
        )
    return repository.list_platform_stock_heygen_asset_ids(db, asset_type)


def list_avatar_assets(
    db: Session,
    principal: AuthenticatedPrincipal,
    business_id: str | None,
    *,
    avatar_type: str | None,
    ownership: str,
    limit: int,
    token: str | None,
) -> dict:
    scope = "business_private" if ownership == "private" else "platform_stock"
    allowed_ids = list_accessible_asset_ids(
        db, principal, business_id, "avatar", scope,
    )
    page = provider_service.avatar_looks(
        avatar_type=avatar_type,
        ownership=ownership,
        limit=limit,
        token=token,
    )
    page["data"] = [
        item for item in page["data"] if item.get("id") in allowed_ids
    ]
    return page


def list_voice_assets(
    db: Session,
    principal: AuthenticatedPrincipal,
    business_id: str | None,
    *,
    voice_type: str,
    limit: int,
    token: str | None,
) -> dict:
    scope = "business_private" if voice_type == "private" else "platform_stock"
    allowed_ids = list_accessible_asset_ids(
        db, principal, business_id, "voice", scope,
    )
    page = provider_service.voices(
        voice_type=voice_type,
        limit=limit,
        token=token,
    )
    page["data"] = [
        item for item in page["data"] if item.get("voice_id") in allowed_ids
    ]
    return page


def list_platform_stock_avatars(
    db: Session, principal: AuthenticatedPrincipal,
) -> list:
    allowed_ids = list_accessible_asset_ids(
        db, principal, None, "avatar", "platform_stock",
    )
    return [
        item for item in provider_service.legacy_avatar_looks()
        if item.get("id") in allowed_ids
    ]


def list_platform_stock_voices(
    db: Session, principal: AuthenticatedPrincipal,
) -> list:
    allowed_ids = list_accessible_asset_ids(
        db, principal, None, "voice", "platform_stock",
    )
    return [
        item for item in provider_service.legacy_voices()
        if item.get("voice_id") in allowed_ids
    ]
