"""Persistence statements extracted without changing predicates or lock ordering."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Business, Conversation, ConversationMessage, Draft


from app.features.access.principal import TenantAccess
from app.persistence import tenant


def get_business(db: Session, business_id: str) -> Business | None:
    return db.get(Business, business_id)


def recent_drafts(db: Session, business: Business) -> list[Draft]:
    return db.scalars(
        select(Draft)
        .where(Draft.business_id == business.id)
        .order_by(Draft.created_at.desc())
        .limit(10)
    ).all()


def add_draft(db: Session, draft: Draft) -> None:
    db.add(draft)


def list_conversations(
    db: Session,
    business: Business,
) -> list[Conversation]:
    return db.scalars(
        select(Conversation)
        .where(Conversation.business_id == business.id)
        .order_by(Conversation.created_at.desc(), Conversation.id.desc())
    ).all()


def first_user_message(
    db: Session,
    conversation: Conversation,
) -> ConversationMessage | None:
    return db.scalar(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == conversation.id,
            ConversationMessage.role == "user",
        )
        .order_by(
            ConversationMessage.created_at.asc(),
            ConversationMessage.id.asc(),
        )
        .limit(1)
    )


def get_scoped_conversation(
    db: Session,
    business_id: str,
    conversation_id: str,
) -> Conversation | None:
    return db.scalar(
        select(Conversation)
        .join(Business, Conversation.business_id == Business.id)
        .where(
            Conversation.id == conversation_id,
            Business.id == business_id,
        )
    )


def list_messages(
    db: Session,
    conversation: Conversation,
) -> list[ConversationMessage]:
    return db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation.id)
        .order_by(
            ConversationMessage.created_at.asc(),
            ConversationMessage.id.asc(),
        )
    ).all()


def latest_conversation(
    db: Session,
    business: Business,
) -> Conversation | None:
    return db.scalar(
        select(Conversation)
        .where(Conversation.business_id == business.id)
        .order_by(Conversation.created_at.desc(), Conversation.id.desc())
        .limit(1)
    )


def get_requested_conversation(
    db: Session,
    business: Business,
    conversation_id: str,
) -> Conversation | None:
    return db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.business_id == business.id,
        )
    )


def add_conversation(db: Session, conversation: Conversation) -> None:
    db.add(conversation)


def flush(db: Session) -> None:
    db.flush()


def add_user_message(db: Session, user_message: ConversationMessage) -> None:
    db.add(user_message)


def add_assistant_message(
    db: Session,
    assistant_message: ConversationMessage,
) -> None:
    db.add(assistant_message)


def get_conversation(
    db: Session,
    business: Business,
    conversation_id: str,
) -> Conversation | None:
    return db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.business_id == business.id,
        )
    )




def get_conversation_scoped(db: Session, context: TenantAccess, conversation_id: str):
    return tenant.get(db, context, Conversation, conversation_id)


def list_conversations_scoped(db: Session, context: TenantAccess, *, limit=100, offset=0):
    return db.scalars(tenant.page(tenant.selection(Conversation, context)
        .order_by(Conversation.created_at.desc(), Conversation.id.desc()), limit=limit, offset=offset)).all()


def list_messages_scoped(db: Session, context: TenantAccess, conversation_id: str, *, limit=100, offset=0):
    return db.scalars(tenant.page(tenant.selection(ConversationMessage, context)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at, ConversationMessage.id), limit=limit, offset=offset)).all()


def add_message_scoped(db: Session, context: TenantAccess, conversation_id: str, *, role: str, content: str):
    if role not in {"user", "assistant"}:
        raise ValueError("Unsupported conversation role")
    return tenant.insert_record(db, context, ConversationMessage(
        conversation_id=conversation_id, role=role, content=content,
    ))


def add_conversation_scoped(db: Session, context: TenantAccess, record: Conversation):
    if not isinstance(record, Conversation):
        raise TypeError("Expected Conversation")
    return tenant.insert_record(db, context, record)
