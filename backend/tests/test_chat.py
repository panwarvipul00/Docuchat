import json
from unittest import mock

import pytest
from rest_framework.test import APIClient

from apps.chat.models import Conversation, Message
from apps.workspaces.models import WorkspaceMember
from services import rag
from services.llm import FakeLLMProvider, LLMError, TextDelta, Usage
from services.retrieval import RetrievedChunk
from tests.test_retrieval import add_document

pytestmark = pytest.mark.django_db


def parse_sse(response) -> list[tuple[str, dict]]:
    body = b"".join(response.streaming_content).decode()
    events = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.split("\n"))
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def ask(client, conversation_id: int, question: str):
    return client.post(
        f"/api/conversations/{conversation_id}/ask/", {"question": question}, format="json"
    )


@pytest.fixture
def conversation(workspace, user):
    return Conversation.objects.create(workspace=workspace, user=user)


@pytest.fixture
def bob_client(other_user):
    client = APIClient()
    client.force_authenticate(other_user)
    return client


# ---------- conversations endpoints ----------


def test_create_and_list_conversations(auth_client, workspace):
    res = auth_client.post(f"/api/workspaces/{workspace.id}/conversations/", {}, format="json")
    assert res.status_code == 201
    assert res.data["workspace"] == workspace.id
    listed = auth_client.get(f"/api/workspaces/{workspace.id}/conversations/")
    assert [c["id"] for c in listed.data] == [res.data["id"]]


def test_cannot_use_other_workspace_conversations(auth_client, other_workspace):
    url = f"/api/workspaces/{other_workspace.id}/conversations/"
    assert auth_client.get(url).status_code == 404
    assert auth_client.post(url, {}, format="json").status_code == 404


def test_cannot_read_or_ask_in_someone_elses_conversation(bob_client, conversation):
    assert bob_client.get(f"/api/conversations/{conversation.id}/messages/").status_code == 404
    assert ask(bob_client, conversation.id, "hi").status_code == 404
    assert not Message.objects.exists()


def test_conversations_are_private_even_within_a_shared_workspace(
    bob_client, workspace, other_user, conversation
):
    WorkspaceMember.objects.create(workspace=workspace, user=other_user)
    listed = bob_client.get(f"/api/workspaces/{workspace.id}/conversations/")
    assert listed.status_code == 200 and listed.data == []
    assert bob_client.get(f"/api/conversations/{conversation.id}/messages/").status_code == 404


def test_removed_member_loses_access(bob_client, workspace, other_user):
    membership = WorkspaceMember.objects.create(workspace=workspace, user=other_user)
    conv = Conversation.objects.create(workspace=workspace, user=other_user)
    membership.delete()
    assert bob_client.get(f"/api/conversations/{conv.id}/messages/").status_code == 404


def test_chat_endpoints_require_auth(api_client, workspace, conversation):
    assert api_client.get(f"/api/workspaces/{workspace.id}/conversations/").status_code == 401
    assert api_client.get(f"/api/conversations/{conversation.id}/messages/").status_code == 401
    assert ask(api_client, conversation.id, "hi").status_code == 401


def test_ask_validates_question(auth_client, conversation):
    assert ask(auth_client, conversation.id, "   ").status_code == 400
    assert ask(auth_client, conversation.id, "x" * 2001).status_code == 400


# ---------- /ask/ streaming ----------


def test_ask_streams_cited_answer_and_saves_messages(auth_client, workspace, user, conversation):
    doc = add_document(
        workspace,
        user,
        ["Mitochondria produce ATP for the cell. They have two membranes."],
        title="Biology Notes",
    )
    res = ask(auth_client, conversation.id, "What do mitochondria produce?")
    assert res.status_code == 200
    assert res["Content-Type"] == "text/event-stream"

    events = parse_sse(res)
    names = [e[0] for e in events]
    assert names[0] == "sources" and names[-1] == "done"
    assert set(names[1:-1]) == {"token"}

    sources = events[0][1]["sources"]
    assert sources[0] == {
        "index": 1,
        "document_id": doc.id,
        "chunk_id": doc.chunks.first().id,
        "title": "Biology Notes",
        "page": 1,
    }

    streamed = "".join(e[1]["text"] for e in events if e[0] == "token").strip()
    final = events[-1][1]["message"]
    assert final["content"] == streamed
    assert "Mitochondria produce ATP for the cell" in streamed
    assert final["citations"] == [sources[0]]
    assert final["tokens_used"] > 0

    msgs = list(conversation.messages.all())
    assert [m.role for m in msgs] == ["user", "assistant"]
    assert msgs[0].content == "What do mitochondria produce?"
    conversation.refresh_from_db()
    assert conversation.title == "What do mitochondria produce?"

    history = auth_client.get(f"/api/conversations/{conversation.id}/messages/")
    assert [m["role"] for m in history.data] == ["user", "assistant"]


