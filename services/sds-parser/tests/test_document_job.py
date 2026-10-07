"""Tests for the document_extract job (app/documents/job.py).

The handler runs against an in-memory client that applies ``.eq`` filters to
real rows, so tenant scoping and the ``status = 'processing'`` guards are
exercised, not just asserted on call shapes. PDF/OCR cases skip on a bare
interpreter like the other PDF tests.
"""

from __future__ import annotations

import importlib.util
import shutil
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
from unittest import mock

from app.documents import job as document_job
from app.documents.job import (
    BUCKET,
    DOCUMENT_EXTRACT_KIND,
    GAVE_UP_MESSAGE,
    NOT_A_PDF_MESSAGE,
    UNREADABLE_MESSAGE,
    record_failure,
    run_document_extract,
    validate_payload,
    verify_document,
)
from app.registry import get_registry
from app.service_jobs import (
    InvalidJobPayload,
    JobContext,
    JobNotFoundError,
    JobRegistry,
    LeaseLostError,
    PermanentJobError,
    ServiceJob,
    process_next_job,
)
from pdf_builders import scanned_pdf, text_layer_pdf

TENANT = "22222222-2222-2222-2222-222222222222"
OTHER_TENANT = "33333333-3333-3333-3333-333333333333"
DOC_ID = "44444444-4444-4444-4444-444444444444"
PATH = f"{TENANT}/{DOC_ID}.pdf"

FIXTURES = Path(__file__).parent / "fixtures"
MANIFEST_LINES = (FIXTURES / "manifest_sample.txt").read_text(encoding="utf-8").splitlines()

PDF_MODULES = ("pdfminer",)
OCR_MODULES = ("pdfminer", "pypdfium2", "pytesseract", "PIL")
PDF_AVAILABLE = all(importlib.util.find_spec(name) for name in PDF_MODULES)
OCR_AVAILABLE = shutil.which("tesseract") is not None and all(importlib.util.find_spec(n) for n in OCR_MODULES)


def make_job(attempts: int = 1, max_attempts: int = 3, tenant_id: Optional[str] = TENANT) -> ServiceJob:
    return ServiceJob(
        id="job-1", tenant_id=tenant_id, kind="document_extract",
        payload={"document_id": DOC_ID}, attempts=attempts, max_attempts=max_attempts,
    )


class FakeQuery:
    def __init__(self, client: "FakeClient", op: str, payload: Optional[dict] = None) -> None:
        self.client, self.op, self.payload, self.filters = client, op, payload, []

    def select(self, _columns: str) -> "FakeQuery":
        return self

    def eq(self, column: str, value) -> "FakeQuery":
        self.filters.append((column, value))
        return self

    def limit(self, _n: int) -> "FakeQuery":
        return self

    def execute(self):
        matched = [r for r in self.client.rows if all(r.get(k) == v for k, v in self.filters)]
        if self.op == "update":
            for row in matched:
                row.update(self.payload)
            self.client.updates.append((self.payload, list(self.filters)))
        return SimpleNamespace(data=[dict(r) for r in matched])


class FakeTable:
    def __init__(self, client: "FakeClient") -> None:
        self.client = client

    def select(self, columns: str) -> FakeQuery:
        return FakeQuery(self.client, "select").select(columns)

    def update(self, payload: dict) -> FakeQuery:
        return FakeQuery(self.client, "update", payload)


class FakeClient:
    """Holds ``document_extractions`` rows and one stored file."""

    def __init__(self, rows: list[dict], file_bytes=b"", download_error: Optional[Exception] = None) -> None:
        self.rows = rows
        self.updates: list[tuple] = []
        self.downloads: list[tuple] = []
        self._file_bytes = file_bytes
        self._download_error = download_error
        self.storage = SimpleNamespace(from_=self._bucket)

    def _bucket(self, name: str):
        def download(path: str) -> bytes:
            self.downloads.append((name, path))
            if self._download_error:
                raise self._download_error
            return self._file_bytes

        return SimpleNamespace(download=download)

    def table(self, name: str) -> FakeTable:
        assert name == "document_extractions", name
        return FakeTable(self)


