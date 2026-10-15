from django.urls import path

from .views import ChunkDetailView, DocumentDetailView, WorkspaceDocumentListCreateView

urlpatterns = [
    path(
        "workspaces/<int:workspace_id>/documents/",
        WorkspaceDocumentListCreateView.as_view(),
        name="workspace-documents",
    ),
    path("documents/<int:pk>/", DocumentDetailView.as_view(), name="document-detail"),
    path("chunks/<int:pk>/", ChunkDetailView.as_view(), name="chunk-detail"),
]
