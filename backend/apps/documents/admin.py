from django.contrib import admin

from .models import Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ["title", "workspace", "file_type", "status", "created_at"]
    list_filter = ["status", "file_type"]
    search_fields = ["title"]
