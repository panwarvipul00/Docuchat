import json
from collections.abc import Iterator

from django.db.models import QuerySet
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.workspaces.services import get_workspace_for_user, workspaces_for_user
from services.rag import DoneEvent, ErrorEvent, RagEvent, SourcesEvent, answer_question

from .models import Conversation, Message
from .serializers import AskSerializer, ConversationSerializer, MessageSerializer


def user_conversations(request: Request) -> QuerySet[Conversation]:
    """Conversations are private to their author, within workspaces they belong to.

    Re-checking membership (not just `user=`) means that if someone is removed
    from a workspace, they lose access to their old conversations there too.
    """
    return Conversation.objects.filter(
        user=request.user, workspace__in=workspaces_for_user(request.user)
    )


class WorkspaceConversationListCreateView(generics.ListCreateAPIView):
    serializer_class = ConversationSerializer

    def get_queryset(self) -> QuerySet[Conversation]:
        workspace = get_workspace_for_user(self.request.user, self.kwargs["workspace_id"])
        return (
            user_conversations(self.request)
            .filter(workspace=workspace)
            .prefetch_related("documents")
        )

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        if self.request.method == "POST":
            context["workspace"] = get_workspace_for_user(
                self.request.user, self.kwargs["workspace_id"]
            )
        return context

    def perform_create(self, serializer: ConversationSerializer) -> None:
        serializer.save(workspace=serializer.context["workspace"], user=self.request.user)


class ConversationDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET / PATCH (rename) / DELETE one of the user's conversations."""

    serializer_class = ConversationSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self) -> QuerySet[Conversation]:
        return user_conversations(self.request).select_related("workspace")


class ConversationMessageListView(generics.ListAPIView):
    serializer_class = MessageSerializer

    def get_queryset(self) -> QuerySet[Message]:
        conversation = get_object_or_404(user_conversations(self.request), pk=self.kwargs["pk"])
        return conversation.messages.all()


def _sse(event: str, data: object) -> str:
    # SSE wire format: "event: <name>\ndata: <payload>\n\n". JSON-encoding the
    # payload keeps newlines in the answer text from breaking the framing.
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _to_sse(events: Iterator[RagEvent]) -> Iterator[str]:
    for event in events:
        if isinstance(event, SourcesEvent):
            yield _sse("sources", {"sources": event.sources})
        elif isinstance(event, DoneEvent):
            yield _sse("done", {"message": MessageSerializer(event.message).data})
        elif isinstance(event, ErrorEvent):
            yield _sse("error", {"detail": event.detail})
        else:
            yield _sse("token", {"text": event.text})


class AskView(APIView):
    """POST {question} -> text/event-stream of: sources, token*, then done | error."""

    def post(self, request: Request, pk: int) -> StreamingHttpResponse:
        conversation = get_object_or_404(
            user_conversations(request).select_related("workspace"), pk=pk
        )
        serializer = AskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        response = StreamingHttpResponse(
            _to_sse(answer_question(conversation, serializer.validated_data["question"])),
            content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        # Tell nginx-style proxies not to buffer, or tokens arrive in one lump.
        response["X-Accel-Buffering"] = "no"
        return response
