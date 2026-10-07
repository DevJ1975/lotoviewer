"""The ``document_extract`` job: read an uploaded PDF and stage what was found.

The web app uploads a permit, manifest or SWPPP to the private
``environmental-docs`` bucket, inserts a ``document_extractions`` row in status
``processing`` (migration 296) and enqueues this job. The worker downloads the
file, reads its text (OCR for scans), extracts the fields, and moves the row to
``needs_review``. Nothing is filed from here: a person approves what was found.

Every query is scoped by ``tenant_id`` because the service-role key bypasses RLS.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from ..pdf_text import PdfTextError, extract_text_from_pdf
from ..service_jobs import (
    InvalidJobPayload,
    JobContext,
    JobKind,
    JobNotFoundError,
    PermanentJobError,
    ServiceJob,
)
from .extract import extract_document

logger = logging.getLogger(__name__)

KIND_NAME = "document_extract"
TABLE = "document_extractions"
BUCKET = "environmental-docs"
PROCESSING = "processing"

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

# What a user sees. Exception text stays in the service log and the job row.
UNREADABLE_MESSAGE = (
    "We couldn't read any text from this PDF. If it is a scan, make sure it is sharp "
    "and upright, then upload it again."
)
NOT_A_PDF_MESSAGE = "This file isn't a readable PDF. Upload the PDF again."
GAVE_UP_MESSAGE = "We couldn't finish reading this document. Please try again later or upload it again."


def open_client() -> Any:
    from ..staging import service_client  # lazy: needs the web stack's optional dependencies

    return service_client()


def validate_payload(payload: dict) -> dict:
    document_id = payload.get("document_id")
    if not isinstance(document_id, str) or not _UUID_RE.match(document_id):
        raise InvalidJobPayload("document_extract needs a document_id (uuid)")
    return {"document_id": document_id.lower()}


def verify_document(client: Any, tenant_id: Optional[str], payload: dict) -> None:
    """Reject at the request, not later on the worker, a document that is not this tenant's."""
    res = (
        client.table(TABLE).select("id")
        .eq("id", payload["document_id"]).eq("tenant_id", tenant_id)
        .limit(1).execute()
    )
    if not res.data:
        raise JobNotFoundError("document not found for this tenant")


def run_document_extract(job: ServiceJob, ctx: JobContext, *, client: Any) -> dict:
    document_id = job.payload["document_id"]
    row = _load_row(client, job.tenant_id, document_id)
    if row is None:
        raise PermanentJobError("The document record no longer exists.")
    if row["status"] != PROCESSING:
        # A duplicate or retried job for a document already read (or reviewed).
        return {"document_id": document_id, "skipped": f"already {row['status']}"}

    ctx.heartbeat({"stage": "downloading"})
    data = client.storage.from_(BUCKET).download(row["storage_path"])
    if not data.startswith(b"%PDF-"):
        raise PermanentJobError(NOT_A_PDF_MESSAGE)

    ctx.heartbeat({"stage": "reading"})
    try:
        text = extract_text_from_pdf(
            data,
            subject="an environmental document",
            on_ocr_page=lambda done, total: ctx.heartbeat({"stage": "ocr", "page": done, "pages": total}),
        )
    except PdfTextError as exc:
        logger.warning("document %s is unreadable: %s", document_id, exc)
        raise PermanentJobError(UNREADABLE_MESSAGE) from exc

    result = extract_document(text.text, via_ocr=text.via_ocr, pages_skipped=text.pages_skipped)
    ctx.heartbeat({"stage": "saving"})

    saved = (
        client.table(TABLE)
        .update({
            "status": "needs_review",
            "doc_type": result["doc_type"],
            "doc_type_confidence": result["doc_type_confidence"],
            "overall_confidence": result["overall_confidence"],
            "via_ocr": result["via_ocr"],
            "extraction": result,
            "error": None,
        })
        .eq("id", document_id).eq("tenant_id", job.tenant_id).eq("status", PROCESSING)
        .execute()
    )
    if not saved.data:
        logger.warning("document %s changed while it was being read; result discarded", document_id)
        return {"document_id": document_id, "skipped": "record changed"}
    return {
        "document_id": document_id,
        "doc_type": result["doc_type"],
        "field_count": len(result["fields"]),
        "overall_confidence": result["overall_confidence"],
    }


def record_failure(client: Any, job: ServiceJob, message: str, *, permanent: bool) -> None:
    """Move a still-processing document to ``failed`` so the user is not left waiting.

    Only a message the handler authored (``permanent``) reaches the user; a
    give-up after retries carries raw exception text, so it gets a fixed one.
    """
    (
        client.table(TABLE)
        .update({"status": "failed", "error": message if permanent else GAVE_UP_MESSAGE})
        .eq("id", job.payload["document_id"]).eq("tenant_id", job.tenant_id).eq("status", PROCESSING)
        .execute()
    )


def _load_row(client: Any, tenant_id: Optional[str], document_id: str) -> Optional[dict]:
    res = (
        client.table(TABLE).select("id,status,storage_path")
        .eq("id", document_id).eq("tenant_id", tenant_id)
        .limit(1).execute()
    )
    return res.data[0] if res.data else None


DOCUMENT_EXTRACT_KIND = JobKind(
    name=KIND_NAME,
    handler=lambda job, ctx: run_document_extract(job, ctx, client=open_client()),
    tenant_scoped=True,
    validate=validate_payload,
    verify=verify_document,
    on_failed=lambda job, message, *, permanent: record_failure(
        open_client(), job, message, permanent=permanent,
    ),
)
