import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.businesses.schemas import BusinessCreate
from app.features.businesses import service as business_service
from app.features.entitlements import repository as entitlement_repository
from app.features.content.context import BusinessProfile, Message
from app.features.content import generation_service
from app.features.content.input_limits import (
    MAX_DYNAMIC_INPUT_BYTES,
    MAX_HISTORY_MESSAGES,
    MAX_INPUT_TOKENS,
    MAX_OUTPUT_TOKENS,
    assert_provider_input_fits,
    dynamic_input_size_bytes,
    token_upper_bound,
)
from app.models import Business, Conversation, ConversationMessage, Draft
from tests.tenancy_fixtures import grant_test_owner


def _create_trial_business(
    isolated_client, monkeypatch, *, subject="bounded-ai-customer",
):
    _, engine = isolated_client
    monkeypatch.setenv("TRIALS_ENABLED", "true")
    with Session(engine) as db:
        principal = grant_test_owner(db, subject=subject)
        db.commit()
    from app.auth import get_authenticated_principal
    from app.main import app

    app.dependency_overrides[get_authenticated_principal] = lambda: principal
    with Session(engine) as db:
        business = business_service.create_business(
            BusinessCreate(name="Bounded AI business"),
            db,
            principal=principal,
        )
    return engine, principal, business.id


def _profile(**overrides):
    values = {
        "name": "Business",
        "industry": "Retail",
        "description": None,
        "products_services": None,
        "target_audience": None,
        "brand_voice": None,
        "marketing_goals": None,
        "preferred_platforms": None,
        "website_url": None,
    }
    values.update(overrides)
    return BusinessProfile(
        service_area=None,
        posting_frequency=None,
        **values,
    )


def test_chat_uses_only_the_most_recent_history_and_keeps_saved_history(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    _, principal, business_id = _create_trial_business(
        isolated_client, monkeypatch,
    )
    conversation_id = "long-conversation"
    with Session(engine) as db:
        db.add(Conversation(id=conversation_id, business_id=business_id))
        db.flush()
        created = datetime.now(timezone.utc) - timedelta(minutes=25)
        db.add_all([
            ConversationMessage(
                conversation_id=conversation_id,
                role="user" if index % 2 == 0 else "assistant",
                content=f"history-{index}",
                created_at=created + timedelta(minutes=index),
            )
            for index in range(25)
        ])
        db.commit()

    provider = Mock(return_value="A useful reply")
    monkeypatch.setattr(
        "app.features.content.adapters.chat_with_sofia", provider,
    )
    response = client.post(
        f"/businesses/{business_id}/sofia/chat",
        json={
            "message": "Next question",
            "conversation_id": conversation_id,
            "idempotency_key": "history-window-request",
        },
    )

    assert response.status_code == 200, response.json()
    sent_messages = provider.call_args.args[1]
    assert len(sent_messages) == MAX_HISTORY_MESSAGES
    assert sent_messages[0].content == "history-6"
    assert sent_messages[-1] == Message("user", "Next question")
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(ConversationMessage)) == 27


