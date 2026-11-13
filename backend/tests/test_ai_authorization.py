"""AI authorization uses real policies; providers alone are replaced."""
from unittest.mock import Mock

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import BusinessMembership, Conversation, ConversationMessage, Draft
from tests.tenancy_fixtures import grant_test_owner
from tests.test_tenant_repositories import seed_tenants
from tests.test_ai_destinations import generated_content


@pytest.fixture
def ai_case(isolated_client, monkeypatch):
    client, engine = isolated_client
    seed_tenants(engine)
    with Session(engine) as db:
        grant_test_owner(db, ["a"])
        db.commit()
    chat = Mock(return_value="Safe reply")
    generate = Mock(return_value=generated_content("facebook"))
    monkeypatch.setattr("app.features.content.adapters.chat_with_sofia", chat)
    monkeypatch.setattr("app.features.content.generation_service.generate_marketing_content", generate)
    return client, engine, chat, generate


def change_membership(engine, **values):
    with Session(engine) as db:
        # Leave seed owners untouched; change only the HTTP test identity.
        db.execute(update(BusinessMembership).where(BusinessMembership.business_id == "a",
            BusinessMembership.id != "a").values(**values))
        db.commit()


@pytest.mark.parametrize("role", ["owner", "admin", "member"])
def test_roles_can_use_ai_without_output_privilege_escalation(ai_case, role):
    client, engine, chat, generate = ai_case
    change_membership(engine, role=role)
    generate.return_value.update(id="b-pending", business_id="b", campaign_id="b-campaign", status="approved")
    reply = client.post("/businesses/a/sofia/chat", json={"message": "b-message-0 b-campaign b-pending"})
    assert reply.status_code == 200
    result = client.post("/businesses/a/generate-content")
    assert result.status_code == 201
    assert result.json()["business_id"] == "a"
    assert result.json()["status"] == "pending"
    assert result.json()["campaign_id"] is None
    assert result.json()["id"] != "b-pending"
    assert chat.call_args.args[0].name == "a"
    assert [m.content for m in chat.call_args.args[1]] == ["b-message-0 b-campaign b-pending"]
    if role == "member":
        assert client.patch(f'/drafts/{result.json()["id"]}/approve').status_code == 403
    with Session(engine) as db:
        assert db.get(Draft, "b-pending").title == "Content"


@pytest.mark.parametrize("status", ["suspended", "revoked"])
def test_inactive_membership_blocks_all_ai_workflows(ai_case, status):
    client, engine, chat, generate = ai_case
    change_membership(engine, status=status)
    for method, path, body in [
        ("get", "sofia/conversations", None), ("get", "sofia/conversation/latest", None),
        ("get", "sofia/conversations/a-conversation", None),
        ("post", "sofia/chat", {"message": "test"}), ("post", "generate-content", None),
        ("post", "sofia/conversations/a-conversation/generate-draft", None),
        ("delete", "sofia/conversations/a-conversation", None),
    ]:
        assert client.request(method, f"/businesses/a/{path}", json=body).status_code == 404
    chat.assert_not_called()
    generate.assert_not_called()


def test_foreign_conversations_messages_and_missing_membership(ai_case):
    client, engine, chat, generate = ai_case
    assert client.get("/businesses/b/sofia/conversations").status_code == 404
    for resource in ("b-conversation", "b-message-0", "unknown"):
        path = f"/businesses/a/sofia/conversations/{resource}"
        assert client.get(path).status_code == 404
        assert client.delete(path).status_code == 404
        assert client.post(path + "/generate-draft").status_code == 404
        assert client.post("/businesses/a/sofia/chat", json={"message": "test", "conversation_id": resource}).status_code == 404
    chat.assert_not_called()
    generate.assert_not_called()
    with Session(engine) as db:
        grant_test_owner(db, ["b"])
        db.commit()
    # A multi-business member still cannot mix tenant selectors and resource IDs.
    assert client.get("/businesses/a/sofia/conversations/b-conversation").status_code == 404
    assert client.get("/businesses/b/sofia/conversations/b-conversation").json()["messages"] == [
        {"role": "user", "content": "b"}] * 3
    response = client.post("/businesses/a/sofia/chat", json={"message": "new", "conversation_id": "a-conversation"})
    assert response.status_code == 200
    assert [m.content for m in chat.call_args.args[1]] == ["a", "a", "a", "new"]


