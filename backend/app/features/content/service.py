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
from app.features.entitlements import service as entitlement_service
from .context import BusinessProfile, Message, OperationContext
from .schemas import SofiaChatRequest, AIGenerationRequest
from .context import LanguagePreferences
from app.features.accounts import service as accounts

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


def _replay_sofia_usage(db, context, reservation):
    if reservation.status == "succeeded" and reservation.result_id:
        message = repository.get_message_scoped(db, context, reservation.result_id)
        if message is not None and message.role == "assistant":
            conversation = _conversation(db, context, message.conversation_id)
            return {
                "conversation_id": conversation.id,
                "reply": message.content,
                "language": conversation.language,
            }
    raise ApplicationError(ErrorKind.CONFLICT, "This request was already processed; use a new idempotency key")


def _replay_generation(db, context, reservation):
    if reservation.status == "succeeded" and reservation.result_id:
        draft = repository.get_draft_scoped(db, context, reservation.result_id)
        if draft is not None:
            return draft
    raise ApplicationError(ErrorKind.CONFLICT, "This request was already processed; use a new idempotency key")


def _run_provider(context, operation, callback, error_message, languages=LanguagePreferences()):
    attribution = OperationContext(str(uuid4()), context.business_id, context.user_id, operation, languages)
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
def generate_content(business_id: str, *, db: Session, principal: AuthenticatedPrincipal, request: AIGenerationRequest | None = None) -> Draft:
    return _generate(business_id, db=db, principal=principal, request=request)


def list_sofia_conversations(business_id: str, *, db: Session, principal: AuthenticatedPrincipal):
    context = _authorize(db, principal, business_id)
    results = []
    while True:
        batch = repository.list_conversations_scoped(db, context, offset=len(results))
        for conversation in batch:
            first = repository.first_user_message_scoped(db, context, conversation.id)
            results.append({"id": conversation.id, "created_at": conversation.created_at,
                "title": first.content.strip()[:60] if first else "Planning chat", "language": conversation.language})
        if len(batch) < 100:
            return results


