from django.urls import path

from .views import WorkspaceListCreateView

urlpatterns = [
    path("workspaces/", WorkspaceListCreateView.as_view(), name="workspace-list"),
]
