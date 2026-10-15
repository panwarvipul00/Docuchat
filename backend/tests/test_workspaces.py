import pytest

pytestmark = pytest.mark.django_db


def test_list_only_my_workspaces(auth_client, workspace, other_workspace):
    res = auth_client.get("/api/workspaces/")
    assert res.status_code == 200
    ids = [w["id"] for w in res.data]
    assert ids == [workspace.id]
    assert res.data[0]["role"] == "owner"


def test_create_workspace_makes_me_owner(auth_client, user):
    res = auth_client.post("/api/workspaces/", {"name": "Research"}, format="json")
    assert res.status_code == 201
    assert res.data["name"] == "Research"
    assert res.data["owner"] == user.id
    assert res.data["role"] == "owner"


def test_workspaces_require_auth(api_client):
    assert api_client.get("/api/workspaces/").status_code == 401
