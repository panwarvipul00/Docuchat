"""Document ingestion pipeline: parse -> clean -> chunk -> embed -> store.

Called by the `process_document` Celery task. Kept free of Celery so it can be
run and tested directly.
"""

import logging

from django.contrib.postgres.search import SearchVector
from django.db import transaction

from apps.documents.models import Chunk, Document
from services.chunking import chunk_pages
from services.embeddings import EmbeddingError, embed_texts
from services.parsing import ParsingError, parse_file

logger = logging.getLogger(__name__)

# Errors whose message is safe and useful to show the user verbatim.
USER_FACING_ERRORS = (ParsingError, EmbeddingError)


def ingest_document(document_id: int) -> None:
    try:
        document = Document.objects.get(pk=document_id)
    except Document.DoesNotExist:
        logger.info("Document %s was deleted before processing; skipping", document_id)
        return

    Document.objects.filter(pk=document_id).update(
        status=Document.Status.PROCESSING, error_message=""
    )

    try:
        pages = parse_file(document.file.path, document.file_type)
        chunks = chunk_pages(pages)
        if not chunks:
            raise ParsingError("The document contains no text to index.")

        # Embedding is the slow, network-bound part: do it before opening the
        # DB transaction so we don't hold a transaction open during API calls.
        vectors = embed_texts([c.content for c in chunks], patient=True)

        with transaction.atomic():
            # Lock the row; if the user deleted the document mid-processing, stop.
            if not Document.objects.select_for_update().filter(pk=document_id).exists():
                logger.info("Document %s deleted during processing; discarding", document_id)
                return
            # Idempotent: a retried/re-run task replaces chunks instead of duplicating them.
            Chunk.objects.filter(document_id=document_id).delete()
            Chunk.objects.bulk_create(
                [
                    Chunk(
                        document_id=document_id,
                        content=c.content,
                        page_number=c.page_number,
                        chunk_index=c.chunk_index,
                        token_count=c.token_count,
                        embedding=vec,
                    )
                    for c, vec in zip(chunks, vectors, strict=True)
                ],
                batch_size=500,
            )
            # Compute the full-text vector in Postgres with one UPDATE rather
            # than in Python per row. 'english' config = stemming + stop words.
            Chunk.objects.filter(document_id=document_id).update(
                search_vector=SearchVector("content", config="english")
            )
            Document.objects.filter(pk=document_id).update(
                status=Document.Status.READY, page_count=len(pages), error_message=""
            )
        logger.info("Document %s ready: %d pages, %d chunks", document_id, len(pages), len(chunks))

    except Exception as exc:
        logger.exception("Processing document %s failed", document_id)
        message = (
            str(exc)
            if isinstance(exc, USER_FACING_ERRORS)
            else "Processing failed due to an internal error."
        )
        Document.objects.filter(pk=document_id).update(
            status=Document.Status.FAILED, error_message=message[:1000]
        )
