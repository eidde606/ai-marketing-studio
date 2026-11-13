"""Explicit tenant SQL predicates, never membership or HTTP authorization.

Only repositories import this module. Services must obtain TenantAccess through
access.service.require_permission. A context is request-local, not a bearer token.
No implicit tenant, Session.info fallback, ORM event, or allowlist-derived scope.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session, raiseload

from app.features.access.principal import TenantAccess, TrustedTenantContext
from app.models import (
    Business, Campaign, Conversation, ConversationMessage, Draft,
    FacebookOAuthState, HeyGenGenerationAttempt, ImageRevision,
    InstagramConnection, InstagramOAuthState, SocialAccount, TikTokOAuthState,
)

_DIRECT = frozenset({Campaign, Conversation, Draft, FacebookOAuthState,
                     InstagramConnection, InstagramOAuthState, SocialAccount,
                     TikTokOAuthState})


def business_id(context: TenantAccess | TrustedTenantContext) -> str:
    if (not isinstance(context, (TenantAccess, TrustedTenantContext))
            or not isinstance(context.business_id, str) or not context.business_id.strip()):
        raise TypeError("An explicit user or trusted-job tenant context is required")
    return context.business_id


def predicate(model, context: TenantAccess):
    tenant = business_id(context)
    if model is Business:
        return Business.id == tenant
    if model in _DIRECT:
        return model.business_id == tenant
    if model is ConversationMessage:
        return select(Conversation.id).where(
            Conversation.id == ConversationMessage.conversation_id,
            Conversation.business_id == tenant,
        ).exists()
    if model is ImageRevision:
        return select(Draft.id).where(
            Draft.id == ImageRevision.draft_id, Draft.business_id == tenant,
        ).exists()
    if model is HeyGenGenerationAttempt:
        return (HeyGenGenerationAttempt.business_id == tenant) & select(Draft.id).where(
            Draft.id == HeyGenGenerationAttempt.draft_id, Draft.business_id == tenant,
        ).exists()
    raise TypeError("Resource has no tenant-scoping contract")


def selection(model, context: TenantAccess):
    # Prevent lazy ORM relationships from becoming an unscoped secondary query.
    return (select(model).where(predicate(model, context)).options(raiseload("*"))
            .execution_options(populate_existing=True))


def get(db: Session, context: TenantAccess, model, resource_id: str, *, lock=False):
    key = model.business_id if model is InstagramConnection else model.id
    statement = selection(model, context).where(key == resource_id)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    return db.scalar(statement)


def page(statement, *, limit: int, offset: int):
    if not 1 <= limit <= 100 or offset < 0:
        raise ValueError("Invalid page bounds")
    return statement.limit(limit).offset(offset)


def validate_storage_path(context: TenantAccess, path: str) -> None:
    prefix = f"businesses/{business_id(context)}/"
    if (not isinstance(path, str) or not path.startswith(prefix) or "\\" in path
            or any(part in {"", ".", ".."} for part in path[len(prefix):].split("/"))):
        raise ValueError("Storage path must belong to the explicit business context")


def insert_record(db: Session, context: TenantAccess, record):
    """Insert a transient record only if its tenant and referenced parents match.

    INSERT ... SELECT avoids a read-then-add window and never attaches a caller's
    ORM instance (or cascaded relationships) to the session. Returns PK or None;
    the service owns commit and any subsequent scoped fetch. No ORM dirty-object
    flush can bypass the statement's tenant predicates through this helper.
    """
    from sqlalchemy import insert, inspect, literal

    tenant_id = business_id(context)
    state = inspect(record)
    model = type(record)
    if not state.transient or model not in _DIRECT | {ImageRevision, ConversationMessage, HeyGenGenerationAttempt}:
        raise ValueError("A supported transient resource is required")
    if any(record.__dict__.get(r.key) is not None for r in state.mapper.relationships):
        raise ValueError("Insert references by ID, not ORM relationships")
    values = {column.key: record.__dict__[column.key] for column in model.__table__.columns
              if column.key in record.__dict__}
    if "business_id" in model.__table__.columns:
        if values.get("business_id", tenant_id) != tenant_id:
            raise ValueError("Resource business does not match context")
        values["business_id"] = tenant_id
    conditions = [select(Business.id).where(Business.id == tenant_id).exists()]

    def parent(parent_model, key, reference):
        conditions.append(select(key).where(key == reference, predicate(parent_model, context)).exists())

    if model in {ImageRevision, HeyGenGenerationAttempt}:
        parent(Draft, Draft.id, values.get("draft_id"))
    if model is ConversationMessage:
        parent(Conversation, Conversation.id, values.get("conversation_id"))
    if model is Draft:
        if values.get("campaign_id") is not None:
            parent(Campaign, Campaign.id, values["campaign_id"])
        if values.get("tiktok_account_id") is not None:
            conditions.append(select(SocialAccount.id).where(
                predicate(SocialAccount, context), SocialAccount.id == values["tiktok_account_id"],
                SocialAccount.platform == "tiktok").exists())
    if model in {InstagramConnection, InstagramOAuthState} and values.get("facebook_page_id") is not None:
        conditions.append(select(SocialAccount.id).where(
            predicate(SocialAccount, context), SocialAccount.platform == "facebook",
            SocialAccount.platform_account_id == values["facebook_page_id"]).exists())
    for field in {"image_url", "video_url", "original_image_path", "revised_image_path", "storage_path"} & values.keys():
        if values[field] is not None:
            validate_storage_path(context, values[field])
    key = model.business_id if model is InstagramConnection else (
        model.state_hash if model in {FacebookOAuthState, InstagramOAuthState, TikTokOAuthState} else model.id)
    source = select(*(literal(value, type_=model.__table__.c[name].type) for name, value in values.items()))\
        .where(*conditions)
    return db.execute(insert(model).from_select(list(values), source).returning(key)).scalar_one_or_none()
