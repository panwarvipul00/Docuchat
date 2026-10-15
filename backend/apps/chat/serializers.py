from rest_framework import serializers

from apps.documents.models import Document

from .models import Conversation, Message


class ConversationSerializer(serializers.ModelSerializer):
    document_ids = serializers.PrimaryKeyRelatedField(
        source="documents",
        many=True,
        required=False,
        queryset=Document.objects.all(),
        # Unknown ids and ids from other workspaces get the same error, so the
        # response doesn't reveal whether a document exists elsewhere.
        error_messages={"does_not_exist": "Document {pk_value} is not in this workspace."},
    )

    class Meta:
        model = Conversation
        fields = [
            "id",
            "workspace",
            "title",
            "document_ids",
            "answer_mode",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "workspace", "created_at", "updated_at"]
        extra_kwargs = {"title": {"required": False}}

    def validate_document_ids(self, documents: list[Document]) -> list[Document]:
        # The view passes the workspace (on create) or we take it from the instance.
        workspace = self.instance.workspace if self.instance else self.context["workspace"]
        for doc in documents:
            if doc.workspace_id != workspace.id:
                raise serializers.ValidationError(f"Document {doc.pk} is not in this workspace.")
        return documents


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["id", "role", "content", "citations", "tokens_used", "created_at"]
        read_only_fields = fields


class AskSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=2000, trim_whitespace=True)