def row(**overrides) -> dict:
    base = {"id": DOC_ID, "tenant_id": TENANT, "status": "processing", "storage_path": PATH}
    base.update(overrides)
    return base


class RecordingContext(JobContext):
    def __init__(self, job: ServiceJob) -> None:
        self.job = job
        self.beats: list[Optional[dict]] = []

    def heartbeat(self, progress: Optional[dict] = None) -> None:
        self.beats.append(progress)


class PayloadTests(unittest.TestCase):
    def test_a_uuid_is_accepted_and_normalized(self) -> None:
        self.assertEqual(validate_payload({"document_id": DOC_ID.upper()}), {"document_id": DOC_ID})

    def test_anything_else_is_rejected(self) -> None:
        for bad in ({}, {"document_id": None}, {"document_id": 7}, {"document_id": "../../etc/passwd"}, {"document_id": DOC_ID + "x"}):
            with self.subTest(bad):
                with self.assertRaises(InvalidJobPayload):
                    validate_payload(bad)

    def test_extra_keys_are_dropped(self) -> None:
        self.assertEqual(validate_payload({"document_id": DOC_ID, "storage_path": "x/y"}), {"document_id": DOC_ID})


class VerifyTests(unittest.TestCase):
    def test_the_tenants_own_document_passes(self) -> None:
        verify_document(FakeClient([row()]), TENANT, {"document_id": DOC_ID})

    def test_another_tenants_document_is_not_found(self) -> None:
        with self.assertRaises(JobNotFoundError):
            verify_document(FakeClient([row()]), OTHER_TENANT, {"document_id": DOC_ID})

    def test_a_missing_document_is_not_found(self) -> None:
        with self.assertRaises(JobNotFoundError):
            verify_document(FakeClient([]), TENANT, {"document_id": DOC_ID})


