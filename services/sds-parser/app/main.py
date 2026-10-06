"""FastAPI service exposing the deterministic SDS parser.

Endpoints
---------
GET  /health        liveness probe
POST /parse/text    parse already-extracted SDS text          {text}
POST /parse/file    parse an uploaded SDS PDF                  multipart "file"
POST /parse/url     fetch + parse an SDS PDF by URL            {url}
POST /parse/stage   download an SDS from Supabase, parse it,   {sds_id, tenant_id,
                    and write it to the review queue            product_id?}
POST /jobs/parse-sds queue the same work as /parse/stage for    {sds_id, tenant_id,
                    the background worker; returns 202 at once   requested_by?}

All /parse* responses are a ParsedSdsPayload (the exact shape the web app's AI
parser produces). /parse/stage additionally writes parsed_payload +
parse_review_status='pending' to chemical_sds_documents.

Background jobs (OCR of a long scan can take minutes) are off unless
SDS_PARSE_JOBS_ENABLED=true; they need migration 294 and the Supabase vars.

Auth: if SDS_PARSER_API_KEY is set, every request must send a matching
``X-API-Key`` header. Leave it unset only for local development.
"""

from __future__ import annotations

import hmac
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .jobs import Job, JobNotFoundError, JobStore, JobWorker, SupabaseJobStore
from .parser import parse_sds_text
from .pdf_text import PdfTextError
from .pipeline import parse_sds_pdf
from .schema import (
    EnqueueParseJobRequest,
    ParsedSdsPayload,
    ParseJobResponse,
    ParseStageRequest,
    ParseTextRequest,
    ParseUrlRequest,
)


def jobs_enabled() -> bool:
    return os.environ.get("SDS_PARSE_JOBS_ENABLED", "").lower() == "true"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # One worker per process. Claims use SKIP LOCKED, so running more replicas
    # (or uvicorn workers) only adds throughput, never double-processing.
    worker = _start_job_worker() if jobs_enabled() else None
    try:
        yield
    finally:
        if worker:
            worker.stop()


def _start_job_worker() -> JobWorker:
    from .staging import service_client  # lazy: optional dependency
    worker = JobWorker(SupabaseJobStore(service_client()), _run_parse_job)
    worker.start()
    return worker


def _run_parse_job(job: Job) -> None:
    from .staging import parse_and_stage
    parse_and_stage(job.sds_id, job.tenant_id)


app = FastAPI(
    title="SDS Parser (non-AI fallback)",
    version="1.0.0",
    description=(
        "Deterministic Safety Data Sheet parser. A provider-independent "
        "fallback for the AI SDS parse — emits the same ParsedSdsPayload shape "
        "and stages into the same review queue. Confidence is capped at "
        "'medium'; a human reviews every parse."
    ),
    lifespan=lifespan,
)

MAX_PDF_BYTES = 25_000_000  # matches the web app's parse route cap


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Constant-time shared-secret check. No-op when SDS_PARSER_API_KEY unset."""
    expected = os.environ.get("SDS_PARSER_API_KEY")
    if not expected:
        return
    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


def _parse_pdf_bytes(data: bytes) -> dict:
    """Extract text (OCR for scans) and parse it; unreadable PDFs become a 422."""
    try:
        return parse_sds_pdf(data)
    except PdfTextError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/parse/text", response_model=ParsedSdsPayload, dependencies=[Depends(require_api_key)])
def parse_text(body: ParseTextRequest) -> dict:
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
    return parse_sds_text(body.text)


@app.post("/parse/file", response_model=ParsedSdsPayload, dependencies=[Depends(require_api_key)])
async def parse_file(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail=f"PDF exceeds {MAX_PDF_BYTES // 1_000_000} MB")
    return _parse_pdf_bytes(data)


@app.post("/parse/url", response_model=ParsedSdsPayload, dependencies=[Depends(require_api_key)])
async def parse_url(body: ParseUrlRequest) -> dict:
    import httpx  # lazy
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(body.url)
            resp.raise_for_status()
            data = resp.content
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch PDF: {exc}") from exc
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail=f"PDF exceeds {MAX_PDF_BYTES // 1_000_000} MB")
    return _parse_pdf_bytes(data)


@app.post("/parse/stage", dependencies=[Depends(require_api_key)])
def parse_stage(body: ParseStageRequest) -> JSONResponse:
    # Import here so the service still boots for /parse* when supabase isn't
    # installed / configured.
    from .staging import StagingError, parse_and_stage
    try:
        staged, parsed = parse_and_stage(body.sds_id, body.tenant_id, body.product_id)
    except StagingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PdfTextError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return JSONResponse({"staged": staged, "parsed": parsed})


def get_job_store() -> JobStore:
    """The job store, or a 503 when jobs are off — the web app then parses synchronously."""
    if not jobs_enabled():
        raise HTTPException(
            status_code=503,
            detail="Background parse jobs are disabled (set SDS_PARSE_JOBS_ENABLED=true).",
        )
    from .staging import StagingError, service_client
    try:
        return SupabaseJobStore(service_client())
    except StagingError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post(
    "/jobs/parse-sds",
    status_code=202,
    response_model=ParseJobResponse,
    dependencies=[Depends(require_api_key)],
)
def enqueue_parse_job(body: EnqueueParseJobRequest, store: JobStore = Depends(get_job_store)) -> dict:
    requested_by = str(body.requested_by) if body.requested_by else None
    try:
        job = store.enqueue(str(body.sds_id), str(body.tenant_id), requested_by)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"job_id": job.id, "status": job.status}
