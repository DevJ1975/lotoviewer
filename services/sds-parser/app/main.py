"""FastAPI service exposing the deterministic SDS parser.

Endpoints
---------
GET  /health        liveness probe
POST /parse/text    parse already-extracted SDS text          {text}
POST /parse/file    parse an uploaded SDS PDF                  multipart "file"
POST /parse/url     fetch + parse an SDS PDF by URL            {url}
POST /parse/stage   download an SDS from Supabase, parse it,   {sds_id, tenant_id,
                    and write it to the review queue            product_id?}

All /parse* responses are a ParsedSdsPayload (the exact shape the web app's AI
parser produces). /parse/stage additionally writes parsed_payload +
parse_review_status='pending' to chemical_sds_documents.

Auth: if SDS_PARSER_API_KEY is set, every request must send a matching
``X-API-Key`` header. Leave it unset only for local development.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .parser import parse_sds_text
from .pdf_text import PdfTextError, extract_text_from_pdf
from .schema import ParsedSdsPayload, ParseStageRequest, ParseTextRequest, ParseUrlRequest

app = FastAPI(
    title="SDS Parser (non-AI fallback)",
    version="1.0.0",
    description=(
        "Deterministic Safety Data Sheet parser. A provider-independent "
        "fallback for the AI SDS parse — emits the same ParsedSdsPayload shape "
        "and stages into the same review queue. Confidence is capped at "
        "'medium'; a human reviews every parse."
    ),
)

MAX_PDF_BYTES = 25_000_000  # matches the web app's parse route cap


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Constant-time shared-secret check. No-op when SDS_PARSER_API_KEY unset."""
    expected = os.environ.get("SDS_PARSER_API_KEY")
    if not expected:
        return
    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


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
    try:
        text = extract_text_from_pdf(data)
    except PdfTextError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return parse_sds_text(text)


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
    try:
        text = extract_text_from_pdf(data)
    except PdfTextError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return parse_sds_text(text)


@app.post("/parse/stage", dependencies=[Depends(require_api_key)])
def parse_stage(body: ParseStageRequest) -> JSONResponse:
    # Import here so the service still boots for /parse* when supabase isn't
    # installed / configured.
    from .staging import StagingError, download_sds, stage_parsed
    try:
        data = download_sds(body.sds_id, body.tenant_id, body.product_id)
    except StagingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        text = extract_text_from_pdf(data)
    except PdfTextError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    parsed = parse_sds_text(text)
    try:
        staged = stage_parsed(body.sds_id, body.tenant_id, parsed)
    except StagingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return JSONResponse({"staged": staged, "parsed": parsed})
