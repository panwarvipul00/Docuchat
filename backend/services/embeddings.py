"""Embedding provider wrapper.

All embedding calls go through `get_embedding_provider()`, so swapping OpenAI
for another provider means adding one class here and changing an env var.
"""

import hashlib
import math
from collections.abc import Iterator, Sequence
from functools import lru_cache
from typing import Protocol

from django.conf import settings

from services.chunking import count_tokens
from services.provider_errors import (
    GEMINI_BASE_URL,
    PATIENT_RETRIES,
    call_with_retries,
    friendly_message,
)


class EmbeddingError(Exception):
    pass


class EmbeddingProvider(Protocol):
    dimensions: int

    def embed(self, texts: Sequence[str], patient: bool = False) -> list[list[float]]:
        """Embed a batch of texts; returns one vector per input, in order.

        `patient` retries rate limits for ~90s instead of ~7s (background jobs)."""
        ...


class OpenAICompatibleEmbeddingProvider:
    """OpenAI's embeddings API, or any OpenAI-compatible one (Gemini) via base_url."""

    def __init__(
        self,
        api_key: str,
        model: str,
        dimensions: int,
        base_url: str | None = None,
        provider_name: str = "OpenAI",
        key_name: str = "OPENAI_API_KEY",
    ) -> None:
        if not api_key:
            raise EmbeddingError(
                f"{key_name} is not set. Add it to .env, or set EMBEDDING_PROVIDER=fake "
                "for local testing."
            )
        from openai import OpenAI

        # Retries are handled by call_with_retries, which skips permanent errors.
        self._client = OpenAI(api_key=api_key, base_url=base_url, max_retries=0, timeout=60)
        self.model = model
        self.dimensions = dimensions
        self.provider_name = provider_name

    def embed(self, texts: Sequence[str], patient: bool = False) -> list[list[float]]:
        if not texts:
            return []
        try:
            res = call_with_retries(
                lambda: self._client.embeddings.create(
                    model=self.model, input=list(texts), dimensions=self.dimensions
                ),
                **(PATIENT_RETRIES if patient else {}),
            )
        except Exception as exc:
            raise EmbeddingError(friendly_message(exc, self.provider_name)) from exc
        # OpenAI tags items with their input index, so sort by it to be safe.
        # Gemini's compatible API leaves index unset and returns items in input order.
        items = res.data
        if all(item.index is not None for item in items):
            items = sorted(items, key=lambda d: d.index)
        vectors = [item.embedding for item in items]
        if len(vectors) != len(texts):
            raise EmbeddingError(f"Expected {len(texts)} embeddings, got {len(vectors)}")
        if vectors and len(vectors[0]) != self.dimensions:
            raise EmbeddingError(
                f"{self.provider_name} returned {len(vectors[0])}-dim embeddings but the "
                f"database expects {self.dimensions}. Check EMBEDDING_MODEL."
            )
        return vectors


class FakeEmbeddingProvider:
    """Deterministic, offline embeddings for tests and keyless local runs.

    Hashes each word into a bucket (a "hashing trick" bag-of-words), then
    L2-normalizes. Texts sharing words get similar vectors, so retrieval tests
    behave sensibly, but this has no real semantic understanding.
    """

    def __init__(self, dimensions: int) -> None:
        self.dimensions = dimensions

    def embed(self, texts: Sequence[str], patient: bool = False) -> list[list[float]]:
        return [self._embed_one(t) for t in texts]

    def _embed_one(self, text: str) -> list[float]:
        vec = [0.0] * self.dimensions
        for word in text.lower().split():
            digest = hashlib.blake2b(word.encode(), digest_size=8).digest()
            vec[int.from_bytes(digest, "big") % self.dimensions] += 1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


@lru_cache(maxsize=1)
def get_embedding_provider() -> EmbeddingProvider:
    name = settings.EMBEDDING_PROVIDER
    if name == "openai":
        return OpenAICompatibleEmbeddingProvider(
            settings.OPENAI_API_KEY, settings.EMBEDDING_MODEL, settings.EMBEDDING_DIMENSIONS
        )
    if name == "gemini":
        return OpenAICompatibleEmbeddingProvider(
            settings.GEMINI_API_KEY,
            settings.EMBEDDING_MODEL,
            settings.EMBEDDING_DIMENSIONS,
            base_url=GEMINI_BASE_URL,
            provider_name="Gemini",
            key_name="GEMINI_API_KEY",
        )
    if name == "fake":
        return FakeEmbeddingProvider(settings.EMBEDDING_DIMENSIONS)
    raise EmbeddingError(f"Unknown EMBEDDING_PROVIDER: {name!r}")


def batched(
    items: Sequence[str], size: int, max_tokens: int | None = None
) -> Iterator[Sequence[str]]:
    """Consecutive slices of at most `size` items and (if set) `max_tokens` tokens.

    A single item over `max_tokens` still goes out alone rather than being dropped.
    """
    start, tokens = 0, 0
    for i, item in enumerate(items):
        n = count_tokens(item) if max_tokens else 0
        if i > start and (i - start >= size or (max_tokens and tokens + n > max_tokens)):
            yield items[start:i]
            start, tokens = i, 0
        tokens += n
    if start < len(items):
        yield items[start:]


def embed_texts(
    texts: Sequence[str], batch_size: int | None = None, patient: bool = False
) -> list[list[float]]:
    """Embed many texts in batches.

    Batching cuts HTTP round-trips ~64x versus one call per chunk. Batches are
    capped by tokens as well as count: Gemini's free tier rejects a single
    request of ~32k tokens (64 full chunks) with a 429 that no retry can fix,
    while the same text split into ~8k-token requests goes through.

    `patient=True` (document ingestion) waits out per-minute rate limits
    instead of failing; questions keep the short retry so chat stays snappy.
    """
    provider = get_embedding_provider()
    size = batch_size or settings.EMBEDDING_BATCH_SIZE
    vectors: list[list[float]] = []
    for batch in batched(texts, size, settings.EMBEDDING_BATCH_TOKENS):
        result = provider.embed(batch, patient=patient)
        if len(result) != len(batch):
            raise EmbeddingError(f"Expected {len(batch)} embeddings, got {len(result)}")
        vectors.extend(result)
    return vectors
