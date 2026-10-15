import uuid
from pathlib import Path

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.db import models
from pgvector.django import HnswIndex, VectorField

from apps.workspaces.models import Workspace


def document_upload_path(instance: "Document", filename: str) -> str:
    # Prefix with a uuid so two uploads with the same name never collide, and
    # group by workspace so storage mirrors the tenant boundary.
    return f"documents/{instance.workspace_id}/{uuid.uuid4().hex}_{Path(filename).name}"


class Document(models.Model):
    class Status(models.TextChoices):
        UPLOADED = "uploaded", "Uploaded"
        PROCESSING = "processing", "Processing"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    class FileType(models.TextChoices):
        PDF = "pdf", "PDF"
        DOCX = "docx", "DOCX"
        TXT = "txt", "TXT"
        XLSX = "xlsx", "Excel"
        CSV = "csv", "CSV"

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="documents")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="documents"
    )
    title = models.CharField(max_length=255)
    file = models.FileField(upload_to=document_upload_path, max_length=500)
    file_type = models.CharField(max_length=10, choices=FileType.choices)
    file_size = models.PositiveBigIntegerField(default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.UPLOADED)
    error_message = models.TextField(blank=True)
    page_count = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "-created_at"])]

    def __str__(self) -> str:
        return self.title


class Chunk(models.Model):
    """A ~600-token slice of a document, with its embedding and full-text vector."""

    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="chunks")
    content = models.TextField()
    page_number = models.PositiveIntegerField()
    chunk_index = models.PositiveIntegerField()
    token_count = models.PositiveIntegerField()
    embedding = VectorField(dimensions=settings.EMBEDDING_DIMENSIONS)
    # Filled by Postgres (to_tsvector) after insert; used for keyword search in Phase 5.
    search_vector = SearchVectorField(null=True)

    class Meta:
        ordering = ["document_id", "chunk_index"]
        constraints = [
            models.UniqueConstraint(fields=["document", "chunk_index"], name="unique_chunk_index")
        ]
        indexes = [
            # HNSW (vs. IVFFlat): better recall/speed trade-off, no training step,
            # and it stays accurate as rows are added (IVFFlat's clusters go stale).
            # vector_cosine_ops matches the cosine-distance (<=>) queries we run.
            # m / ef_construction are pgvector's defaults, written out for clarity.
            HnswIndex(
                name="chunk_embedding_hnsw",
                fields=["embedding"],
                m=16,
                ef_construction=64,
                opclasses=["vector_cosine_ops"],
            ),
            GinIndex(fields=["search_vector"], name="chunk_search_vector_gin"),
        ]

    def __str__(self) -> str:
        return f"{self.document_id}#{self.chunk_index} (p.{self.page_number})"
