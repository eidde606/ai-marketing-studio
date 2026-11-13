"""SQLAlchemy operations for Facebook OAuth and connected Pages."""
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import Business, Draft, FacebookOAuthState, SocialAccount


from app.features.access.principal import TenantAccess
from app.persistence import tenant
from app.features.drafts.repository import get_draft_scoped


def get_business(db: Session, business_id: str) -> Business | None:
    return db.get(Business, business_id)


def add_oauth_state(db: Session, state: FacebookOAuthState) -> None:
    db.add(state)


def oauth_state_identity(db: Session, state_hash: str, now: datetime):
    row = db.execute(select(
        FacebookOAuthState.business_id, FacebookOAuthState.user_id,
    ).where(
        FacebookOAuthState.state_hash == state_hash,
        FacebookOAuthState.expires_at > now,
        FacebookOAuthState.selection_token_hash.is_(None),
    )).one_or_none()
    return row


def consume_oauth_state(
    db: Session,
    state_hash: str,
    now: datetime,
) -> tuple[str, str] | None:
    result = db.execute(
        _consume_oauth_state_statement(state_hash, now)
    )
    row = result.first()
    return (row.business_id, row.user_id) if row is not None else None


def add_pending_selection(
    db: Session,
    pending: FacebookOAuthState,
) -> None:
    db.add(pending)


def get_pending_handoff(
    db: Session,
    token_hash: str,
    user_id: str,
    now: datetime,
) -> FacebookOAuthState | None:
    return db.scalar(
        select(FacebookOAuthState).where(
            FacebookOAuthState.selection_token_hash == token_hash,
            FacebookOAuthState.user_id == user_id,
            FacebookOAuthState.expires_at > now,
        )
    )


def pending_selection_business(
    db: Session,
    token_hash: str,
    user_id: str,
    now: datetime,
) -> str | None:
    return db.scalar(select(FacebookOAuthState.business_id).where(
        FacebookOAuthState.selection_token_hash == token_hash,
        FacebookOAuthState.user_id == user_id,
        FacebookOAuthState.expires_at > now,
    ))


def lock_pending_selection(
    db: Session,
    token_hash: str,
    user_id: str,
    now: datetime,
) -> FacebookOAuthState | None:
    return db.scalar(
        select(FacebookOAuthState)
        .where(
            FacebookOAuthState.selection_token_hash == token_hash,
            FacebookOAuthState.expires_at > now,
            FacebookOAuthState.user_id == user_id,
        )
        .with_for_update()
    )


def get_page_account(
    db: Session,
    business_id: str,
    page_id: str,
) -> SocialAccount | None:
    return db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "facebook",
            SocialAccount.platform_account_id == page_id,
        )
    )


def add_social_account(db: Session, account: SocialAccount) -> None:
    db.add(account)


def delete_pending_selection(
    db: Session,
    pending: FacebookOAuthState,
) -> None:
    db.delete(pending)


def list_page_accounts(db: Session, business_id: str) -> list[SocialAccount]:
    return db.scalars(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "facebook",
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


def get_connected_page(db: Session, business_id: str) -> SocialAccount | None:
    return db.scalar(
        select(SocialAccount).where(
            SocialAccount.business_id == business_id,
            SocialAccount.platform == "facebook",
            SocialAccount.connection_status == "connected",
        )
    )


def claim_publication(db: Session, draft_id: str) -> bool:
    result = db.execute(
        _claim_publication_statement(draft_id)
    )
    return result.scalar_one_or_none() is not None


def reset_publication(db: Session, draft_id: str) -> bool:
    result = db.execute(
        _reset_publication_statement(draft_id)
    )
    return result.scalar_one_or_none() is not None


def _claim_publication_statement(draft_id):
    return (
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.deleted_at.is_(None),
            Draft.status == "approved",
            Draft.facebook_publish_status == "not_published",
            Draft.facebook_post_id.is_(None),
        )
        .values(facebook_publish_status="publishing")
        .returning(Draft.id)
    )


def _reset_publication_statement(draft_id):
    return (
        update(Draft)
        .where(
            Draft.id == draft_id,
            Draft.deleted_at.is_(None),
            Draft.status == "approved",
            Draft.facebook_publish_status == "needs_review",
            Draft.facebook_post_id.is_(None),
        )
        .values(facebook_publish_status="not_published")
        .returning(Draft.id)
    )


def _consume_oauth_state_statement(state_hash, now):
    return (
        delete(FacebookOAuthState)
        .where(
            FacebookOAuthState.state_hash == state_hash,
            FacebookOAuthState.expires_at > now,
            FacebookOAuthState.selection_token_hash.is_(None),
        )
        .returning(
            FacebookOAuthState.business_id,
            FacebookOAuthState.user_id,
        )
    )




