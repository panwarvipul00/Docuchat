import pytest
from django.core.files.base import ContentFile

from apps.documents.models import Chunk, Document
from services.embeddings import embed_texts
from services.retrieval import vector_search

pytestmark = pytest.mark.django_db


def add_document(workspace, user, texts: list[str], status=Document.Status.READY, title="doc"):
    doc = Document.objects.create(
        workspace=workspace,
        uploaded_by=user,
        title=title,
        file=ContentFile(b"x", name=f"{title}.txt"),
        file_type="txt",
        status=status,
    )
    vectors = embed_texts(texts)
    Chunk.objects.bulk_create(
        Chunk(
            document=doc,
            content=t,
            page_number=i + 1,
            chunk_index=i,
            token_count=len(t.split()),
            embedding=v,
        )
        for i, (t, v) in enumerate(zip(texts, vectors, strict=True))
    )
    return doc


def search(workspace, query: str, k: int = 8):
    [vec] = embed_texts([query])
    return vector_search(workspace, vec, k=k)


def test_returns_closest_chunk_first_with_metadata(workspace, user):
    doc = add_document(
        workspace,
        user,
        ["the mitochondria produces atp energy", "volcanoes erupt molten lava rock"],
        title="Biology",
    )
    results = search(workspace, "how do volcanoes erupt lava")
    assert results[0].content.startswith("volcanoes")
    assert results[0].title == "Biology"
    assert results[0].page == 2
    assert results[0].document_id == doc.id
    assert results[0].distance <= results[1].distance


def test_never_returns_other_workspace_chunks(workspace, user, other_workspace, other_user):
    add_document(other_workspace, other_user, ["secret quarterly revenue numbers"])
    add_document(workspace, user, ["gardening tips for tomatoes"])
    results = search(workspace, "secret quarterly revenue numbers")
    assert [r.content for r in results] == ["gardening tips for tomatoes"]


def test_skips_documents_that_are_not_ready(workspace, user):
    add_document(workspace, user, ["half processed text"], status=Document.Status.PROCESSING)
    add_document(workspace, user, ["broken text"], status=Document.Status.FAILED)
    assert search(workspace, "half processed text") == []


def test_respects_k(workspace, user):
    add_document(workspace, user, [f"fact number {i} about cats" for i in range(20)])
    assert len(search(workspace, "cats", k=8)) == 8


def test_small_workspace_still_gets_results_among_many_others(
    workspace, user, other_workspace, other_user
):
    # 300 near-identical chunks elsewhere crowd the global nearest neighbours;
    # the workspace filter must still surface our 2 chunks.
    add_document(other_workspace, other_user, [f"rocket engine thrust {i}" for i in range(300)])
    add_document(workspace, user, ["rocket engine thrust overview", "unrelated cooking recipe"])
    results = search(workspace, "rocket engine thrust")
    assert len(results) == 2
    assert results[0].content == "rocket engine thrust overview"
