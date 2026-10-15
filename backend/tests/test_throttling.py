from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from apps.chat.models import Conversation, Message
from tests.test_chat import ask
from tests.test_documents import pdf, upload

pytestmark = pytest.mark.django_db

RATES = {
    "anon": "1000/min",
    "user": "1000/min",
    "auth": "2/min",
    "ask": "2/min",
    "upload": "1/hour",
}


@pytest.fixture(autouse=True)
def _tight_rates(monkeypatch):
    # DRF copies DEFAULT_THROTTLE_RATES onto the class at import time, so a
    # settings override wouldn't reach it; patch the class attribute instead.
    monkeypatch.setattr(SimpleRateThrottle, "THROTTLE_RATES", RATES)


@pytest.fixture
def conversation(workspace, user):
    return Conversation.objects.create(workspace=workspace, user=user)


@pytest.fixture
def bob_client(other_user):
    client = APIClient()
    client.force_authenticate(other_user)
    return client


def login(client):
    return client.post(
        "/api/auth/login/", {"email": "nobody@example.com", "password": "wrong"}, format="json"
    )


# ---------- per-IP auth limit ----------


def test_login_is_limited_per_ip(api_client):
    assert [login(api_client).status_code for _ in range(3)] == [401, 401, 429]


def test_limited_login_says_when_to_retry(api_client):
    login(api_client)
    login(api_client)
    res = login(api_client)
    assert res.status_code == 429
    assert int(res["Retry-After"]) > 0


def test_register_shares_the_auth_limit(api_client):
    login(api_client)
    login(api_client)
    res = api_client.post("/api/auth/register/", {}, format="json")
    assert res.status_code == 429


# ---------- per-user ask limit ----------


def test_ask_is_limited_per_user(
    auth_client, conversation, bob_client, other_workspace, other_user
):
    codes = []
    for _ in range(3):
        res = ask(auth_client, conversation.id, "anything?")
        if res.status_code == 200:
            b"".join(res.streaming_content)  # run the stream so the answer is saved
        codes.append(res.status_code)
    assert codes == [200, 200, 429]

    # Another user has their own counter.
    bobs = Conversation.objects.create(workspace=other_workspace, user=other_user)
    assert ask(bob_client, bobs.id, "anything?").status_code == 200


# ---------- upload limit (POST only) ----------


def test_upload_limit_does_not_count_list_polling(auth_client, workspace):
    for _ in range(5):
        assert auth_client.get(f"/api/workspaces/{workspace.id}/documents/").status_code == 200
    assert upload(auth_client, workspace.id, pdf()).status_code == 201
    assert upload(auth_client, workspace.id, pdf()).status_code == 429
    # Listing still works after uploads are exhausted.
    assert auth_client.get(f"/api/workspaces/{workspace.id}/documents/").status_code == 200


# ---------- daily token budget ----------


def spend(conversation, tokens: int, days_ago: int = 0) -> None:
    msg = Message.objects.create(
        conversation=conversation, role=Message.Role.ASSISTANT, content="x", tokens_used=tokens
    )
    if days_ago:
        Message.objects.filter(pk=msg.pk).update(
            created_at=timezone.now() - timedelta(days=days_ago)
        )


def test_token_budget_blocks_when_used_up(auth_client, conversation, settings):
    settings.DAILY_TOKEN_BUDGET = 1000
    spend(conversation, 1000)
    res = ask(auth_client, conversation.id, "anything?")
    assert res.status_code == 429
    assert "today's limit of 1,000 tokens" in res.data["detail"]
    assert 0 < int(res["Retry-After"]) <= 24 * 3600
    # Nothing was saved for the refused question.
    assert conversation.messages.count() == 1


def test_token_budget_allows_under_limit(auth_client, conversation, settings):
    settings.DAILY_TOKEN_BUDGET = 1000
    spend(conversation, 999)
    assert ask(auth_client, conversation.id, "anything?").status_code == 200


def test_token_budget_ignores_yesterday(auth_client, conversation, settings):
    settings.DAILY_TOKEN_BUDGET = 1000
    spend(conversation, 5000, days_ago=2)
    assert ask(auth_client, conversation.id, "anything?").status_code == 200


def test_token_budget_is_per_user(auth_client, conversation, other_workspace, other_user, settings):
    settings.DAILY_TOKEN_BUDGET = 1000
    spend(Conversation.objects.create(workspace=other_workspace, user=other_user), 5000)
    assert ask(auth_client, conversation.id, "anything?").status_code == 200


def test_token_budget_zero_disables(auth_client, conversation, settings):
    settings.DAILY_TOKEN_BUDGET = 0
    spend(conversation, 10**9)
    assert ask(auth_client, conversation.id, "anything?").status_code == 200


# ---------- staff (site owner) exemption ----------


@pytest.fixture
def staff_client(user):
    user.is_staff = True
    user.save(update_fields=["is_staff"])
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_staff_skip_ask_limit_and_token_budget(staff_client, conversation, settings):
    settings.DAILY_TOKEN_BUDGET = 1000
    spend(conversation, 5000)
    for _ in range(4):  # ask limit is 2/min in these tests
        res = ask(staff_client, conversation.id, "anything?")
        assert res.status_code == 200
        b"".join(res.streaming_content)


def test_staff_skip_upload_limit(staff_client, workspace):
    for _ in range(3):  # upload limit is 1/hour in these tests
        assert upload(staff_client, workspace.id, pdf()).status_code == 201


def test_login_limit_still_applies_to_everyone(api_client, user):
    user.is_staff = True
    user.save(update_fields=["is_staff"])
    assert [login(api_client).status_code for _ in range(3)] == [401, 401, 429]