def get_account_scoped(db: Session, context: TenantAccess, account_id: str):
    return db.scalar(tenant.selection(SocialAccount, context).where(
        SocialAccount.id == account_id, SocialAccount.platform == "facebook"))


def get_connected_page_scoped(db: Session, context: TenantAccess):
    return db.scalar(tenant.selection(SocialAccount, context).where(
        SocialAccount.platform == "facebook",
        SocialAccount.connection_status == "connected",
    ))


def get_page_account_scoped(db: Session, context: TenantAccess, page_id: str):
    return db.scalar(tenant.selection(SocialAccount, context).where(
        SocialAccount.platform == "facebook",
        SocialAccount.platform_account_id == page_id,
    ))


def list_accounts_scoped(db: Session, context: TenantAccess, *, limit=100, offset=0):
    return db.scalars(tenant.page(tenant.selection(SocialAccount, context)
        .where(SocialAccount.platform == "facebook").order_by(SocialAccount.id), limit=limit, offset=offset)).all()


def claim_publication_scoped(db: Session, context: TenantAccess, draft_id: str) -> bool:
    return db.execute(_claim_publication_statement(draft_id).where(tenant.predicate(Draft, context)))\
        .scalar_one_or_none() is not None


def reset_publication_scoped(db: Session, context: TenantAccess, draft_id: str) -> bool:
    return db.execute(_reset_publication_statement(draft_id).where(tenant.predicate(Draft, context)))\
        .scalar_one_or_none() is not None


def consume_oauth_state_scoped(db: Session, context: TenantAccess, state_hash: str,
                               initiator_subject: str, now: datetime):
    row = db.execute(_consume_oauth_state_statement(state_hash, now).where(
        tenant.predicate(FacebookOAuthState, context), FacebookOAuthState.user_id == initiator_subject,
    )).first()
    return (row.business_id, row.user_id) if row is not None else None


def get_pending_selection_scoped(db: Session, context: TenantAccess, token_hash: str,
                                 initiator_subject: str, now: datetime, *, lock=False):
    statement = tenant.selection(FacebookOAuthState, context).where(
        FacebookOAuthState.selection_token_hash == token_hash,
        FacebookOAuthState.user_id == initiator_subject, FacebookOAuthState.expires_at > now)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    return db.scalar(statement)


def delete_pending_selection_scoped(db: Session, context: TenantAccess, token_hash: str,
                                    initiator_subject: str) -> bool:
    return db.execute(delete(FacebookOAuthState).where(
        tenant.predicate(FacebookOAuthState, context),
        FacebookOAuthState.selection_token_hash == token_hash,
        FacebookOAuthState.user_id == initiator_subject,
    ).returning(FacebookOAuthState.state_hash)).scalar_one_or_none() is not None


def add_account_scoped(db: Session, context: TenantAccess, record: SocialAccount):
    if not isinstance(record, SocialAccount):
        raise TypeError("Expected SocialAccount")
    if record.platform != "facebook":
        raise ValueError("Account platform does not match repository")
    return tenant.insert_record(db, context, record)


def add_oauth_state_scoped(db: Session, context: TenantAccess, record: FacebookOAuthState):
    if not isinstance(record, FacebookOAuthState):
        raise TypeError("Expected FacebookOAuthState")
    return tenant.insert_record(db, context, record)


def update_account_scoped(db: Session, context: TenantAccess, account_id: str, values: dict) -> bool:
    allowed = {"account_name", "encrypted_access_token", "token_expires_at", "connection_status"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported Facebook account fields")
    return db.execute(update(SocialAccount).where(
        tenant.predicate(SocialAccount, context), SocialAccount.id == account_id,
        SocialAccount.platform == "facebook",
    ).values(**values).returning(SocialAccount.id)).scalar_one_or_none() is not None


def save_publication_scoped(db: Session, context: TenantAccess, draft_id: str, *,
                            expected_status: str, values: dict) -> bool:
    allowed = {"facebook_post_id", "facebook_publish_status", "published_at"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported Facebook publication fields")
    return db.execute(update(Draft).where(
        tenant.predicate(Draft, context), Draft.id == draft_id,
        Draft.facebook_publish_status == expected_status,
    ).values(**values).returning(Draft.id)).scalar_one_or_none() is not None


def save_claimed_publication_scoped(
    db: Session,
    context: TenantAccess,
    draft_id: str,
    *,
    expected_status: str = "publishing",
    values: dict,
) -> bool:
    """Persist only the outcome of an already claimed provider operation."""
    allowed = {"facebook_post_id", "facebook_publish_status", "published_at"}
    if not values or not set(values) <= allowed:
        raise ValueError("Unsupported Facebook publication fields")
    return db.execute(update(Draft).where(
        tenant.predicate(Draft, context),
        Draft.id == draft_id,
        Draft.facebook_publish_status == expected_status,
    ).values(**values).returning(Draft.id)).scalar_one_or_none() is not None