def get_sofia_conversation(business_id: str, conversation_id: str, *, db: Session,
                           principal: AuthenticatedPrincipal):
    context = _authorize(db, principal, business_id)
    conversation = _conversation(db, context, conversation_id)
    return {"conversation_id": conversation_id, "language": conversation.language,
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
    preferences = accounts.language_preferences(db, principal)
    conversation_language = request.conversation_language or preferences["conversation_language"]
    messages = []
    if request.conversation_id:
        conversation = _conversation(db, context, conversation_id)
        conversation_language = request.conversation_language or conversation.language or conversation_language
        messages = _messages(db, context, conversation_id)
    reservation, replay = entitlement_service.reserve_usage(
        db, principal, business_id=business_id, metric="sofia_request",
        idempotency_key=request.idempotency_key,
    )
    if replay:
        return _replay_sofia_usage(db, context, reservation)
    if reservation is not None:
        Transactions(db).commit()
    user_message = Message("user", request.message.strip())
    messages.append(user_message)
    # No locks, ORM instances, or pending writes survive the provider wait.
    Transactions(db).rollback()
    try:
        reply = _run_provider(context, "sofia_chat", lambda: adapters.chat_with_sofia(profile, messages, language=conversation_language),
                              "Sofía could not respond. Please try again.",
                              LanguagePreferences(preferences["interface_language"], conversation_language, None))
    except ApplicationError:
        if reservation is not None:
            entitlement_service.finish_usage(db, reservation.id, succeeded=False)
        raise
    if reservation is not None:
        entitlement_service.finish_usage(db, reservation.id, succeeded=True)
    context = _authorize(db, principal, business_id, write=True, lock=True)
    if request.conversation_id:
        conversation = _conversation(db, context, conversation_id, lock=True)
        conversation.language = conversation_language
    else:
        repository.add_conversation_scoped(db, context, Conversation(id=conversation_id, language=conversation_language))
    repository.add_message_scoped(db, context, conversation_id, role="user", content=user_message.content)
    assistant_message = repository.add_message_scoped(
        db, context, conversation_id, role="assistant", content=reply,
    )
    Transactions(db).commit()
    if reservation is not None:
        entitlement_service.finish_usage(
            db, reservation.id, succeeded=True, result_id=assistant_message.id,
        )
    return {"conversation_id": conversation_id, "reply": reply, "language": conversation_language}


@rollback_on_failure
def generate_sofia_conversation_draft(business_id: str, conversation_id: str, *, db: Session,
                                      principal: AuthenticatedPrincipal, request: AIGenerationRequest | None = None) -> Draft:
    return _generate(business_id, db=db, principal=principal, conversation_id=conversation_id, request=request)


def _generate(business_id, *, db, principal, conversation_id=None, request=None):
    context = _authorize(db, principal, business_id, generation=True)
    profile = _profile(db, context)
    request = request or AIGenerationRequest()
    preferences = accounts.language_preferences(db, principal)
    business_preferences = accounts.business_preferences(db, principal, business_id)
    conversation_language = request.conversation_language or preferences["conversation_language"]
    content_language = request.marketing_content_language or business_preferences["marketing_content_language"]
    kwargs = {"recent_posts": [{"title": d.title, "caption": d.caption, "platform": d.platform}
                               for d in repository.recent_drafts_scoped(db, context)]}
    if conversation_id:
        conversation = _conversation(db, context, conversation_id)
        conversation_language = request.conversation_language or conversation.language or conversation_language
        instructions = [m.content for m in _messages(db, context, conversation_id) if m.role == "user"]
        if not instructions:
            raise ApplicationError(ErrorKind.INVALID_INPUT, "The conversation has no campaign instructions")
        kwargs["campaign_instructions"] = "\n".join(instructions[-10:])
    kwargs.update(conversation_language=conversation_language, marketing_content_language=content_language)
    languages = LanguagePreferences(preferences["interface_language"], conversation_language, content_language)
    sofia_reservation, sofia_replay = entitlement_service.reserve_usage(
        db, principal, business_id=business_id, metric="sofia_request",
        idempotency_key=request.idempotency_key,
    )
    leo_reservation, leo_replay = entitlement_service.reserve_usage(
        db, principal, business_id=business_id, metric="leo_generation",
        idempotency_key=request.idempotency_key,
    )
    if sofia_replay != leo_replay:
        raise ApplicationError(ErrorKind.CONFLICT, "This request was already processed; use a new idempotency key")
    if sofia_replay:
        return _replay_generation(db, context, leo_reservation)
    reservations = [
        item for item in (sofia_reservation, leo_reservation) if item is not None
    ]
    if reservations:
        Transactions(db).commit()
    Transactions(db).rollback()
    try:
        generated = _run_provider(context, "conversation_draft" if conversation_id else "generate_content",
            lambda: generation_service.generate_marketing_content(profile, **kwargs),
            "Sofía and Leo could not generate the draft", languages)
    except ApplicationError:
        if reservations:
            entitlement_service.finish_usage_batch(
                db, [item.id for item in reservations], succeeded=False,
            )
        raise
    if reservations:
        entitlement_service.finish_usage_batch(
            db, [item.id for item in reservations], succeeded=True,
        )
    context = _authorize(db, principal, business_id, generation=True, lock=True)
    if conversation_id:
        _conversation(db, context, conversation_id, lock=True)
    # Never accept resource IDs, ownership, approval, or publication state from AI output.
    draft = Draft(**{key: generated[key] for key in
        ("video_script", "title", "caption", "platform", "image_prompt")}, status="pending", source="ai", marketing_content_language=content_language)
    destination = generated["platform"].strip().lower()
    # Instagram is a creative target, not an implemented publishing destination.
    draft.publish_destinations = [destination] if destination in {"facebook", "tiktok"} else []
    draft_id = repository.add_draft_scoped(db, context, draft)
    Transactions(db).commit()
    if reservations:
        entitlement_service.finish_usage_batch(
            db, [item.id for item in reservations], succeeded=True,
            result_id=draft_id,
        )
    context = _authorize(db, principal, business_id)
    return repository.get_draft_scoped(db, context, draft_id)


@rollback_on_failure
def delete_sofia_conversation(business_id: str, conversation_id: str, *, db: Session,
                              principal: AuthenticatedPrincipal):
    context = _authorize(db, principal, business_id, write=True, lock=True)
    _conversation(db, context, conversation_id, lock=True)
    repository.delete_conversation_scoped(db, context, conversation_id)
    Transactions(db).commit()
