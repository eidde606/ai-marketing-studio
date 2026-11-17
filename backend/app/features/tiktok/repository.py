"""SQLAlchemy operations for TikTok OAuth state and accounts."""
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import Business, Draft, SocialAccount, TikTokOAuthState


from app.features.access.principal import TenantAccess
from app.persistence import tenant
from app.features.drafts.repository import get_draft_scoped


def get_business(db: Session, business_id: str) -> Business | None:
    return db.get(Business, business_id)


def add_oauth_state(db: Session, state: TikTokOAuthState) -> None:
    db.add(state)


def oauth_state_identity(db: Session, state_hash: str, now: datetime):
    return db.execute(select(
        TikTokOAuthState.business_id, TikTokOAuthState.user_id,
    ).where(
        TikTokOAuthState.state_hash == state_hash,
        TikTokOAuthState.expires_at > now,
    )).one_or_none()


def consume_oauth_state(
    db: Session,
    state_hash: str,
    now: datetime,
) -> str | None:
    result = db.execute(
        _consume_oauth_state_statement(state_hash, now)
    )
    return result.scalar_one_or_none()


def get_account(
    db: Session,
    business_id: str,
    platform_account_id: str,
) -> SocialAccount | None:
    return db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "tiktok",
            SocialAccount.platform_account_id == platform_account_id,
        )
    )


def add_account(db: Session, account: SocialAccount) -> None:
    db.add(account)


def save_refreshed_credentials(
    account: SocialAccount,
    *,
    encrypted_access_token: str,
    encrypted_refresh_token: str,
    token_expires_at: datetime,
) -> None:
    account.encrypted_access_token = encrypted_access_token
    account.encrypted_refresh_token = encrypted_refresh_token
    account.token_expires_at = token_expires_at


def list_accounts(db: Session, business_id: str) -> list[SocialAccount]:
    return db.scalars(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "tiktok",
        )
    ).all()


def get_draft(
    db: Session,
    draft_id: str,
    *,
    include_deleted: bool = False,
) -> Draft | None:
    statement = select(Draft).where(Draft.id == draft_id)
    if not include_deleted:
        statement = statement.where(Draft.deleted_at.is_(None))
    return db.scalar(statement)


def get_connected_account(
    db: Session,
    business_id: str,
    account_id: str | None,
) -> SocialAccount | None:
    return db.scalar(
        select(SocialAccount).where(
            SocialAccount.id == account_id,
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "tiktok",
            SocialAccount.connection_status == "connected",
        )
    )


def claim_publication(
    db: Session,
    draft_id: str,
    account_id: str,
) -> bool:
    result = db.execute(
        _claim_publication_statement(draft_id, account_id)
    )
    return result.scalar_one_or_none() is not None


def _claim_publication_statement(draft_id, account_id):
    return (
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.deleted_at.is_(None),
            Draft.status == "approved",
            Draft.tiktok_publish_status == "not_published",
            Draft.tiktok_publish_id.is_(None),
        )
        .values(
            tiktok_publish_status="publishing",
            tiktok_account_id=account_id,
        )
        .returning(Draft.id)
    )


def _consume_oauth_state_statement(state_hash, now):
    return (
        delete(TikTokOAuthState)
        .where(
            TikTokOAuthState.state_hash == state_hash,
            TikTokOAuthState.expires_at > now,
        )
        .returning(TikTokOAuthState.business_id)
    )




def get_account_scoped(db: Session, context: TenantAccess, account_id: str):
    return db.scalar(tenant.selection(SocialAccount, context).where(
        SocialAccount.id == account_id, SocialAccount.platform == "tiktok"))


def get_connected_account_scoped(db: Session, context: TenantAccess, account_id: str):
    return db.scalar(tenant.selection(SocialAccount, context).where(
        SocialAccount.id == account_id,
        SocialAccount.platform == "tiktok",
        SocialAccount.connection_status == "connected",
    ))


def validate_storage_path_scoped(db: Session, context: TenantAccess, path: str) -> None:
    tenant.validate_storage_path(context, path)


def get_platform_account_scoped(db: Session, context: TenantAccess, platform_account_id: str):
    return db.scalar(tenant.selection(SocialAccount, context).where(
        SocialAccount.platform == "tiktok",
        SocialAccount.platform_account_id == platform_account_id,
    ))


def list_accounts_scoped(db: Session, context: TenantAccess, *, limit=100, offset=0):
    return db.scalars(tenant.page(tenant.selection(SocialAccount, context)
        .where(SocialAccount.platform == "tiktok").order_by(SocialAccount.id), limit=limit, offset=offset)).all()


def claim_publication_scoped(db: Session, context: TenantAccess, draft_id: str, account_id: str) -> bool:
    return db.execute(_claim_publication_statement(draft_id, account_id).where(
        tenant.predicate(Draft, context), select(SocialAccount.id).where(
            tenant.predicate(SocialAccount, context), SocialAccount.id == account_id,
            SocialAccount.platform == "tiktok", SocialAccount.connection_status == "connected",
        ).exists(),
    )).scalar_one_or_none() is not None