@unittest.skipUnless(PDF_AVAILABLE, "needs pdfminer.six")
class RunTests(unittest.TestCase):
    def run_job(self, client: FakeClient, job: Optional[ServiceJob] = None):
        job = job or make_job()
        ctx = RecordingContext(job)
        return run_document_extract(job, ctx, client=client), ctx

    def test_a_text_pdf_is_read_and_staged_for_review(self) -> None:
        client = FakeClient([row()], text_layer_pdf(MANIFEST_LINES))
        result, ctx = self.run_job(client)

        saved = client.rows[0]
        self.assertEqual(saved["status"], "needs_review")
        self.assertEqual(saved["doc_type"], "hazardous_waste_manifest")
        self.assertEqual(saved["overall_confidence"], "high")
        self.assertFalse(saved["via_ocr"])
        self.assertIsNone(saved["error"])
        self.assertIn("012345678JJK", [f["value"] for f in saved["extraction"]["fields"]])
        self.assertEqual(client.downloads, [(BUCKET, PATH)])
        self.assertEqual(result["doc_type"], "hazardous_waste_manifest")
        self.assertEqual([b["stage"] for b in ctx.beats], ["downloading", "reading", "saving"])

    def test_the_job_result_carries_counts_but_never_the_extracted_values(self) -> None:
        # service_jobs.result is readable by every tenant member.
        result, _ = self.run_job(FakeClient([row()], text_layer_pdf(MANIFEST_LINES)))
        self.assertEqual(set(result), {"document_id", "doc_type", "field_count", "overall_confidence"})

    def test_the_write_is_scoped_to_the_tenant_and_to_a_document_still_processing(self) -> None:
        client = FakeClient([row()], text_layer_pdf(MANIFEST_LINES))
        self.run_job(client)
        _, filters = client.updates[0]
        self.assertEqual(sorted(filters), sorted([("id", DOC_ID), ("tenant_id", TENANT), ("status", "processing")]))

    def test_a_duplicate_job_for_a_reviewed_document_changes_nothing(self) -> None:
        client = FakeClient([row(status="approved")], text_layer_pdf(MANIFEST_LINES))
        result, _ = self.run_job(client)
        self.assertEqual(result["skipped"], "already approved")
        self.assertEqual((client.downloads, client.updates), ([], []))

    def test_a_document_that_changed_while_being_read_is_not_overwritten(self) -> None:
        client = FakeClient([row()], text_layer_pdf(MANIFEST_LINES))
        original_execute = FakeQuery.execute

        def flip_status_then_execute(query):
            if query.op == "update":
                client.rows[0]["status"] = "rejected"  # the user deleted/rejected it meanwhile
            return original_execute(query)

        with mock.patch.object(FakeQuery, "execute", flip_status_then_execute):
            with self.assertLogs("app.documents.job", level="WARNING"):
                result, _ = self.run_job(client)
        self.assertEqual(result["skipped"], "record changed")
        self.assertEqual(client.rows[0]["status"], "rejected")

    def test_another_tenants_job_cannot_read_this_document(self) -> None:
        client = FakeClient([row()], text_layer_pdf(MANIFEST_LINES))
        with self.assertRaises(PermanentJobError):
            self.run_job(client, make_job(tenant_id=OTHER_TENANT))
        self.assertEqual(client.downloads, [])

    def test_a_deleted_record_fails_permanently(self) -> None:
        with self.assertRaisesRegex(PermanentJobError, "no longer exists"):
            self.run_job(FakeClient([]))

    def test_a_file_that_is_not_a_pdf_fails_permanently_with_a_plain_message(self) -> None:
        client = FakeClient([row()], b"PK\x03\x04 this is a zip")
        with self.assertRaises(PermanentJobError) as caught:
            self.run_job(client)
        self.assertEqual(str(caught.exception), NOT_A_PDF_MESSAGE)

    def test_a_corrupt_pdf_fails_permanently_without_leaking_parser_errors(self) -> None:
        client = FakeClient([row()], b"%PDF-1.4\nnot really a pdf\n")
        with self.assertLogs("app.documents.job", level="WARNING"):
            with self.assertRaises(PermanentJobError) as caught:
                self.run_job(client)
        self.assertEqual(str(caught.exception), UNREADABLE_MESSAGE)

    def test_a_storage_failure_is_transient_so_the_job_is_retried(self) -> None:
        client = FakeClient([row()], download_error=ConnectionError("storage timed out"))
        with self.assertRaises(ConnectionError):
            self.run_job(client)
        self.assertEqual(client.rows[0]["status"], "processing")

    def test_losing_the_lease_stops_the_job_before_saving(self) -> None:
        client = FakeClient([row()], text_layer_pdf(MANIFEST_LINES))
        job = make_job()
        store = SimpleNamespace(heartbeat=lambda j, p: False)
        with self.assertRaises(LeaseLostError):
            run_document_extract(job, JobContext(job, store), client=client)
        self.assertEqual(client.rows[0]["status"], "processing")


