"""Authorized AI workflows with request-local provider inputs."""
import logging
from dataclasses import fields
from uuid import uuid4

from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.models import Conversation, Draft
from app.transactions import Transactions, rollback_on_failure
from app.features.access import service as access
from app.features.access.permissions import Permission
from app.features.access.principal import AuthenticatedPrincipal
from . import repository, adapters, generation_service, execution
from .context import BusinessProfile, Message, OperationContext
from .schemas import SofiaChatRequest

logger = logging.getLogger(__name__)


def _authorize(db, principal, business_id, *, generation=False, write=False, lock=False):
    context = access.require_permission(db, principal, business_id,
        Permission.USE_SOFIA if write or generation else Permission.READ, lock=lock)
    if generation:
        access.require_permission(db, principal, business_id, Permission.USE_LEO)
    if write or generation:
        access.require_permission(db, principal, business_id, Permission.EDIT_CONTENT)
    return context


def _profile(db, context):
    business = repository.get_business_scoped(db, context)
    if business is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Business not found")
    return BusinessProfile(**{field.name: getattr(business, field.name) for field in fields(BusinessProfile)})


def _conversation(db, context, conversation_id, *, lock=False):
    getter = repository.lock_conversation_scoped if lock else repository.get_conversation_scoped
    conversation = getter(db, context, conversation_id)
    if conversation is None:
        raise ApplicationError(ErrorKind.NOT_FOUND, "Conversation not found for this business")
    return conversation


def _messages(db, context, conversation_id):
    result = []
    while True:
        batch = repository.list_messages_scoped(db, context, conversation_id, offset=len(result))
        result.extend(Message(message.role, message.content) for message in batch)
        if len(batch) < 100:
            return result


def _run_provider(context, operation, callback, error_message):
    attribution = OperationContext(str(uuid4()), context.business_id, context.user_id, operation)
    execution.before_generation(attribution)
    try:
        result = callback()
    except Exception as exc:
        execution.after_generation(attribution, succeeded=False)
        # Provider exceptions may contain prompts or credentials. Never log their text.
        logger.warning("AI generation failed (%s)", type(exc).__name__)
        raise ApplicationError(ErrorKind.UPSTREAM_FAILURE, error_message) from None
    execution.after_generation(attribution, succeeded=True)
    return result


@rollback_on_failure
def generate_content(business_id: str, *, db: Session, principal: AuthenticatedPrincipal) -> Draft:
    return _generate(business_id, db=db, principal=principal)


def list_sofia_conversations(business_id: str, *, db: Session, principal: AuthenticatedPrincipal):
    context = _authorize(db, principal, business_id)
    results = []
    while True:
        batch = repository.list_conversations_scoped(db, context, offset=len(results))
        for conversation in batch:
            first = repository.first_user_message_scoped(db, context, conversation.id)
            results.append({"id": conversation.id, "created_at": conversation.created_at,
                "title": first.content.strip()[:60] if first else "Nueva campaña"})
        if len(batch) < 100:
            return results


def get_sofia_conversation(business_id: str, conversation_id: str, *, db: Session,
                           principal: AuthenticatedPrincipal):
    context = _authorize(db, principal, business_id)
    _conversation(db, context, conversation_id)
    return {"conversation_id": conversation_id,
        "messages": [{"role": m.role, "content": m.content} for m in _messages(db, context, conversation_id)]}


def get_latest_sofia_conversation(business_id: str, *, db: Session, principal: AuthenticatedPrincipal):
    context = _authorize(db, principal, business_id)
    conversations = repository.list_conversations_scoped(db, context, limit=1)
    if not conversations:
        return None
    return get_sofia_conversation(business_id, conversations[0].id, db=db, principal=principal)


@rollback_on_failure
def sofia_chat(business_id: str, request: SofiaChatRequest, *, db: Session,
               principal: AuthenticatedPrincipal):
    context = _authorize(db, principal, business_id, write=True)
    profile = _profile(db, context)
    conversation_id = request.conversation_id or str(uuid4())
    messages = []
    if request.conversation_id:
        _conversation(db, context, conversation_id)
        messages = _messages(db, context, conversation_id)
    user_message = Message("user", request.message.strip())
    messages.append(user_message)
    # No locks, ORM instances, or pending writes survive the provider wait.
    Transactions(db).rollback()
    reply = _run_provider(context, "sofia_chat", lambda: adapters.chat_with_sofia(profile, messages),
                          "Sofía could not respond. Please try again.")
    context = _authorize(db, principal, business_id, write=True, lock=True)
    if request.conversation_id:
        _conversation(db, context, conversation_id, lock=True)
    else:
        repository.add_conversation_scoped(db, context, Conversation(id=conversation_id))
    repository.add_message_scoped(db, context, conversation_id, role="user", content=user_message.content)
    repository.add_message_scoped(db, context, conversation_id, role="assistant", content=reply)
    Transactions(db).commit()
    return {"conversation_id": conversation_id, "reply": reply}


@rollback_on_failure
def generate_sofia_conversation_draft(business_id: str, conversation_id: str, *, db: Session,
                                      principal: AuthenticatedPrincipal) -> Draft:
    return _generate(business_id, db=db, principal=principal, conversation_id=conversation_id)


def _generate(business_id, *, db, principal, conversation_id=None):
    context = _authorize(db, principal, business_id, generation=True)
    profile = _profile(db, context)
    kwargs = {"recent_posts": [{"title": d.title, "caption": d.caption, "platform": d.platform}
                               for d in repository.recent_drafts_scoped(db, context)]}
    if conversation_id:
        _conversation(db, context, conversation_id)
        instructions = [m.content for m in _messages(db, context, conversation_id) if m.role == "user"]
        if not instructions:
            raise ApplicationError(ErrorKind.INVALID_INPUT, "The conversation has no campaign instructions")
        kwargs["campaign_instructions"] = "\n".join(instructions[-10:])
    Transactions(db).rollback()
    generated = _run_provider(context, "conversation_draft" if conversation_id else "generate_content",
        lambda: generation_service.generate_marketing_content(profile, **kwargs),
        "Sofía and Leo could not generate the draft")
    context = _authorize(db, principal, business_id, generation=True, lock=True)
    if conversation_id:
        _conversation(db, context, conversation_id, lock=True)
    # Never accept resource IDs, ownership, approval, or publication state from AI output.
    draft = Draft(**{key: generated[key] for key in
        ("video_script", "title", "caption", "platform", "image_prompt")}, status="pending", source="ai")
    if not conversation_id:
        draft.publish_destinations = ([generated["platform"]] if generated["platform"] in
                                       ("facebook", "tiktok") else ["facebook"])
    draft_id = repository.add_draft_scoped(db, context, draft)
    Transactions(db).commit()
    context = _authorize(db, principal, business_id)
    return repository.get_draft_scoped(db, context, draft_id)


@rollback_on_failure
def delete_sofia_conversation(business_id: str, conversation_id: str, *, db: Session,
                              principal: AuthenticatedPrincipal):
    context = _authorize(db, principal, business_id, write=True, lock=True)
    _conversation(db, context, conversation_id, lock=True)
    repository.delete_conversation_scoped(db, context, conversation_id)
    Transactions(db).commit()
