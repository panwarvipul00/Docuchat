import pytest

from services.chunking import chunk_pages, count_tokens, split_sentences
from services.parsing import Page


def sentences(n: int, prefix: str = "Fact") -> str:
    return " ".join(
        f"{prefix} number {i} is an interesting statement about the topic." for i in range(n)
    )


def test_short_text_is_one_chunk():
    chunks = chunk_pages([Page(1, "Just one sentence.")])
    assert len(chunks) == 1
    assert chunks[0].content == "Just one sentence."
    assert chunks[0].page_number == 1
    assert chunks[0].chunk_index == 0
    assert chunks[0].token_count == count_tokens("Just one sentence.")


def test_empty_pages_give_no_chunks():
    assert chunk_pages([Page(1, ""), Page(2, "   ")]) == []


def test_chunks_respect_token_budget_and_are_indexed():
    chunks = chunk_pages([Page(1, sentences(400))], max_tokens=200, overlap_tokens=40)
    assert len(chunks) > 5
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    assert all(c.token_count <= 200 for c in chunks)


def test_chunks_never_split_mid_sentence():
    chunks = chunk_pages([Page(1, sentences(200))], max_tokens=150, overlap_tokens=30)
    for c in chunks:
        assert c.content.startswith("Fact number")
        assert c.content.endswith("topic.")


def test_consecutive_chunks_overlap():
    chunks = chunk_pages([Page(1, sentences(200))], max_tokens=150, overlap_tokens=40)
    for prev, nxt in zip(chunks, chunks[1:], strict=False):
        prev_sentences = split_sentences(prev.content)
        nxt_sentences = split_sentences(nxt.content)
        # The next chunk opens with the tail of the previous one...
        assert nxt_sentences[0] in prev_sentences[1:]
        assert prev_sentences[-1] in nxt_sentences
        # ...but a chunk is never just a copy of the previous one.
        assert nxt.content != prev.content


def test_chunks_never_cross_pages():
    pages = [Page(1, sentences(30, "Alpha")), Page(2, sentences(30, "Beta"))]
    chunks = chunk_pages(pages, max_tokens=120, overlap_tokens=30)
    for c in chunks:
        if c.page_number == 1:
            assert "Beta" not in c.content
        else:
            assert "Alpha" not in c.content
    assert {c.page_number for c in chunks} == {1, 2}
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_oversized_sentence_is_hard_split():
    giant = "word " * 1000  # no sentence boundary at all
    chunks = chunk_pages([Page(1, giant)], max_tokens=100, overlap_tokens=10)
    assert len(chunks) >= 10
    assert all(c.token_count <= 100 for c in chunks)


def test_overlap_must_be_smaller_than_chunk():
    with pytest.raises(ValueError):
        chunk_pages([Page(1, "x.")], max_tokens=100, overlap_tokens=100)


def test_split_sentences_joins_wrapped_lines():
    text = "This sentence wraps\nonto a new line. Second one!\n\nNew paragraph"
    assert split_sentences(text) == [
        "This sentence wraps onto a new line.",
        "Second one!",
        "New paragraph",
    ]
