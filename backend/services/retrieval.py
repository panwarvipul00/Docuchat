"""Workspace-scoped vector search over document chunks.

Tenant isolation is enforced here, in the query itself: the caller passes a
workspace and we only ever look at chunks of `ready` documents in it.
"""

from collections.abc import Collection
from dataclasses import dataclass

from django.db import connection, transaction
from pgvector.django import CosineDistance

from apps.documents.models import Chunk, Document
from apps.workspaces.models import Workspace

DEFAULT_TOP_K = 8


@dataclass(frozen=True)
class RetrievedChunk:
    chunk_id: int
    document_id: int
    title: str
    file_type: str
    page: int  # page number, or sheet number for spreadsheets
    content: str
    distance: float  # cosine distance: 0 = identical direction, 2 = opposite


def vector_search(
    workspace: Workspace,
    query_embedding: list[float],
    k: int = DEFAULT_TOP_K,
    document_ids: Collection[int] | None = None,
) -> list[RetrievedChunk]:
    """Top-k chunks in `workspace` closest to `query_embedding` (cosine distance).

    `document_ids` narrows the search to those documents. It is applied on top
    of the workspace filter, never instead of it, so passing another
    workspace's ids can only shrink the results, never leak them.
    """
    qs = Chunk.objects.filter(document__workspace=workspace, document__status=Document.Status.READY)
    if document_ids:
        qs = qs.filter(document_id__in=document_ids)
    qs = (
        qs.annotate(distance=CosineDistance("embedding", query_embedding))
        .order_by("distance")
        .select_related("document")[:k]
    )

    with transaction.atomic():
        with connection.cursor() as cursor:
            # The HNSW index is global across all workspaces. A plain index scan
            # returns the ~40 nearest chunks *overall* (hnsw.ef_search) and only
            # then applies our workspace filter, so a small workspace could get
            # fewer than k results, or none. pgvector >= 0.8 "iterative scans"
            # keep walking the graph until k rows pass the filter. SET LOCAL
            # scopes these settings to this transaction only.
            cursor.execute("SET LOCAL hnsw.iterative_scan = strict_order")
            cursor.execute("SET LOCAL hnsw.ef_search = 100")
        rows = list(qs)

    return [
        RetrievedChunk(
            chunk_id=c.id,
            document_id=c.document_id,
            title=c.document.title,
            file_type=c.document.file_type,
            page=c.page_number,
            content=c.content,
            distance=float(c.distance),
        )
        for c in rows
    ]
