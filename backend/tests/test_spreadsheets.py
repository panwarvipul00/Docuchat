"""Excel (.xlsx) and CSV: parsing, chunking, upload validation, ingestion."""

import datetime as dt

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.documents.models import Document
from services.chunking import chunk_pages, count_tokens
from services.ingestion import ingest_document
from services.parsing import Page, ParsingError, parse_file
from tests.factories import make_xlsx

STAFF = [
    ["Name", "Department", "Salary", "Joined", "Notes"],
    ["Rahul", "Sales", 50000.0, dt.datetime(2023, 4, 1), None],
    [None, None, None, None, None],  # empty rows are skipped
    ["Priya", "Engineering", 72000.5, dt.datetime(2022, 1, 15, 9, 30), "Team lead.\nRemote"],
]


def write(tmp_path, name: str, data: bytes):
    path = tmp_path / name
    path.write_bytes(data)
    return path


# ---------- parsing ----------


def test_xlsx_rows_become_header_value_records_one_page_per_sheet(tmp_path):
    path = write(
        tmp_path,
        "hr.xlsx",
        make_xlsx({"Staff": STAFF, "Offices": [["City", "Phone"], ["Pune", "020-555"]]}),
    )
    pages = parse_file(path, "xlsx")

    assert [(p.number, p.heading, p.records) for p in pages] == [
        (1, 'Sheet "Staff"', True),
        (2, 'Sheet "Offices"', True),
    ]
    assert pages[0].text.split("\n\n") == [
        "Name: Rahul | Department: Sales | Salary: 50000 | Joined: 2023-04-01",
        "Name: Priya | Department: Engineering | Salary: 72000.5 "
        "| Joined: 2022-01-15 09:30 | Notes: Team lead. Remote",
    ]
    assert pages[1].text == "City: Pune | Phone: 020-555"


def test_xlsx_blank_header_cells_use_column_letters(tmp_path):
    path = write(tmp_path, "a.xlsx", make_xlsx({"S": [["Item", None], ["Pen", "blue"]]}))
    assert parse_file(path, "xlsx")[0].text == "Item: Pen | Column B: blue"


def test_csv_detects_semicolons_and_strips_excel_bom(tmp_path):
    data = "﻿Name;City\nRahul;Pune\nAsha;Delhi\n".encode()
    [page] = parse_file(write(tmp_path, "a.csv", data), "csv")
    assert page.text == "Name: Rahul | City: Pune\n\nName: Asha | City: Delhi"
    assert page.records and page.heading == ""


def test_csv_quoted_commas_stay_in_one_cell(tmp_path):
    data = b'Company,Address\n"Acme, Inc.","12 Main St, Pune"\n'
    [page] = parse_file(write(tmp_path, "a.csv", data), "csv")
    assert page.text == "Company: Acme, Inc. | Address: 12 Main St, Pune"


def test_header_only_spreadsheet_fails_clearly(tmp_path):
    path = write(tmp_path, "a.xlsx", make_xlsx({"S": [["Name", "City"]]}))
    with pytest.raises(ParsingError, match="no data rows"):
        parse_file(path, "xlsx")


def test_row_cap_applies_across_sheets(tmp_path, settings):
    settings.MAX_SPREADSHEET_ROWS = 3
    rows = [["n"], [1], [2]]
    path = write(tmp_path, "a.xlsx", make_xlsx({"A": rows, "B": rows}))  # 4 data rows
    with pytest.raises(ParsingError, match="more than 3 rows"):
        parse_file(path, "xlsx")


def test_corrupt_xlsx_fails_clearly(tmp_path):
    path = write(tmp_path, "a.xlsx", b"PK\x03\x04 not really a workbook")
    with pytest.raises(ParsingError, match="Could not read XLSX"):
        parse_file(path, "xlsx")


# ---------- chunking ----------


def test_record_chunks_keep_rows_whole_and_repeat_sheet_name():
    rows = [f"Name: Person {i} | Note: Paid late. Follow up next week." for i in range(60)]
    page = Page(2, "\n\n".join(rows), records=True, heading='Sheet "Dues"')
    chunks = chunk_pages([page], max_tokens=120, overlap_tokens=20)

    assert len(chunks) > 1
    for c in chunks:
        assert c.page_number == 2
        assert c.token_count <= 120 and c.token_count == count_tokens(c.content)
        heading, *lines = c.content.split("\n")
        assert heading == 'Sheet "Dues"'
        assert all(line in rows for line in lines)  # never cut at the "." inside a cell
    covered = {line for c in chunks for line in c.content.split("\n")[1:]}
    assert covered == set(rows)


# ---------- upload + ingestion ----------


def upload(client, workspace_id, name, data):
    return client.post(
        f"/api/workspaces/{workspace_id}/documents/",
        {"file": SimpleUploadedFile(name, data)},
        format="multipart",
    )


@pytest.mark.django_db
def test_upload_accepts_xlsx_and_csv(auth_client, workspace):
    res = upload(auth_client, workspace.id, "Staff List.xlsx", make_xlsx({"Staff": STAFF}))
    assert res.status_code == 201 and res.data["file_type"] == "xlsx"
    assert res.data["title"] == "Staff List"
    res = upload(auth_client, workspace.id, "people.csv", b"Name,City\nRahul,Pune\n")
    assert res.status_code == 201 and res.data["file_type"] == "csv"


@pytest.mark.django_db
def test_upload_rejects_old_xls_with_hint(auth_client, workspace):
    res = upload(auth_client, workspace.id, "old.xls", b"\xd0\xcf\x11\xe0legacy")
    assert res.status_code == 400
    assert "Save As" in str(res.data["file"])


@pytest.mark.django_db
def test_upload_rejects_binary_renamed_to_csv(auth_client, workspace):
    res = upload(auth_client, workspace.id, "x.csv", b"\x00\x01\x02binary")
    assert res.status_code == 400


@pytest.mark.django_db
def test_xlsx_ingestion_end_to_end(auth_client, workspace):
    res = upload(
        auth_client, workspace.id, "hr.xlsx", make_xlsx({"Staff": STAFF, "X": [["a"], [1]]})
    )
    ingest_document(res.data["id"])  # on_commit doesn't fire inside the test transaction

    doc = Document.objects.get(pk=res.data["id"])
    assert doc.status == Document.Status.READY, doc.error_message
    assert doc.page_count == 2  # sheets
    first = doc.chunks.order_by("chunk_index").first()
    assert first.page_number == 1
    assert first.content.startswith('Sheet "Staff"\nName: Rahul | Department: Sales')
