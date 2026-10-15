from django.urls import path

from .views import AskView, ConversationMessageListView, WorkspaceConversationListCreateView

urlpatterns = [
    path(
        "workspaces/<int:workspace_id>/conversations/",
        WorkspaceConversationListCreateView.as_view(),
        name="workspace-conversations",
    ),
    path(
        "conversations/<int:pk>/messages/",
        ConversationMessageListView.as_view(),
        name="conversation-messages",
    ),
    path("conversations/<int:pk>/ask/", AskView.as_view(), name="conversation-ask"),
]
