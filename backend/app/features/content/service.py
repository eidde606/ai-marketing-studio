"""Application workflows; preserve existing ordering and transaction policy."""
import logging

from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.models import Conversation, ConversationMessage, Draft
from app.transactions import Transactions
from . import repository
from . import adapters, generation_service
from .schemas import SofiaChatRequest

logger = logging.getLogger(__name__)


def generate_content(business_id: str, *, db: Session) -> Draft:
    business = repository.get_business(db, business_id)
    if business is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
    recent_drafts = repository.recent_drafts(db, business)
    recent_posts = [
        {
            "title": draft.title,
            "caption": draft.caption,
            "platform": draft.platform,
        }
        for draft in recent_drafts
    ]
    generated = generation_service.generate_marketing_content(
        business,
        recent_posts=recent_posts,
    )
    draft = Draft(
        video_script=generated["video_script"],
        business_id=business.id,
        title=generated["title"],
        caption=generated["caption"],
        platform=generated["platform"],
        publish_destinations=(
            [generated["platform"]]
            if generated["platform"] in ("facebook", "tiktok")
            else ["facebook"]
        ),
        image_prompt=generated["image_prompt"],
        status="pending",
        source="ai",
    )
    repository.add_draft(db, draft)
    transactions = Transactions(db)
    transactions.commit()
    transactions.refresh(draft)
    return draft


def list_sofia_conversations(
    business_id: str,
    *,
    db: Session,
) -> list[dict[str, object]]:
    business = repository.get_business(db, business_id)
    if business is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
    conversations = repository.list_conversations(db, business)
    results = []
    for conversation in conversations:
        first_message = repository.first_user_message(db, conversation)
        title = (
            first_message.content.strip()[:60]
            if first_message
            else "Nueva campaña"
        )
        results.append(
            {
                "id": conversation.id,
                "created_at": conversation.created_at,
                "title": title,
            }
        )
    return results


def get_sofia_conversation(
    business_id: str,
    conversation_id: str,
    *,
    db: Session,
) -> dict[str, object]:
    conversation = repository.get_scoped_conversation(db, business_id, conversation_id)
    if conversation is None:
        raise ApplicationError(
            ErrorKind.NOT_FOUND,
            "Conversation not found for this business",
        )
    messages = repository.list_messages(db, conversation)
    return {
        "conversation_id": conversation.id,
        "messages": [
            {"role": message.role, "content": message.content}
            for message in messages
        ],
    }


def get_latest_sofia_conversation(
    business_id: str,
    *,
    db: Session,
) -> dict[str, object] | None:
    """Retrieve the latest Sofía conversation for a business."""
    business = repository.get_business(db, business_id)
    if business is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
    conversation = repository.latest_conversation(db, business)
    if conversation is None:
        return None
    messages = repository.list_messages(db, conversation)
    return {
        "conversation_id": conversation.id,
        "messages": [
            {"role": message.role, "content": message.content}
            for message in messages
        ],
    }


def sofia_chat(
    business_id: str,
    request: SofiaChatRequest,
    *,
    db: Session,
) -> dict[str, str]:
    """Start or continue a conversation with Sofía."""
    business = repository.get_business(db, business_id)
    if business is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
    if request.conversation_id:
        conversation = repository.get_requested_conversation(
            db,
            business,
            request.conversation_id,
        )
        if conversation is None:
            raise ApplicationError(
                ErrorKind.NOT_FOUND,
                "Conversation not found for this business",
            )
    else:
        conversation = Conversation(business_id=business.id)
        repository.add_conversation(db, conversation)
        repository.flush(db)
    user_message = ConversationMessage(
        conversation_id=conversation.id,
        role="user",
        content=request.message.strip(),
    )
    repository.add_user_message(db, user_message)
    repository.flush(db)
    messages = repository.list_messages(db, conversation)
    try:
        reply = adapters.chat_with_sofia(business, messages)
    except Exception:
        Transactions(db).rollback()
        logger.exception("Sofía chat generation failed")
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Sofía could not respond. Please try again.",
        )
    assistant_message = ConversationMessage(
        conversation_id=conversation.id,
        role="assistant",
        content=reply,
    )
    repository.add_assistant_message(db, assistant_message)
    Transactions(db).commit()
    return {"conversation_id": conversation.id, "reply": reply}


def generate_sofia_conversation_draft(
    business_id: str,
    conversation_id: str,
    *,
    db: Session,
) -> Draft:
    """Generate a pending draft using Sofía's conversation and Leo."""
    business = repository.get_business(db, business_id)
    if business is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
    conversation = repository.get_conversation(db, business, conversation_id)
    if conversation is None:
        raise ApplicationError(
            ErrorKind.NOT_FOUND,
            "Conversation not found for this business",
        )
    messages = repository.list_messages(db, conversation)
    user_messages = [
        message.content for message in messages if message.role == "user"
    ]
    if not user_messages:
        raise ApplicationError(
            ErrorKind.INVALID_INPUT,
            "The conversation has no campaign instructions",
        )
    campaign_instructions = "\n".join(user_messages[-10:])
    recent_drafts = repository.recent_drafts(db, business)
    recent_posts = [
        {
            "title": draft.title,
            "caption": draft.caption,
            "platform": draft.platform,
        }
        for draft in recent_drafts
    ]
    try:
        generated = generation_service.generate_marketing_content(
            business,
            recent_posts=recent_posts,
            campaign_instructions=campaign_instructions,
        )
    except Exception:
        logger.exception("Conversational draft generation failed")
        raise ApplicationError(
            ErrorKind.UPSTREAM_FAILURE,
            "Sofía and Leo could not generate the draft",
        )
    draft = Draft(
        video_script=generated["video_script"],
        business_id=business.id,
        title=generated["title"],
        caption=generated["caption"],
        platform=generated["platform"],
        image_prompt=generated["image_prompt"],
        status="pending",
        source="ai",
    )
    repository.add_draft(db, draft)
    transactions = Transactions(db)
    transactions.commit()
    transactions.refresh(draft)
    return draft