@unittest.skipUnless(OCR_AVAILABLE, "needs tesseract + PDF/OCR Python packages")
class ScannedDocumentTests(unittest.TestCase):
    def test_a_scan_is_read_by_ocr_flagged_low_confidence_and_reports_each_page(self) -> None:
        client = FakeClient([row()], scanned_pdf(MANIFEST_LINES, lines_per_page=len(MANIFEST_LINES) // 2 + 1))
        job = make_job()
        ctx = RecordingContext(job)
        run_document_extract(job, ctx, client=client)

        saved = client.rows[0]
        self.assertEqual(saved["status"], "needs_review")
        self.assertTrue(saved["via_ocr"])
        # Scanned text is never trusted: even an exact read is only a proposal.
        self.assertEqual(saved["overall_confidence"], "low")
        self.assertEqual(saved["doc_type"], "hazardous_waste_manifest")
        pages = [b for b in ctx.beats if b and b["stage"] == "ocr"]
        self.assertEqual([(b["page"], b["pages"]) for b in pages], [(1, 2), (2, 2)])

    def test_losing_the_lease_mid_scan_abandons_the_remaining_pages(self) -> None:
        client = FakeClient([row()], scanned_pdf(MANIFEST_LINES, lines_per_page=len(MANIFEST_LINES) // 2 + 1))
        job = make_job()
        calls = []

        def heartbeat(_job, progress):
            calls.append(progress)
            return not (progress and progress.get("stage") == "ocr")  # lost during the first page

        with self.assertRaises(LeaseLostError):
            run_document_extract(job, JobContext(job, SimpleNamespace(heartbeat=heartbeat)), client=client)
        self.assertEqual([c["page"] for c in calls if c.get("stage") == "ocr"], [1])
        self.assertEqual(client.rows[0]["status"], "processing")


class RecordFailureTests(unittest.TestCase):
    def test_a_permanent_message_is_shown_as_written(self) -> None:
        client = FakeClient([row()])
        record_failure(client, make_job(), NOT_A_PDF_MESSAGE, permanent=True)
        self.assertEqual((client.rows[0]["status"], client.rows[0]["error"]), ("failed", NOT_A_PDF_MESSAGE))

    def test_a_give_up_shows_a_fixed_message_not_the_exception_text(self) -> None:
        client = FakeClient([row()])
        record_failure(client, make_job(), "Gave up after 3 attempts: connection to 10.0.0.5 refused", permanent=False)
        self.assertEqual(client.rows[0]["error"], GAVE_UP_MESSAGE)

    def test_it_never_touches_a_document_that_is_no_longer_processing(self) -> None:
        client = FakeClient([row(status="needs_review")])
        record_failure(client, make_job(), "x", permanent=True)
        self.assertEqual(client.rows[0]["status"], "needs_review")

    def test_it_never_touches_another_tenants_document(self) -> None:
        client = FakeClient([row()])
        record_failure(client, make_job(tenant_id=OTHER_TENANT), "x", permanent=True)
        self.assertEqual(client.rows[0]["status"], "processing")


class RegisteredKindTests(unittest.TestCase):
    def test_the_service_registers_the_kind(self) -> None:
        self.assertEqual(get_registry().names(), ["document_extract"])

    def test_a_job_that_can_never_succeed_ends_failed_for_the_user_too(self) -> None:
        client = FakeClient([row()], b"not a pdf at all")
        store = _FakeJobStore([make_job()])
        registry = JobRegistry()
        registry.register(DOCUMENT_EXTRACT_KIND)
        with mock.patch.object(document_job, "open_client", return_value=client):
            process_next_job(store, registry)
        self.assertEqual(store.outcomes[0][0], "failed")
        self.assertEqual((client.rows[0]["status"], client.rows[0]["error"]), ("failed", NOT_A_PDF_MESSAGE))

    def test_a_job_that_runs_out_of_retries_ends_failed_for_the_user_too(self) -> None:
        client = FakeClient([row()], download_error=ConnectionError("db at 10.0.0.5 unreachable"))
        store = _FakeJobStore([make_job(attempts=3, max_attempts=3)])
        registry = JobRegistry()
        registry.register(DOCUMENT_EXTRACT_KIND)
        with mock.patch.object(document_job, "open_client", return_value=client):
            with self.assertLogs("app.service_jobs", level="ERROR"):
                process_next_job(store, registry)
        self.assertEqual(client.rows[0]["status"], "failed")
        self.assertEqual(client.rows[0]["error"], GAVE_UP_MESSAGE)

    def test_a_retry_leaves_the_document_waiting(self) -> None:
        client = FakeClient([row()], download_error=ConnectionError("blip"))
        store = _FakeJobStore([make_job(attempts=1)])
        registry = JobRegistry()
        registry.register(DOCUMENT_EXTRACT_KIND)
        with mock.patch.object(document_job, "open_client", return_value=client):
            with self.assertLogs("app.service_jobs", level="ERROR"):
                process_next_job(store, registry)
        self.assertEqual(store.outcomes[0][0], "requeued")
        self.assertEqual(client.rows[0]["status"], "processing")


class _FakeJobStore:
    def __init__(self, jobs: list[ServiceJob]) -> None:
        self.pending = list(jobs)
        self.outcomes: list[tuple] = []

    def claim(self, kinds):
        return self.pending.pop(0) if self.pending else None

    def heartbeat(self, job, progress):
        return True

    def succeed(self, job, result):
        self.outcomes.append(("succeeded", result))

    def requeue(self, job, error):
        self.outcomes.append(("requeued", error))

    def fail(self, job, error):
        self.outcomes.append(("failed", error))
        return True


if __name__ == "__main__":
    unittest.main()