def save_refreshed_credentials_scoped(db: Session, context: TenantAccess, account_id: str, *,
                                      encrypted_access_token: str, encrypted_refresh_token: str,
                                      token_expires_at: datetime,
                                      expected_refresh_token: str) -> bool:
    return db.execute(update(SocialAccount).where(
        tenant.predicate(SocialAccount, context), SocialAccount.id == account_id,
        SocialAccount.platform == "tiktok", SocialAccount.connection_status == "connected",
        SocialAccount.encrypted_refresh_token == expected_refresh_token,
    ).values(encrypted_access_token=encrypted_access_token, encrypted_refresh_token=encrypted_refresh_token,
             token_expires_at=token_expires_at).returning(SocialAccount.id)).scalar_one_or_none() is not None


def save_refreshed_credentials_after_exchange_scoped(
    db: Session,
    context: TenantAccess,
    account_id: str,
    *,
    encrypted_access_token: str,
    encrypted_refresh_token: str,
    token_expires_at: datetime,
    expected_refresh_token: str,
) -> bool:
    """Complete an in-flight provider refresh without granting further access."""
    return db.execute(update(SocialAccount).where(
        tenant.predicate(SocialAccount, context),
        SocialAccount.id == account_id,
        SocialAccount.platform == "tiktok",
        SocialAccount.connection_status == "connected",
        SocialAccount.encrypted_refresh_token == expected_refresh_token,
    ).values(
        encrypted_access_token=encrypted_access_token,
        encrypted_refresh_token=encrypted_refresh_token,
        token_expires_at=token_expires_at,
    ).returning(SocialAccount.id)).scalar_one_or_none() is not None


def update_account_scoped(db: Session, context: TenantAccess, account_id: str, values: dict) -> bool:
    allowed = {"account_name", "encrypted_access_token", "encrypted_refresh_token",
               "token_expires_at", "connection_status"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported TikTok account fields")
    return db.execute(update(SocialAccount).where(
        tenant.predicate(SocialAccount, context), SocialAccount.id == account_id,
        SocialAccount.platform == "tiktok",
    ).values(**values).returning(SocialAccount.id)).scalar_one_or_none() is not None


def consume_oauth_state_scoped(db: Session, context: TenantAccess, state_hash: str,
                               initiator_subject: str, now: datetime):
    return db.execute(_consume_oauth_state_statement(state_hash, now).where(
        tenant.predicate(TikTokOAuthState, context), TikTokOAuthState.user_id == initiator_subject,
    )).scalar_one_or_none()


def add_account_scoped(db: Session, context: TenantAccess, record: SocialAccount):
    if not isinstance(record, SocialAccount):
        raise TypeError("Expected SocialAccount")
    if record.platform != "tiktok":
        raise ValueError("Account platform does not match repository")
    return tenant.insert_record(db, context, record)


def add_oauth_state_scoped(db: Session, context: TenantAccess, record: TikTokOAuthState):
    if not isinstance(record, TikTokOAuthState):
        raise TypeError("Expected TikTokOAuthState")
    return tenant.insert_record(db, context, record)


def save_publication_scoped(db: Session, context: TenantAccess, draft_id: str, *,
                            expected_status: str, values: dict) -> bool:
    allowed = {"tiktok_publish_id", "tiktok_publish_status", "published_at"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported TikTok publication fields")
    return db.execute(update(Draft).where(
        tenant.predicate(Draft, context), Draft.id == draft_id,
        Draft.tiktok_publish_status == expected_status,
    ).values(**values).returning(Draft.id)).scalar_one_or_none() is not None


def save_claimed_publication_scoped(
    db: Session,
    context: TenantAccess,
    draft_id: str,
    *,
    expected_status: str,
    values: dict,
) -> bool:
    """Persist only the outcome of an already claimed provider operation."""
    allowed = {"tiktok_publish_id", "tiktok_publish_status", "published_at"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported TikTok publication fields")
    return db.execute(update(Draft).where(
        tenant.predicate(Draft, context),
        Draft.id == draft_id,
        Draft.tiktok_publish_status == expected_status,
    ).values(**values).returning(Draft.id)).scalar_one_or_none() is not None


def release_publication_claim_scoped(
    db: Session,
    context: TenantAccess,
    draft_id: str,
) -> bool:
    return db.execute(update(Draft).where(
        tenant.predicate(Draft, context),
        Draft.id == draft_id,
        Draft.tiktok_publish_status == "publishing",
        Draft.tiktok_publish_id.is_(None),
    ).values(
        tiktok_publish_status="not_published",
        tiktok_account_id=None,
    ).returning(Draft.id)).scalar_one_or_none() is not None
