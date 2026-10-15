"""Upload validation.

We check both the extension *and* the file's leading bytes ("magic number"),
because the extension and the browser-supplied content type are both trivially
spoofable. This keeps obviously-wrong files out before the parser ever sees them.
"""

from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from rest_framework.exceptions import ValidationError

from .models import Document

EXTENSION_TO_TYPE = {
    ".pdf": Document.FileType.PDF,
    ".docx": Document.FileType.DOCX,
    ".txt": Document.FileType.TXT,
    ".xlsx": Document.FileType.XLSX,
    ".csv": Document.FileType.CSV,
}

# Formats people often try that we can't read, with what to do instead.
UNSUPPORTED_HINTS = {
    ".xls": "Old .xls files aren't supported. In Excel use File > Save As > .xlsx.",
    ".doc": "Old .doc files aren't supported. In Word use File > Save As > .docx.",
}

SUPPORTED_LABEL = "PDF, DOCX, TXT, XLSX, or CSV"


def _looks_like(file_type: str, head: bytes) -> bool:
    if file_type == Document.FileType.PDF:
        return head.startswith(b"%PDF-")
    if file_type in (Document.FileType.DOCX, Document.FileType.XLSX):
        return head.startswith(b"PK\x03\x04")  # both are zip archives
    if file_type in (Document.FileType.TXT, Document.FileType.CSV):
        try:
            head.decode("utf-8")
        except UnicodeDecodeError as exc:
            # The 2 KB window may cut a multibyte char in half; only fail on
            # errors that aren't at the very end of the sample.
            return exc.start >= len(head) - 3
        return b"\x00" not in head
    return False


def validate_upload(file: UploadedFile) -> str:
    """Validate the uploaded file and return its normalized file type."""
    if file.size == 0:
        raise ValidationError({"file": "The file is empty."})
    if file.size > settings.MAX_UPLOAD_SIZE:
        max_mb = settings.MAX_UPLOAD_SIZE // (1024 * 1024)
        raise ValidationError({"file": f"File is too large (max {max_mb} MB)."})

    suffix = Path(file.name).suffix.lower()
    file_type = EXTENSION_TO_TYPE.get(suffix)
    if file_type is None:
        hint = UNSUPPORTED_HINTS.get(suffix, f"Upload a {SUPPORTED_LABEL} file.")
        raise ValidationError({"file": f"Unsupported file type. {hint}"})

    head = file.read(2048)
    file.seek(0)
    if not _looks_like(file_type, head):
        raise ValidationError({"file": f"File contents don't match a valid .{file_type} file."})

    return file_type
