from django.db.models import QuerySet
from rest_framework import generics

from .models import Workspace
from .serializers import WorkspaceSerializer
from .services import create_workspace, workspaces_for_user


class WorkspaceListCreateView(generics.ListCreateAPIView):
    serializer_class = WorkspaceSerializer

    def get_queryset(self) -> QuerySet[Workspace]:
        return workspaces_for_user(self.request.user).prefetch_related("memberships")

    def perform_create(self, serializer: WorkspaceSerializer) -> None:
        serializer.instance = create_workspace(self.request.user, serializer.validated_data["name"])
