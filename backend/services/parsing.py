"""File -> list of pages of text.

Each parser returns `[(page_number, text), ...]` with 1-based page numbers, which
is what lets answers cite "document X, page N" later.
"""

import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pymupdf
from docx import Document as DocxDocument
from docx.oxml.ns import qn


@dataclass(frozen=True)
class Page:
    number: int
    text: str


class ParsingError(Exception):
    """Raised for files we can't extract usable text from."""


def parse_file(path: str | Path, file_type: str) -> list[Page]:
    parsers = {"pdf": parse_pdf, "docx": parse_docx, "txt": parse_txt}
    if file_type not in parsers:
        raise ParsingError(f"Unsupported file type: {file_type}")
    pages = clean_pages(parsers[file_type](Path(path)))
    if not any(p.text for p in pages):
        raise ParsingError(
            "No extractable text found. Scanned/image-only PDFs need OCR, which isn't supported."
        )
    return pages


def parse_pdf(path: Path) -> list[Page]:
    try:
        with pymupdf.open(path) as pdf:
            if pdf.needs_pass:
                raise ParsingError("PDF is password-protected.")
            # sort=True orders text blocks top-to-bottom, left-to-right, which
            # fixes the jumbled reading order some PDFs produce.
            return [Page(i + 1, page.get_text("text", sort=True)) for i, page in enumerate(pdf)]
    except ParsingError:
        raise
    except Exception as exc:
        raise ParsingError(f"Could not read PDF: {exc}") from exc


def parse_docx(path: Path) -> list[Page]:
    """DOCX has no fixed pages (layout happens in Word), so we approximate them by
    splitting on explicit page breaks and the `lastRenderedPageBreak` markers Word
    saves from its last layout. Documents without those come out as one page."""
    try:
        doc = DocxDocument(str(path))
    except Exception as exc:
        raise ParsingError(f"Could not read DOCX: {exc}") from exc

    pages: list[list[str]] = [[]]
    body = doc.element.body
    for block in body.iterchildren():
        if block.tag == qn("w:p"):
            parts: list[str] = []
            for node in block.iter():
                is_break = (node.tag == qn("w:br") and node.get(qn("w:type")) == "page") or (
                    node.tag == qn("w:lastRenderedPageBreak")
                )
                if is_break:
                    pages[-1].append("".join(parts))
                    parts = []
                    pages.append([])
                elif node.tag == qn("w:t") and node.text:
                    parts.append(node.text)
                elif node.tag == qn("w:tab"):
                    parts.append("\t")
            pages[-1].append("".join(parts))
        elif block.tag == qn("w:tbl"):
            # Flatten tables row by row so their text is still searchable.
            for row in block.iter(qn("w:tr")):
                cells = ["".join(t.text or "" for t in cell.iter(qn("w:t"))) for cell in row]
                pages[-1].append(" | ".join(c for c in cells if c))

    texts = ["\n".join(lines) for lines in pages]
    # Word often emits a rendered break right at the start; drop empty pages
    # at the edges but keep numbering of the rest contiguous.
    while len(texts) > 1 and not texts[0].strip():
        texts.pop(0)
    while len(texts) > 1 and not texts[-1].strip():
        texts.pop()
    return [Page(i + 1, t) for i, t in enumerate(texts)]


def parse_txt(path: Path) -> list[Page]:
    raw = path.read_bytes().decode("utf-8", errors="replace")
    # Form feed (\f) is the conventional plain-text page separator.
    chunks = raw.split("\f") if "\f" in raw else [raw]
    return [Page(i + 1, t) for i, t in enumerate(chunks)]


# ---------- Cleaning ----------

_WS_RE = re.compile(r"[ \t ]+")
_DIGITS_RE = re.compile(r"\d+")
_HYPHEN_BREAK_RE = re.compile(r"(\w)-\n(\w)")


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = _HYPHEN_BREAK_RE.sub(r"\1\2", text)  # re-join words hyphenated across lines
    lines = [_WS_RE.sub(" ", line).strip() for line in text.split("\n")]
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _line_key(line: str) -> str:
    # "Page 3 of 10" and "Page 4 of 10" should count as the same footer.
    return _DIGITS_RE.sub("#", line.strip().lower())


def strip_repeated_headers_footers(pages: list[Page], edge_lines: int = 2) -> list[Page]:
    """Remove lines that appear in the first/last `edge_lines` lines of most pages.

    Running headers/footers ("ACME Corp — Confidential", "Page 3 of 10") add
    noise to every chunk and pull unrelated chunks together in vector space.
    Only applied with 3+ pages, where "repeated" is meaningful.
    """
    if len(pages) < 3:
        return pages

    counts: Counter[str] = Counter()
    for page in pages:
        lines = [ln for ln in page.text.split("\n") if ln.strip()]
        edges = set(lines[:edge_lines] + lines[-edge_lines:])
        counts.update({_line_key(ln) for ln in edges})

    threshold = max(3, int(len(pages) * 0.6))
    repeated = {key for key, n in counts.items() if n >= threshold}
    if not repeated:
        return pages

    cleaned: list[Page] = []
    for page in pages:
        lines = page.text.split("\n")
        non_empty = [i for i, ln in enumerate(lines) if ln.strip()]
        edge_idx = set(non_empty[:edge_lines] + non_empty[-edge_lines:])
        kept = [
            ln for i, ln in enumerate(lines) if not (i in edge_idx and _line_key(ln) in repeated)
        ]
        cleaned.append(Page(page.number, "\n".join(kept).strip()))
    return cleaned


def clean_pages(pages: list[Page]) -> list[Page]:
    return strip_repeated_headers_footers([Page(p.number, normalize_text(p.text)) for p in pages])
