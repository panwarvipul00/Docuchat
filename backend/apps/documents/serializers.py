from pathlib import Path

from rest_framework import serializers

from .models import Document
from .validators import validate_upload


class DocumentSerializer(serializers.ModelSerializer):
    uploaded_by_email = serializers.EmailField(source="uploaded_by.email", read_only=True)

    class Meta:
        model = Document
        fields = [
            "id",
            "workspace",
            "title",
            "file_type",
            "file_size",
            "status",
            "error_message",
            "page_count",
            "uploaded_by",
            "uploaded_by_email",
            "created_at",
        ]
        read_only_fields = fields


class DocumentUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    title = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate(self, attrs: dict) -> dict:
        attrs["file_type"] = validate_upload(attrs["file"])
        if not attrs.get("title"):
            attrs["title"] = Path(attrs["file"].name).stem[:255]
        return attrs
