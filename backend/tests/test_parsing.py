import pytest

from services.parsing import (
    Page,
    ParsingError,
    normalize_text,
    parse_file,
    strip_repeated_headers_footers,
)
from tests.factories import make_blank_pdf, make_docx, make_pdf


def write(tmp_path, name: str, data: bytes):
    path = tmp_path / name
    path.write_bytes(data)
    return path


def test_pdf_pages_keep_numbers_and_drop_repeated_header_footer(tmp_path):
    topics = ["photosynthesis in plants", "cell respiration", "plate tectonics", "ocean tides"]
    bodies = [
        f"This section introduces {t}.\nIt explains the key ideas in detail.\nSummary of {t}."
        for t in topics
    ]
    path = write(
        tmp_path,
        "a.pdf",
        make_pdf(bodies, header="ACME Corp Confidential", footer="Page {page} of {total}"),
    )
    pages = parse_file(path, "pdf")

    assert [p.number for p in pages] == [1, 2, 3, 4]
    assert "This section introduces plate tectonics." in pages[2].text
    assert "It explains the key ideas in detail." in pages[2].text
    for p in pages:
        assert "ACME Corp" not in p.text
        assert "of 4" not in p.text


def test_pdf_without_text_fails_with_clear_message(tmp_path):
    path = write(tmp_path, "scan.pdf", make_blank_pdf())
    with pytest.raises(ParsingError, match="No extractable text"):
        parse_file(path, "pdf")


def test_corrupt_pdf_raises_parsing_error(tmp_path):
    path = write(tmp_path, "bad.pdf", b"%PDF-1.4 this is not really a pdf")
    with pytest.raises(ParsingError):
        parse_file(path, "pdf")


def test_docx_splits_on_page_breaks_and_reads_tables(tmp_path):
    data = make_docx(
        [["First page intro.", "More on page one."], ["Second page content."]],
        table=[["Name", "Score"], ["Alice", "42"]],
    )
    pages = parse_file(write(tmp_path, "a.docx", data), "docx")

    assert len(pages) == 2
    assert "First page intro." in pages[0].text
    assert "Second page content." in pages[1].text
    assert "Alice | 42" in pages[1].text


def test_txt_form_feed_pages_and_bad_bytes(tmp_path):
    data = "page one text\fpage two text \xff".encode("latin-1")
    pages = parse_file(write(tmp_path, "a.txt", data), "txt")
    assert [p.text for p in pages][0] == "page one text"
    assert pages[1].text.startswith("page two text")


def test_normalize_text():
    raw = "Hello   world\r\n\n\n\nThis is a hyph-\nenated word.\x00"
    assert normalize_text(raw) == "Hello world\n\nThis is a hyphenated word."


def test_header_stripping_ignores_short_documents():
    pages = [Page(1, "Header\nbody one"), Page(2, "Header\nbody two")]
    assert strip_repeated_headers_footers(pages) == pages
