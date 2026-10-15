import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.documents.models import Document
from apps.workspaces.models import WorkspaceMember
from tests.test_retrieval import add_document

pytestmark = pytest.mark.django_db

PDF_BYTES = b"%PDF-1.4\n%fake minimal pdf for tests\n"


def pdf(name: str = "report.pdf", content: bytes = PDF_BYTES) -> SimpleUploadedFile:
    return SimpleUploadedFile(name, content, content_type="application/pdf")


def upload(client, workspace_id: int, file):
    return client.post(
        f"/api/workspaces/{workspace_id}/documents/", {"file": file}, format="multipart"
    )


# --- upload & validation ---


def test_upload_pdf(auth_client, workspace, user):
    res = upload(auth_client, workspace.id, pdf())
    assert res.status_code == 201, res.data
    assert res.data["title"] == "report"
    assert res.data["file_type"] == "pdf"
    assert res.data["status"] == "uploaded"
    doc = Document.objects.get(pk=res.data["id"])
    assert doc.workspace == workspace and doc.uploaded_by == user


def test_upload_txt_and_docx(auth_client, workspace):
    txt = SimpleUploadedFile("notes.txt", "héllo world".encode(), content_type="text/plain")
    assert upload(auth_client, workspace.id, txt).status_code == 201
    docx = SimpleUploadedFile("a.docx", b"PK\x03\x04rest-of-zip")
    assert upload(auth_client, workspace.id, docx).status_code == 201


def test_rejects_unsupported_extension(auth_client, workspace):
    res = upload(auth_client, workspace.id, SimpleUploadedFile("x.exe", b"MZ..."))
    assert res.status_code == 400
    assert "file" in res.data


def test_rejects_spoofed_extension(auth_client, workspace):
    res = upload(auth_client, workspace.id, pdf("evil.pdf", b"MZ not a pdf"))
    assert res.status_code == 400


def test_rejects_oversized_file(auth_client, workspace, settings):
    settings.MAX_UPLOAD_SIZE = 10
    res = upload(auth_client, workspace.id, pdf())
    assert res.status_code == 400
    assert "too large" in str(res.data["file"])


def test_rejects_empty_file(auth_client, workspace):
    res = upload(auth_client, workspace.id, pdf(content=b""))
    assert res.status_code == 400


# --- workspace isolation ---


def test_cannot_list_other_workspace_documents(auth_client, other_workspace):
    assert auth_client.get(f"/api/workspaces/{other_workspace.id}/documents/").status_code == 404


def test_cannot_upload_to_other_workspace(auth_client, other_workspace):
    assert upload(auth_client, other_workspace.id, pdf()).status_code == 404
    assert not Document.objects.exists()


def test_cannot_read_or_delete_other_workspace_document(auth_client, other_user, other_workspace):
    bob = APIClient()
    bob.force_authenticate(other_user)
    doc_id = upload(bob, other_workspace.id, pdf()).data["id"]

    assert auth_client.get(f"/api/documents/{doc_id}/").status_code == 404
    assert auth_client.delete(f"/api/documents/{doc_id}/").status_code == 404
    assert Document.objects.filter(pk=doc_id).exists()


def test_list_shows_only_this_workspace(auth_client, workspace, other_user, other_workspace):
    bob = APIClient()
    bob.force_authenticate(other_user)
    upload(bob, other_workspace.id, pdf("bob.pdf"))
    upload(auth_client, workspace.id, pdf("alice.pdf"))

    res = auth_client.get(f"/api/workspaces/{workspace.id}/documents/")
    assert [d["title"] for d in res.data] == ["alice"]


# --- detail & delete ---


def test_get_and_delete_own_document(auth_client, workspace):
    doc_id = upload(auth_client, workspace.id, pdf()).data["id"]
    res = auth_client.get(f"/api/documents/{doc_id}/")
    assert res.status_code == 200 and res.data["status"] == "uploaded"

    doc = Document.objects.get(pk=doc_id)
    storage, path = doc.file.storage, doc.file.name
    assert storage.exists(path)

    assert auth_client.delete(f"/api/documents/{doc_id}/").status_code == 204
    assert not Document.objects.filter(pk=doc_id).exists()
    assert not storage.exists(path)


def test_plain_member_cannot_delete_others_document(auth_client, workspace, other_user):
    WorkspaceMember.objects.create(workspace=workspace, user=other_user)
    doc_id = upload(auth_client, workspace.id, pdf()).data["id"]

    bob = APIClient()
    bob.force_authenticate(other_user)
    assert bob.get(f"/api/documents/{doc_id}/").status_code == 200  # members can read
    assert bob.delete(f"/api/documents/{doc_id}/").status_code == 403


def test_documents_require_auth(api_client, workspace):
    assert api_client.get(f"/api/workspaces/{workspace.id}/documents/").status_code == 401


# --- chunk detail (citation source passage) ---


def test_get_chunk_returns_source_passage(auth_client, workspace, user):
    doc = add_document(workspace, user, ["first page text", "second page text"], title="Guide")
    chunk = doc.chunks.get(chunk_index=1)
    res = auth_client.get(f"/api/chunks/{chunk.id}/")
    assert res.status_code == 200
    assert res.data == {
        "id": chunk.id,
        "document_id": doc.id,
        "document_title": "Guide",
        "page_number": 2,
        "chunk_index": 1,
        "content": "second page text",
    }


def test_cannot_read_other_workspace_chunk(auth_client, api_client, other_user, other_workspace):
    doc = add_document(other_workspace, other_user, ["bob's secret"])
    chunk_id = doc.chunks.get().id
    assert auth_client.get(f"/api/chunks/{chunk_id}/").status_code == 404
    assert api_client.get(f"/api/chunks/{chunk_id}/").status_code == 401