def test_ask_without_documents_skips_llm(auth_client, conversation):
    with mock.patch("services.rag.get_llm_provider") as provider:
        events = parse_sse(ask(auth_client, conversation.id, "anything?"))
    provider.assert_not_called()
    assert events[0] == ("sources", {"sources": []})
    assert events[-1][1]["message"]["content"] == rag.NOT_FOUND_ANSWER
    assert events[-1][1]["message"]["citations"] == []


def test_ask_reports_llm_errors(auth_client, workspace, user, conversation):
    add_document(workspace, user, ["Some content here."])
    with mock.patch.object(FakeLLMProvider, "stream_chat", side_effect=LLMError("rate limited")):
        events = parse_sse(ask(auth_client, conversation.id, "question?"))
    assert events[-1] == ("error", {"detail": "rate limited"})
    # The question is kept; no empty assistant message is stored.
    assert [m.role for m in conversation.messages.all()] == ["user"]


def test_ask_hides_unexpected_errors(auth_client, workspace, user, conversation):
    add_document(workspace, user, ["Some content here."])
    with mock.patch("services.rag.vector_search", side_effect=RuntimeError("db password=x")):
        events = parse_sse(ask(auth_client, conversation.id, "question?"))
    assert events[-1][0] == "error"
    assert "password" not in events[-1][1]["detail"]


def test_followup_questions_include_history(workspace, user, conversation):
    add_document(workspace, user, ["Paris is the capital of France."])
    list(rag.answer_question(conversation, "What is the capital of France?"))

    captured = []

    def spy(self, messages):
        captured.extend(messages)
        yield TextDelta("It is Paris [1].")
        yield Usage(10, 5)

    with mock.patch.object(FakeLLMProvider, "stream_chat", spy):
        list(rag.answer_question(conversation, "Are you sure?"))

    roles = [m.role for m in captured]
    assert roles == ["system", "user", "assistant", "user"]
    assert captured[1].content == "What is the capital of France?"
    assert "Question: Are you sure?" in captured[-1].content
    assert conversation.messages.last().tokens_used == 15


def test_history_is_capped(settings, workspace, user, conversation):
    settings.RAG_HISTORY_MESSAGES = 2
    add_document(workspace, user, ["Some fact."])
    for i in range(3):
        list(rag.answer_question(conversation, f"q{i}"))
    captured = []

    def spy(self, messages):
        captured.extend(messages)
        yield TextDelta("ok")

    with mock.patch.object(FakeLLMProvider, "stream_chat", spy):
        list(rag.answer_question(conversation, "last"))
    assert len(captured) == 1 + 2 + 1  # system + 2 history + current


def test_client_disconnect_saves_partial_answer(workspace, user, conversation):
    add_document(workspace, user, ["One. Two. Three."])

    def slow(self, messages):
        yield TextDelta("Partial ")
        yield TextDelta("answer [1]")
        yield TextDelta(" never sent")

    with mock.patch.object(FakeLLMProvider, "stream_chat", slow):
        stream = rag.answer_question(conversation, "q?")
        next(stream)  # sources
        next(stream)  # "Partial "
        next(stream)  # "answer [1]"
        stream.close()  # client went away

    answer = conversation.messages.get(role="assistant")
    assert answer.content == "Partial answer [1]"
    assert answer.citations[0]["index"] == 1


# ---------- prompt helpers ----------


def _chunk(i: int) -> RetrievedChunk:
    return RetrievedChunk(i, 100 + i, f"Doc {i}", i * 2, f"content {i}", 0.1)


def test_extract_citations_formats_and_bounds():
    sources = [_chunk(1), _chunk(2), _chunk(3)]
    cites = rag.extract_citations("A [2]. B [1][2]. C [1, 3]. D [9]. E [0].", sources)
    assert [c["index"] for c in cites] == [2, 1, 3]
    assert cites[0] == {"index": 2, "document_id": 102, "chunk_id": 2, "title": "Doc 2", "page": 4}


def test_build_messages_numbers_sources():
    msgs = rag.build_messages("Why?", [_chunk(1), _chunk(2)], [])
    assert msgs[0].role == "system" and rag.NOT_FOUND_ANSWER in msgs[0].content
    assert msgs[-1].content == (
        "Sources:\n\n[1] Doc 1 — page 2\ncontent 1\n\n[2] Doc 2 — page 4\ncontent 2\n\n"
        "Question: Why?"
    )
