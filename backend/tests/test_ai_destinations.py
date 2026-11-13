"""Record current platform/destination behavior, including its known mismatch."""
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.content import openai_provider
from app.models import Business, Conversation, ConversationMessage, Draft


def generated_content(platform):
    return {
        "title": "Publicación de prueba", "caption": "Texto en español",
        "platform": platform, "image_prompt": "Una imagen de prueba",
        "video_script": "Un guion de prueba",
    }


@pytest.mark.parametrize("platform", ["Facebook", "TikTok", "Instagram"])
@pytest.mark.parametrize("workflow", ["automatic", "conversation"])
def test_ai_platform_is_preserved_but_destination_defaults_to_facebook(
    isolated_client, monkeypatch, platform, workflow,
):
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Negocio de prueba")
        other_business = Business(name="Otro negocio")
        db.add_all([business, other_business])
        db.flush()
        conversation = Conversation(business_id=business.id)
        db.add(conversation)
        db.flush()
        db.add_all([
            ConversationMessage(
                conversation_id=conversation.id,
                role="user",
                content="Promociona en TikTok",
            ),
            Draft(
                business_id=other_business.id,
                title="Otro negocio",
                caption="No compartir",
                platform="Facebook",
            ),
        ])
        db.commit()
        business_id, conversation_id = business.id, conversation.id

    # Exercise the real Sofía→Leo orchestration with only the SDK calls mocked.
    responses = Mock(side_effect=[
        SimpleNamespace(output_text="Estrategia de prueba"),
        SimpleNamespace(output_text=json.dumps(generated_content(platform))),
    ])
    monkeypatch.setattr(openai_provider.client.responses, "create", responses)
    url = (
        f"/businesses/{business_id}/generate-content" if workflow == "automatic" else
        f"/businesses/{business_id}/sofia/conversations/{conversation_id}/generate-draft"
    )
    response = client.post(url)
    assert response.status_code == (201 if workflow == "automatic" else 200)
    body = response.json()
    assert body["platform"] == platform
    # Characterization, not desired future behavior: title-case TikTok still defaults to Facebook.
    assert body["publish_destinations"] == ["facebook"]
    assert body["status"] == "pending"
    assert body["source"] == "ai"
    assert body["business_id"] == business_id
    assert body["campaign_id"] is None
    assert responses.call_count == 2
    strategy_call, content_call = responses.call_args_list
    assert strategy_call.kwargs["model"] == content_call.kwargs["model"] == "gpt-4.1-mini"
    assert "Estrategia de prueba" in content_call.kwargs["input"]
    assert "Otro negocio" not in strategy_call.kwargs["input"]
    assert "No compartir" not in strategy_call.kwargs["input"]
    assert ("Promociona en TikTok" in strategy_call.kwargs["input"]) is (workflow == "conversation")
    schema = content_call.kwargs["text"]["format"]["schema"]
    assert schema["properties"]["platform"]["enum"] == ["Instagram", "Facebook", "TikTok"]
    with Session(engine) as db:
        saved = db.get(Draft, body["id"])
        assert saved.platform == platform
        assert saved.publish_destinations == ["facebook"]
        assert saved.title == body["title"] == "Publicación de prueba"
        assert saved.caption == body["caption"] == "Texto en español"
        assert saved.image_prompt == body["image_prompt"] == "Una imagen de prueba"
        assert saved.video_script == body["video_script"] == "Un guion de prueba"
        assert saved.facebook_post_id is None
        assert saved.tiktok_publish_id is None
        assert len(db.scalars(select(Draft).where(Draft.business_id == business_id)).all()) == 1


@pytest.mark.parametrize("workflow,expected", [
    ("automatic", ["tiktok"]), ("conversation", ["facebook"]),
])
def test_lowercase_tiktok_is_handled_differently_by_generation_routes(
    isolated_client, monkeypatch, workflow, expected,
):
    """Synthetic boundary case: lowercase is not in the current AI output enum."""
    client, engine = isolated_client
    with Session(engine) as db:
        business = Business(name="Negocio")
        db.add(business)
        db.flush()
        conversation = Conversation(business_id=business.id)
        db.add(conversation)
        db.flush()
        db.add(ConversationMessage(conversation_id=conversation.id, role="user", content="TikTok"))
        db.commit()
        business_id, conversation_id = business.id, conversation.id
    generate = Mock(return_value=generated_content("tiktok"))
    monkeypatch.setattr(
        "app.features.content.generation_service.generate_marketing_content",
        generate,
    )
    url = (
        f"/businesses/{business_id}/generate-content" if workflow == "automatic" else
        f"/businesses/{business_id}/sofia/conversations/{conversation_id}/generate-draft"
    )
    response = client.post(url)
    assert response.status_code == (201 if workflow == "automatic" else 200)
    assert response.json()["platform"] == "tiktok"
    assert response.json()["publish_destinations"] == expected
    generate.assert_called_once()
    with Session(engine) as db:
        assert db.get(Draft, response.json()["id"]).publish_destinations == expected
