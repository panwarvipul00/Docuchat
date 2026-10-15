"""Workspace business logic and the single source of truth for access checks.

Every view that touches workspace data goes through `get_workspace_for_user` or
`workspaces_for_user`, so tenant isolation is enforced in one place.
"""

from django.db import transaction
from django.db.models import QuerySet
from django.http import Http404

from apps.accounts.models import User

from .models import Workspace, WorkspaceMember


def workspaces_for_user(user: User) -> QuerySet[Workspace]:
    return Workspace.objects.filter(memberships__user=user)


def get_workspace_for_user(user: User, workspace_id: int) -> Workspace:
    """Return the workspace if `user` is a member, else raise 404.

    We deliberately return 404 (not 403) for non-members so an attacker can't
    probe which workspace ids exist.
    """
    try:
        return workspaces_for_user(user).get(pk=workspace_id)
    except Workspace.DoesNotExist as exc:
        raise Http404("Workspace not found") from exc


@transaction.atomic
def create_workspace(owner: User, name: str) -> Workspace:
    workspace = Workspace.objects.create(name=name, owner=owner)
    WorkspaceMember.objects.create(workspace=workspace, user=owner, role=WorkspaceMember.Role.OWNER)
    return workspace


def create_default_workspace(user: User) -> Workspace:
    label = user.full_name or user.email.split("@")[0]
    return create_workspace(user, f"{label}'s workspace")
