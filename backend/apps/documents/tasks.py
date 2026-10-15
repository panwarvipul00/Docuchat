from celery import shared_task

from services.ingestion import ingest_document


@shared_task(name="documents.process_document")
def process_document(document_id: int) -> None:
    """Parse, chunk, embed and store a document. See services/ingestion.py."""
    ingest_document(document_id)