@pytest.mark.parametrize("field", ["campaign_id", "draft_id", "message_id", "business_id", "status"])
def test_unrecognized_structured_resource_references_rejected(ai_case, field):
    client, _, chat, generate = ai_case
    for path, body in [("sofia/chat", {"message": "test"}), ("generate-content", {}),
                       ("sofia/conversations/a-conversation/generate-draft", {})]:
        assert client.post(f"/businesses/a/{path}", json={**body, field: "foreign"}).status_code == 422
    chat.assert_not_called()
    generate.assert_not_called()


@pytest.mark.parametrize("workflow", ["new_chat", "existing_chat", "automatic", "conversation"])
def test_revocation_during_provider_prevents_all_output_persistence(ai_case, workflow):
    client, engine, chat, generate = ai_case
    def revoke(*args, **kwargs):
        change_membership(engine, status="revoked")
        return "reply" if "chat" in workflow else generated_content("facebook")
    chat.side_effect = generate.side_effect = revoke
    if "chat" in workflow:
        body = {"message": "Must not persist"}
        if workflow == "existing_chat":
            body["conversation_id"] = "a-conversation"
        response = client.post("/businesses/a/sofia/chat", json=body)
    else:
        path = "generate-content" if workflow == "automatic" else "sofia/conversations/a-conversation/generate-draft"
        response = client.post(f"/businesses/a/{path}")
    assert response.status_code == 404
    with Session(engine) as db:
        assert len(db.scalars(select(Conversation)).all()) == 2
        assert len(db.scalars(select(ConversationMessage)).all()) == 6
        assert len(db.scalars(select(Draft)).all()) == 4


def test_deletion_and_provider_error_do_not_leak(ai_case, caplog):
    client, engine, chat, _ = ai_case
    chat.side_effect = RuntimeError("SECRET PROMPT AND CREDENTIAL")
    assert client.post("/businesses/a/sofia/chat", json={"message": "test"}).status_code == 502
    assert "SECRET" not in caplog.text
    assert client.delete("/businesses/a/sofia/conversations/a-conversation").status_code == 204
    with Session(engine) as db:
        assert db.get(Conversation, "a-conversation") is None
        assert len(db.scalars(select(ConversationMessage)).all()) == 3


def test_full_history_pagination_and_request_local_attribution(ai_case, monkeypatch):
    client, engine, chat, _ = ai_case
    seen = []
    monkeypatch.setattr("app.features.content.execution.before_generation", seen.append)
    with Session(engine) as db:
        grant_test_owner(db, ["b"])
        for index in range(105):
            db.add(ConversationMessage(conversation_id="a-conversation", role="user", content=f"a-{index}"))
        db.commit()
    messages = client.get("/businesses/a/sofia/conversations/a-conversation").json()["messages"]
    assert len(messages) == 108
    for business in ("a", "b"):
        assert client.post(f"/businesses/{business}/sofia/chat", json={"message": "new",
            "conversation_id": f"{business}-conversation"}).status_code == 200
        profile, history = chat.call_args.args
        assert profile.name == business
        assert len(history) == (109 if business == "a" else 4)
        assert not hasattr(profile, "_sa_instance_state")
        assert not hasattr(history[0], "_sa_instance_state")
    assert [item.business_id for item in seen] == ["a", "b"]
    assert seen[0].request_id != seen[1].request_id
    assert seen[0].languages.interface is None
    assert seen[0].languages.conversation is None
    assert seen[0].languages.marketing_content is None


@pytest.mark.parametrize("workflow", ["chat", "draft"])
def test_deleted_conversation_not_resurrected_after_generation(ai_case, workflow):
    client, engine, chat, generate = ai_case
    def delete(*args, **kwargs):
        assert client.delete("/businesses/a/sofia/conversations/a-conversation").status_code == 204
        return "reply" if workflow == "chat" else generated_content("facebook")
    chat.side_effect = generate.side_effect = delete
    if workflow == "chat":
        response = client.post("/businesses/a/sofia/chat", json={"message": "new", "conversation_id": "a-conversation"})
    else:
        response = client.post("/businesses/a/sofia/conversations/a-conversation/generate-draft")
    assert response.status_code == 404
    with Session(engine) as db:
        assert db.get(Conversation, "a-conversation") is None
        assert len(db.scalars(select(Draft)).all()) == 4


def test_provider_modules_remain_independent_of_http_and_persistence():
    import ast
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "app/features/content"
    for name in ("adapters", "sofia_provider", "openai_provider", "generation_service", "context", "execution"):
        for node in ast.walk(ast.parse((root / f"{name}.py").read_text())):
            if isinstance(node, ast.ImportFrom):
                modules = [node.module or ""]
            elif isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            else:
                continue
            assert not any(module.startswith(("sqlalchemy", "fastapi", "app.auth", "app.database", "app.models"))
                           or "repository" in module for module in modules), (name, modules)
