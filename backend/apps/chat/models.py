from django.conf import settings
from django.db import models

from apps.workspaces.models import Workspace


class Conversation(models.Model):
    class AnswerMode(models.TextChoices):
        DOCUMENTS = "documents", "Documents only"
        GENERAL = "general", "Documents + general knowledge"

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="conversations")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="conversations"
    )
    title = models.CharField(max_length=200, blank=True)
    # Optional scope: if set, questions only search these documents; empty means
    # the whole workspace. Stored on the conversation so the choice survives a
    # reload and follow-up questions stay on the same files.
    documents = models.ManyToManyField(
        "documents.Document", blank=True, related_name="conversations"
    )
    # "documents": answer strictly from the files. "general": may also use the
    # model's own knowledge, clearly labelled (see services/rag.py).
    answer_mode = models.CharField(
        max_length=20, choices=AnswerMode.choices, default=AnswerMode.DOCUMENTS
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["workspace", "user", "-updated_at"])]

    def __str__(self) -> str:
        return self.title or f"Conversation {self.pk}"


class Message(models.Model):
    class Role(models.TextChoices):
        USER = "user", "User"
        ASSISTANT = "assistant", "Assistant"

    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField()
    # [{index, document_id, chunk_id, title, file_type, page}] for the sources the answer cites.
    citations = models.JSONField(default=list, blank=True)
    tokens_used = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return f"{self.role}: {self.content[:40]}"
