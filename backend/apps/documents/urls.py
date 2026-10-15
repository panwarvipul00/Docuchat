from django.urls import path

from .views import DocumentDetailView, WorkspaceDocumentListCreateView

urlpatterns = [
    path(
        "workspaces/<int:workspace_id>/documents/",
        WorkspaceDocumentListCreateView.as_view(),
        name="workspace-documents",
    ),
    path("documents/<int:pk>/", DocumentDetailView.as_view(), name="document-detail"),
]
