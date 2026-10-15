from django.db import transaction
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle

from apps.workspaces.models import WorkspaceMember
from apps.workspaces.services import get_workspace_for_user, workspaces_for_user

from .models import Chunk, Document
from .serializers import ChunkSerializer, DocumentSerializer, DocumentUploadSerializer
from .tasks import process_document
from .throttles import UploadRateThrottle


class WorkspaceDocumentListCreateView(generics.GenericAPIView):
    """GET lists a workspace's documents; POST uploads a new one (multipart)."""

    parser_classes = [MultiPartParser, FormParser]
    serializer_class = DocumentSerializer

    def get_throttles(self) -> list[BaseThrottle]:
        throttles = super().get_throttles()
        if self.request.method == "POST":
            throttles.append(UploadRateThrottle())
        return throttles

    def get(self, request: Request, workspace_id: int) -> Response:
        workspace = get_workspace_for_user(request.user, workspace_id)
        docs = workspace.documents.select_related("uploaded_by")
        return Response(DocumentSerializer(docs, many=True).data)

    def post(self, request: Request, workspace_id: int) -> Response:
        workspace = get_workspace_for_user(request.user, workspace_id)
        upload = DocumentUploadSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        data = upload.validated_data
        file = data["file"]
        document = Document.objects.create(
            workspace=workspace,
            uploaded_by=request.user,
            title=data["title"],
            file=file,
            file_type=data["file_type"],
            file_size=file.size,
        )
        # Enqueue only after the row is committed, otherwise a fast worker could
        # look the document up before it exists.
        transaction.on_commit(lambda: process_document.delay(document.id))
        return Response(DocumentSerializer(document).data, status=status.HTTP_201_CREATED)


class DocumentDetailView(generics.RetrieveDestroyAPIView):
    serializer_class = DocumentSerializer

    def get_queryset(self) -> QuerySet[Document]:
        # Scope to the user's workspaces so other tenants' ids return 404.
        return Document.objects.filter(
            workspace__in=workspaces_for_user(self.request.user)
        ).select_related("uploaded_by")

    def get_object(self) -> Document:
        return get_object_or_404(self.get_queryset(), pk=self.kwargs["pk"])

    def perform_destroy(self, instance: Document) -> None:
        is_owner = WorkspaceMember.objects.filter(
            workspace_id=instance.workspace_id,
            user=self.request.user,
            role=WorkspaceMember.Role.OWNER,
        ).exists()
        if instance.uploaded_by_id != self.request.user.id and not is_owner:
            raise PermissionDenied("Only the uploader or a workspace owner can delete this.")
        instance.file.delete(save=False)
        instance.delete()


class ChunkDetailView(generics.RetrieveAPIView):
    """GET one chunk's text. Citations store chunk ids, and clicking one in the UI
    fetches the passage on demand (rather than copying every chunk's text into
    each saved message)."""

    serializer_class = ChunkSerializer

    def get_object(self) -> Chunk:
        chunks = Chunk.objects.filter(
            document__workspace__in=workspaces_for_user(self.request.user)
        ).select_related("document")
        return get_object_or_404(chunks, pk=self.kwargs["pk"])
