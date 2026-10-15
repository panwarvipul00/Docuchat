import pytest

from apps.accounts.models import User
from apps.workspaces.models import WorkspaceMember

pytestmark = pytest.mark.django_db


def test_register_creates_user_and_default_workspace(api_client):
    res = api_client.post(
        "/api/auth/register/",
        {"email": "New@Example.com", "password": "s3cure-pass-123", "full_name": "New"},
        format="json",
    )
    assert res.status_code == 201, res.data
    user = User.objects.get(email="new@example.com")
    membership = WorkspaceMember.objects.get(user=user)
    assert membership.role == WorkspaceMember.Role.OWNER
    assert membership.workspace.owner == user
    assert "password" not in res.data


def test_register_rejects_duplicate_email(api_client, user):
    res = api_client.post(
        "/api/auth/register/",
        {"email": "ALICE@example.com", "password": "s3cure-pass-123"},
        format="json",
    )
    assert res.status_code == 400
    assert "email" in res.data


def test_register_rejects_weak_password(api_client):
    res = api_client.post(
        "/api/auth/register/", {"email": "x@example.com", "password": "12345678"}, format="json"
    )
    assert res.status_code == 400


def test_login_refresh_and_me(api_client, user):
    res = api_client.post(
        "/api/auth/login/",
        {"email": "alice@example.com", "password": "s3cure-pass-123"},
        format="json",
    )
    assert res.status_code == 200
    access, refresh = res.data["access"], res.data["refresh"]

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    me = api_client.get("/api/auth/me/")
    assert me.status_code == 200
    assert me.data["email"] == "alice@example.com"

    res = api_client.post("/api/auth/refresh/", {"refresh": refresh}, format="json")
    assert res.status_code == 200
    assert "access" in res.data


def test_login_wrong_password(api_client, user):
    res = api_client.post(
        "/api/auth/login/", {"email": "alice@example.com", "password": "nope"}, format="json"
    )
    assert res.status_code == 401


def test_me_requires_auth(api_client):
    assert api_client.get("/api/auth/me/").status_code == 401
