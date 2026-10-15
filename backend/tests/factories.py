"""Build real PDF/DOCX/TXT files in memory for tests."""

import io

import openpyxl
import pymupdf
from docx import Document as DocxDocument
from docx.enum.text import WD_BREAK


def make_pdf(pages: list[str], header: str | None = None, footer: str | None = None) -> bytes:
    pdf = pymupdf.open()
    for i, body in enumerate(pages, start=1):
        page = pdf.new_page()
        y = 50
        if header:
            page.insert_text((72, y), header, fontsize=9)
            y += 30
        page.insert_textbox(pymupdf.Rect(72, y, 540, 740), body, fontsize=11)
        if footer:
            page.insert_text((72, 800), footer.format(page=i, total=len(pages)), fontsize=9)
    data = pdf.tobytes()
    pdf.close()
    return data


def make_blank_pdf(n_pages: int = 2) -> bytes:
    pdf = pymupdf.open()
    for _ in range(n_pages):
        pdf.new_page()
    data = pdf.tobytes()
    pdf.close()
    return data


def make_docx(pages: list[list[str]], table: list[list[str]] | None = None) -> bytes:
    """Each inner list is the paragraphs of one page; pages are joined by hard breaks."""
    doc = DocxDocument()
    for i, paragraphs in enumerate(pages):
        for text in paragraphs:
            doc.add_paragraph(text)
        if i < len(pages) - 1:
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    if table:
        t = doc.add_table(rows=len(table), cols=len(table[0]))
        for r, row in enumerate(table):
            for c, value in enumerate(row):
                t.cell(r, c).text = value
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def make_xlsx(sheets: dict[str, list[list[object]]]) -> bytes:
    """{sheet title: rows} -> .xlsx bytes."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for title, rows in sheets.items():
        ws = wb.create_sheet(title)
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
