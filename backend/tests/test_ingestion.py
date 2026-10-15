from unittest import mock

import pytest
from django.core.files.base import ContentFile
from pgvector.django import CosineDistance

from apps.documents.models import Chunk, Document
from services import embeddings
from services.embeddings import EmbeddingError, embed_texts
from services.ingestion import ingest_document
from tests.factories import make_blank_pdf, make_pdf

pytestmark = pytest.mark.django_db

BODIES = [
    "Photosynthesis converts sunlight into chemical energy in plants. " * 40,
    "The mitochondria is the powerhouse of the cell and produces ATP. " * 40,
    "Plate tectonics explains how continents drift over geological time. " * 40,
]


def make_document(workspace, user, data: bytes, name="bio.pdf", file_type="pdf") -> Document:
    return Document.objects.create(
        workspace=workspace,
        uploaded_by=user,
        title=name,
        file=ContentFile(data, name=name),
        file_type=file_type,
        file_size=len(data),
    )


def test_ingest_pdf_creates_embedded_searchable_chunks(workspace, user):
    doc = make_document(workspace, user, make_pdf(BODIES))
    ingest_document(doc.id)

    doc.refresh_from_db()
    assert doc.status == Document.Status.READY
    assert doc.page_count == 3
    assert doc.error_message == ""

    chunks = list(doc.chunks.all())
    assert len(chunks) >= 3
    assert {c.page_number for c in chunks} == {1, 2, 3}
    assert all(len(c.embedding) == 1536 for c in chunks)
    assert all(c.token_count <= 600 for c in chunks)

    # Full-text vector was populated and is searchable.
    assert Chunk.objects.filter(document=doc, search_vector="mitochondria").exists()

    # The vector index answers a nearest-neighbour query sensibly.
    [qvec] = embed_texts(["mitochondria powerhouse cell ATP"])
    best = Chunk.objects.order_by(CosineDistance("embedding", qvec)).first()
    assert best is not None and best.page_number == 2


def test_reprocessing_replaces_chunks(workspace, user):
    doc = make_document(workspace, user, make_pdf(BODIES))
    ingest_document(doc.id)
    first = doc.chunks.count()
    ingest_document(doc.id)
    assert doc.chunks.count() == first


def test_unreadable_document_is_marked_failed(workspace, user):
    doc = make_document(workspace, user, make_blank_pdf(), name="scan.pdf")
    ingest_document(doc.id)

    doc.refresh_from_db()
    assert doc.status == Document.Status.FAILED
    assert "No extractable text" in doc.error_message
    assert not doc.chunks.exists()


def test_embedding_failure_is_marked_failed(workspace, user):
    doc = make_document(workspace, user, make_pdf(BODIES))
    with mock.patch.object(
        embeddings.FakeEmbeddingProvider, "embed", side_effect=EmbeddingError("quota exceeded")
    ):
        ingest_document(doc.id)

    doc.refresh_from_db()
    assert doc.status == Document.Status.FAILED
    assert doc.error_message == "quota exceeded"


def test_unexpected_error_hides_internals(workspace, user):
    doc = make_document(workspace, user, make_pdf(BODIES))
    with mock.patch("services.ingestion.chunk_pages", side_effect=RuntimeError("secret path /x")):
        ingest_document(doc.id)
    doc.refresh_from_db()
    assert doc.status == Document.Status.FAILED
    assert "secret" not in doc.error_message


def test_missing_document_is_a_noop():
    ingest_document(999_999)  # must not raise


def test_embeddings_are_batched(settings):
    settings.EMBEDDING_BATCH_SIZE = 64
    with mock.patch.object(
        embeddings.FakeEmbeddingProvider,
        "embed",
        autospec=True,
        side_effect=lambda self, batch, **kw: [[0.0] * 1536 for _ in batch],
    ) as embed:
        vectors = embed_texts([f"text {i}" for i in range(150)])
    assert len(vectors) == 150
    assert [len(call.args[1]) for call in embed.call_args_list] == [64, 64, 22]


def test_embedding_batches_are_capped_by_tokens(settings):
    settings.EMBEDDING_BATCH_SIZE = 64
    settings.EMBEDDING_BATCH_TOKENS = 1_000
    text = "word " * 299  # 300 tokens incl. the trailing space run
    n = embeddings.count_tokens(text)
    with mock.patch.object(
        embeddings.FakeEmbeddingProvider,
        "embed",
        autospec=True,
        side_effect=lambda self, batch, **kw: [[0.0] * 1536 for _ in batch],
    ) as embed:
        vectors = embed_texts([text] * 10)
    assert len(vectors) == 10
    sizes = [len(call.args[1]) for call in embed.call_args_list]
    assert sum(sizes) == 10
    assert all(size * n <= 1_000 for size in sizes)


def test_oversized_text_is_sent_alone():
    big, small = "word " * 50, "hi"
    batches = list(embeddings.batched([small, big, small], size=10, max_tokens=20))
    assert batches == [[small], [big], [small]]


def test_openai_provider_requires_key(settings):
    settings.EMBEDDING_PROVIDER = "openai"
    settings.OPENAI_API_KEY = ""
    embeddings.get_embedding_provider.cache_clear()
    with pytest.raises(EmbeddingError, match="OPENAI_API_KEY"):
        embeddings.get_embedding_provider()


def test_upload_enqueues_processing_after_commit(
    auth_client, workspace, django_capture_on_commit_callbacks
):
    pdf = make_pdf(["Hello world. This is a test document."])
    with mock.patch("apps.documents.views.process_document.delay") as delay:
        with django_capture_on_commit_callbacks(execute=True):
            res = auth_client.post(
                f"/api/workspaces/{workspace.id}/documents/",
                {"file": ContentFile(pdf, name="hello.pdf")},
                format="multipart",
            )
    assert res.status_code == 201
    delay.assert_called_once_with(res.data["id"])


def test_deleting_document_deletes_chunks(auth_client, workspace, user):
    doc = make_document(workspace, user, make_pdf(BODIES))
    ingest_document(doc.id)
    assert Chunk.objects.filter(document_id=doc.id).exists()
    assert auth_client.delete(f"/api/documents/{doc.id}/").status_code == 204
    assert not Chunk.objects.filter(document_id=doc.id).exists()
