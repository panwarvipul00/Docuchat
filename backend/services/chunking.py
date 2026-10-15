"""Pages of text -> overlapping, sentence-aligned chunks.

Why ~600 tokens with ~100 overlap?
- Small enough that one chunk is about one idea, so its embedding is focused
  and 8 retrieved chunks (~5k tokens) fit comfortably in the LLM prompt.
- Big enough to carry surrounding context (a definition plus its explanation).
- The overlap means a fact that straddles a chunk boundary still appears whole
  in at least one chunk.

We pack whole sentences greedily rather than cutting at a fixed token offset,
so chunks don't start or end mid-sentence. Only a single sentence longer than
the whole budget (e.g. a giant table row) is hard-split by tokens.

Spreadsheet sheets (`Page.records`) are packed by row instead of by sentence,
so a row is never split at a "." inside a cell, and every chunk starts with
the sheet name so it stands on its own.

Chunks never cross a page boundary. That keeps every citation exact ("page 7"
really means page 7), at the cost of a short final chunk on each page and the
occasional sentence cut by a page break. For a citation-first app that's the
right trade.
"""

import re
from dataclasses import dataclass
from functools import lru_cache

import tiktoken

from services.parsing import Page

DEFAULT_CHUNK_TOKENS = 600
DEFAULT_OVERLAP_TOKENS = 100

# Sentence boundary: ., ! or ? (optionally followed by a closing quote/bracket)
# then whitespace; or a blank line (paragraph break). Imperfect for things like
# "e.g. foo", but for chunking a near-miss only shifts a boundary slightly.
_SENTENCE_RE = re.compile(r"(?<=[.!?])[\"')\]]*\s+|\n\s*\n")


@lru_cache(maxsize=1)
def _encoding() -> tiktoken.Encoding:
    # cl100k_base is the tokenizer used by text-embedding-3-* models.
    return tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    return len(_encoding().encode(text, disallowed_special=()))


@dataclass(frozen=True)
class Chunk:
    content: str
    page_number: int
    chunk_index: int
    token_count: int


@dataclass(frozen=True)
class _Sentence:
    text: str
    tokens: int


def split_sentences(text: str) -> list[str]:
    parts = (s.strip() for s in _SENTENCE_RE.split(text))
    # Collapse internal newlines: PDFs wrap lines mid-sentence.
    return [re.sub(r"\s*\n\s*", " ", s) for s in parts if s]


def _hard_split(text: str, max_tokens: int) -> list[_Sentence]:
    enc = _encoding()
    ids = enc.encode(text, disallowed_special=())
    return [
        _Sentence(enc.decode(ids[i : i + max_tokens]), len(ids[i : i + max_tokens]))
        for i in range(0, len(ids), max_tokens)
    ]


def _sentences(text: str, max_tokens: int) -> list[_Sentence]:
    out: list[_Sentence] = []
    for sentence in split_sentences(text):
        n = count_tokens(sentence)
        if n > max_tokens:
            out.extend(_hard_split(sentence, max_tokens))
        else:
            out.append(_Sentence(sentence, n))
    return out


def _pack(
    sentences: list[_Sentence], max_tokens: int, overlap_tokens: int, joiner: str = " "
) -> list[str]:
    """Greedily pack sentences into windows of <= max_tokens, with overlap."""
    windows: list[str] = []
    window: list[_Sentence] = []
    window_tokens = 0

    for sentence in sentences:
        # +1 approximates the joining space.
        if window and window_tokens + sentence.tokens + 1 > max_tokens:
            windows.append(joiner.join(s.text for s in window))
            # Carry trailing sentences (up to the overlap budget) into the next
            # window. Skip window[0] so a chunk is never repeated wholesale.
            carried: list[_Sentence] = []
            carried_tokens = 0
            for prev in reversed(window[1:]):
                if carried_tokens + prev.tokens > overlap_tokens:
                    break
                carried.insert(0, prev)
                carried_tokens += prev.tokens + 1
            # If overlap + the new sentence still won't fit, drop the overlap.
            if carried_tokens + sentence.tokens > max_tokens:
                carried, carried_tokens = [], 0
            window, window_tokens = carried, carried_tokens

        window.append(sentence)
        window_tokens += sentence.tokens + 1

    if window:
        windows.append(joiner.join(s.text for s in window))
    return windows


def chunk_pages(
    pages: list[Page],
    max_tokens: int = DEFAULT_CHUNK_TOKENS,
    overlap_tokens: int = DEFAULT_OVERLAP_TOKENS,
) -> list[Chunk]:
    if overlap_tokens >= max_tokens:
        raise ValueError("overlap_tokens must be smaller than max_tokens")

    chunks: list[Chunk] = []
    for page in pages:
        if page.records:
            chunks.extend(_record_chunks(page, max_tokens, overlap_tokens, start=len(chunks)))
            continue
        for content in _pack(_sentences(page.text, max_tokens), max_tokens, overlap_tokens):
            chunks.append(Chunk(content, page.number, len(chunks), count_tokens(content)))
    return chunks


def _record_chunks(page: Page, max_tokens: int, overlap_tokens: int, start: int) -> list[Chunk]:
    heading = f"{page.heading}\n" if page.heading else ""
    budget = max_tokens - count_tokens(heading)
    records: list[_Sentence] = []
    for record in (r.strip() for r in page.text.split("\n\n")):
        if not record:
            continue
        n = count_tokens(record)
        records.extend(_hard_split(record, budget) if n > budget else [_Sentence(record, n)])
    out: list[Chunk] = []
    for body in _pack(records, budget, overlap_tokens, joiner="\n"):
        content = heading + body
        out.append(Chunk(content, page.number, start + len(out), count_tokens(content)))
    return out
