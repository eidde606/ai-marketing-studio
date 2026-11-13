"""Offline characterization of conversation persistence and rollback."""
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Business, Conversation, ConversationMessage, Draft


def businesses(engine):
    with Session(engine) as db:
        db.add_all([
            Business(id="a", name="Negocio A"),
            Business(id="b", name="Negocio B"),
        ])
        db.commit()


def test_conversation_round_trip_history_and_business_isolation(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    businesses(engine)
    reply = Mock(return_value="Una estrategia")
    monkeypatch.setattr("app.features.content.adapters.chat_with_sofia", reply)
    assert client.get("/businesses/a/sofia/conversation/latest").json() is None
    created = client.post(
        "/businesses/a/sofia/chat",
        json={"message": "  Promociona café  "},
    )
    assert created.status_code == 200
    conversation_id = created.json()["conversation_id"]
    assert created.json() == {
        "conversation_id": conversation_id,
        "reply": "Una estrategia",
    }
    response = client.get(f"/businesses/a/sofia/conversations/{conversation_id}")
    expected = {
        "conversation_id": conversation_id,
        "messages": [
            {"role": "user", "content": "Promociona café"},
            {"role": "assistant", "content": "Una estrategia"},
        ],
    }
    assert response.status_code == 200
    assert response.json() == expected
    assert client.get("/businesses/a/sofia/conversation/latest").json() == expected
    history = client.get("/businesses/a/sofia/conversations").json()
    assert len(history) == 1
    assert history[0]["id"] == conversation_id
    assert history[0]["title"] == "Promociona café"
    other = client.get(f"/businesses/b/sofia/conversations/{conversation_id}")
    assert other.status_code == 404
    assert other.json() == {"detail": "Conversation not found for this business"}
    continuation = client.post(
        "/businesses/a/sofia/chat",
        json={"message": "Más breve", "conversation_id": conversation_id},
    )
    assert continuation.json()["conversation_id"] == conversation_id
    assert reply.call_count == 2
    with Session(engine) as db:
        assert len(db.scalars(select(Conversation)).all()) == 1
        assert len(db.scalars(select(ConversationMessage)).all()) == 4


@pytest.mark.parametrize("existing", [False, True])
def test_chat_failure_rolls_back_only_pending_messages(
    isolated_client,
    monkeypatch,
    existing,
):
    client, engine = isolated_client
    businesses(engine)
    request = {"message": "Un mensaje"}
    if existing:
        with Session(engine) as db:
            db.add(Conversation(id="conversation", business_id="a"))
            db.flush()
            db.add(ConversationMessage(
                conversation_id="conversation",
                role="user",
                content="Anterior",
            ))
            db.commit()
        request["conversation_id"] = "conversation"
    monkeypatch.setattr(
        "app.features.content.adapters.chat_with_sofia",
        Mock(side_effect=RuntimeError("Provider failure")),
    )
    result = client.post("/businesses/a/sofia/chat", json=request)
    assert result.status_code == 502
    assert result.json() == {"detail": "Sofía could not respond. Please try again."}
    with Session(engine) as db:
        assert len(db.scalars(select(Conversation)).all()) == int(existing)
        messages = db.scalars(select(ConversationMessage)).all()
        assert [message.content for message in messages] == (["Anterior"] if existing else [])


def test_conversation_generation_failure_does_not_create_draft(
    isolated_client,
    monkeypatch,
):
    client, engine = isolated_client
    businesses(engine)
    with Session(engine) as db:
        db.add(Conversation(id="conversation", business_id="a"))
        db.flush()
        db.add(ConversationMessage(conversation_id="conversation", role="user", content="Café"))
        db.commit()
    monkeypatch.setattr(
        "app.features.content.generation_service.generate_marketing_content",
        Mock(side_effect=RuntimeError("Provider failure")),
    )
    result = client.post("/businesses/a/sofia/conversations/conversation/generate-draft")
    assert result.status_code == 502
    assert result.json() == {"detail": "Sofía and Leo could not generate the draft"}
    with Session(engine) as db:
        assert db.scalars(select(Draft)).all() == []
        assert len(db.scalars(select(ConversationMessage)).all()) == 1