def test_oversized_chat_context_is_rejected_before_quota_reservation(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    _, _, business_id = _create_trial_business(isolated_client, monkeypatch)
    with Session(engine) as db:
        business = db.get(Business, business_id)
        business.description = "oversized context " * 12000
        db.commit()
    provider = Mock()
    monkeypatch.setattr(
        "app.features.content.adapters.chat_with_sofia", provider,
    )

    response = client.post(
        f"/businesses/{business_id}/sofia/chat",
        json={"message": "Help me plan"},
    )

    assert response.status_code == 400
    assert response.headers["X-Error-Code"] == ErrorKind.INVALID_INPUT.value
    assert "too much context" in response.json()["detail"]
    provider.assert_not_called()
    with Session(engine) as db:
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        assert organization is not None
        assert entitlement_repository.count_usage(
            db, organization.id, "sofia_request",
        ) == 0


def test_oversized_optional_content_profile_is_budgeted_for_generation(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    _, _, business_id = _create_trial_business(isolated_client, monkeypatch)
    with Session(engine) as db:
        business = db.get(Business, business_id)
        business.description = "oversized strategy context " * 12000
        db.commit()
    plan = Mock(return_value="A concise strategy")
    write = Mock(return_value={
        "title": "A test draft",
        "caption": "A test caption",
        "platform": "Facebook",
        "image_prompt": "A blue background",
        "video_script": "A short script",
    })
    monkeypatch.setattr("app.features.content.adapters.plan_content", plan)
    monkeypatch.setattr("app.features.content.adapters.write_content", write)

    response = client.post(
        f"/businesses/{business_id}/generate-content",
        json={"idempotency_key": "oversized-content-request"},
    )

    assert response.status_code == 201, response.json()
    plan.assert_called_once()
    write.assert_called_once()
    assert "description" not in plan.call_args.args[0]
    with Session(engine) as db:
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        assert organization is not None
        assert entitlement_repository.count_usage(
            db, organization.id, "leo_generation",
        ) == 1


def test_context_budget_keeps_instructions_and_newest_whole_drafts():
    posts = [
        {
            "title": f"Draft {index}",
            "caption": f"Historical content {index}: " + "x" * 900,
            "platform": "Facebook",
        }
        for index in range(6)
    ]
    instructions = "Promote the spring menu."

    profile, history_context, campaign_context = generation_service._request_inputs(
        _profile(description="Optional detail " * 400),
        posts,
        instructions,
    )
    selected_posts = json.loads(history_context)

    assert profile["name"] == "Business"
    assert "description" not in profile
    assert selected_posts
    assert selected_posts == posts[:len(selected_posts)]
    assert len(selected_posts) < len(posts)
    assert campaign_context == instructions
    assert dynamic_input_size_bytes(
        profile, history_context, campaign_context,
    ) <= MAX_DYNAMIC_INPUT_BYTES


def test_context_budget_uses_utf8_bytes_and_preserves_unicode_instructions():
    instructions = "Promote café ☕"
    profile, history_context, campaign_context = generation_service._request_inputs(
        _profile(name="Café 🌱", description="é" * 2100),
        [],
        instructions,
    )

    assert token_upper_bound("é" * 2) == 4
    assert profile["name"] == "Café 🌱"
    assert "description" not in profile
    assert campaign_context == instructions
    assert dynamic_input_size_bytes(
        profile, history_context, campaign_context,
    ) <= MAX_DYNAMIC_INPUT_BYTES


def test_short_conversation_generates_with_oversized_optional_profile_data(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    _, _, business_id = _create_trial_business(isolated_client, monkeypatch)
    conversation_id = "short-context-conversation"
    instructions = "Create one short post."
    with Session(engine) as db:
        business = db.get(Business, business_id)
        business.description = "Optional profile detail " * 400
        db.add(Conversation(id=conversation_id, business_id=business_id))
        db.add(ConversationMessage(
            conversation_id=conversation_id,
            role="user",
            content=instructions,
        ))
        db.commit()

    plan = Mock(return_value="A concise strategy")
    write = Mock(return_value={
        "title": "A test draft",
        "caption": "A test caption",
        "platform": "Facebook",
        "image_prompt": "A blue background",
        "video_script": "A short script",
    })
    monkeypatch.setattr("app.features.content.adapters.plan_content", plan)
    monkeypatch.setattr("app.features.content.adapters.write_content", write)

    response = client.post(
        f"/businesses/{business_id}/sofia/conversations/{conversation_id}/generate-draft",
        json={"idempotency_key": "short-context-budgeted-generation"},
    )

    assert response.status_code == 200, response.json()
    plan.assert_called_once()
    write.assert_called_once()
    assert "name" in plan.call_args.args[0]
    assert "description" not in plan.call_args.args[0]
    assert plan.call_args.args[2] == instructions
    with Session(engine) as db:
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        assert entitlement_repository.count_usage(
            db, organization.id, "leo_generation",
        ) == 1
        assert db.scalar(select(func.count()).select_from(Draft)) == 1


def test_oversized_essential_conversation_instructions_fail_before_quota_reservation(
    isolated_client, monkeypatch,
):
    client, engine = isolated_client
    _, _, business_id = _create_trial_business(isolated_client, monkeypatch)
    conversation_id = "oversized-essential-context"
    created = datetime.now(timezone.utc)
    with Session(engine) as db:
        db.add(Conversation(id=conversation_id, business_id=business_id))
        db.add_all([
            ConversationMessage(
                conversation_id=conversation_id,
                role="user",
                content="Campaign instruction " * 120,
                created_at=created + timedelta(seconds=index),
            )
            for index in range(2)
        ])
        db.commit()

    plan = Mock()
    write = Mock()
    monkeypatch.setattr("app.features.content.adapters.plan_content", plan)
    monkeypatch.setattr("app.features.content.adapters.write_content", write)

    response = client.post(
        f"/businesses/{business_id}/sofia/conversations/{conversation_id}/generate-draft",
        json={"idempotency_key": "oversized-essential-context"},
    )

    assert response.status_code == 400
    assert response.headers["X-Error-Code"] == ErrorKind.INVALID_INPUT.value
    assert "too much context" in response.json()["detail"]
    plan.assert_not_called()
    write.assert_not_called()
    with Session(engine) as db:
        organization = entitlement_repository.organization_for_business(
            db, business_id,
        )
        assert entitlement_repository.count_usage(
            db, organization.id, "leo_generation",
        ) == 0


def test_provider_calls_apply_input_and_output_caps(monkeypatch):
    from app.features.content import openai_provider, sofia_provider

    responses = Mock()
    responses.create.side_effect = [
        SimpleNamespace(output_text="Strategy", status="completed"),
        SimpleNamespace(
            output_text=(
                '{"title":"Title","caption":"Caption","platform":"Facebook",'
                '"image_prompt":"A blue background","video_script":"A short script"}'
            ),
            status="completed",
        ),
    ]
    monkeypatch.setattr(
        openai_provider, "client", SimpleNamespace(responses=responses),
    )
    openai_provider.plan_content({"name": "Business"}, "[]", None)
    openai_provider.write_content({"name": "Business"}, "Strategy")
    for call in responses.create.call_args_list:
        assert call.kwargs["max_output_tokens"] == MAX_OUTPUT_TOKENS

    chat_response = Mock(
        output_text="Reply",
        status="completed",
    )
    chat_create = Mock(return_value=chat_response)
    monkeypatch.setattr(
        sofia_provider,
        "client",
        SimpleNamespace(responses=SimpleNamespace(create=chat_create)),
    )
    sofia_provider.chat_with_sofia(
        _profile(),
        [Message("user", "Help me plan")],
    )
    assert chat_create.call_args.kwargs["max_output_tokens"] == MAX_OUTPUT_TOKENS


def test_history_window_constant_and_provider_input_limit_are_explicit():
    from app.features.content.input_limits import (
        MAX_DYNAMIC_INPUT_BYTES,
        MAX_INPUT_TOKENS,
        assert_dynamic_input_fits,
    )

    assert MAX_HISTORY_MESSAGES == 20
    assert MAX_DYNAMIC_INPUT_BYTES < MAX_INPUT_TOKENS
    with pytest.raises(ApplicationError) as rejected:
        assert_dynamic_input_fits("oversized " * MAX_DYNAMIC_INPUT_BYTES)
    assert rejected.value.kind is ErrorKind.INVALID_INPUT
    with pytest.raises(ApplicationError) as provider_rejected:
        assert_provider_input_fits("x" * MAX_INPUT_TOKENS, {})
    assert provider_rejected.value.kind is ErrorKind.INVALID_INPUT
