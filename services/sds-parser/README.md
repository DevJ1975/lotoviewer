# SDS Parser — non-AI fallback

A standalone **FastAPI** service that extracts a manufacturer Safety Data Sheet
(SDS) into the **exact `ParsedSdsPayload` shape** the web app's AI parser
produces (`packages/core/src/chemicals.ts`), using **deterministic heuristics
instead of an LLM**.

## Why this exists

The in-app SDS parse (`/api/chemicals/products/[id]/sds/[sdsId]/parse`) calls
Anthropic. When that's unavailable — e.g. the account hits its **monthly usage
limit** (`"You have reached your specified API usage limits…"`) — parsing is
blocked until the cap resets. That limit is enforced on Anthropic's servers and
**cannot be bypassed** by any proxy. This service is the legitimate alternative:
a provider-independent parser that keeps SDS intake moving during an outage or
cap, feeding the **same human review queue**.

It is **not** a replacement for the AI parse. Heuristic extraction is less
capable than an LLM, so its overall confidence is intentionally **capped at
`medium`** — every parse lands in the review queue (`parse_review_status =
'pending'`) for a person to confirm before any field reaches a product record.

## What it extracts

All 37 `ParsedSdsPayload` fields across the standard 16-section GHS layout:
identification, CAS numbers (with check-digit validation), GHS signal word +
pictograms (inferred from text labels), H/P-code statements, physical
properties (with °F→°C and mmHg→kPa conversion), exposure limits + PPE, first
aid, firefighting, spill cleanup, storage, incompatibilities, DOT transport,
NFPA 704 ratings, and the revision date. Anything not found is `null`/`[]` —
it never guesses.

### Scanned SDSs (OCR)

Most SDS PDFs carry a *text layer*, which is read directly. A scanned /
image-only SDS has none, so the service renders each page (PDFium, via
`pypdfium2`) and reads it with **Tesseract** OCR — up to the first 30 pages.
Because OCR can misread digits (flash points, exposure limits, UN numbers), an
OCR'd parse is marked **`overall: "low"`** confidence and its `parser_notes`
tell the reviewer to check every number against the original. A scan that
yields too little text to be an SDS (blank, faint, or not an SDS) returns a
clear 422.

> **Limitation:** GHS pictograms that exist only as images are not captured,
> and OCR is English-only.

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/health` | — | `{"status":"ok"}` |
| POST | `/parse/text` | `{"text": "...SDS text..."}` | `ParsedSdsPayload` |
| POST | `/parse/file` | multipart `file=@sds.pdf` | `ParsedSdsPayload` |
| POST | `/parse/url` | `{"url": "https://.../sds.pdf"}` | `ParsedSdsPayload` |
| POST | `/parse/stage` | `{"sds_id","tenant_id","product_id?"}` | `{staged, parsed}` |
| POST | `/jobs/parse-sds` | `{"sds_id","tenant_id","requested_by?"}` | `202 {job_id, status}` |

`/parse/stage` downloads the SDS from the Supabase `chemical-sds` bucket and
writes the parse back to `chemical_sds_documents` (`parsed_payload`,
`parse_model='python-sds-parser@1'`, `parse_confidence`,
`parse_review_status='pending'`) — exactly like the AI route — so it appears in
**SDS Review Queue** (`/chemicals/review`) for approval.

### Background jobs

OCR of a long scanned SDS can take minutes — longer than the web app's
serverless routes can wait. So when background jobs are on, the web app queues
the parse with `POST /jobs/parse-sds` and answers the user at once; a worker
thread in this service claims the job, parses the PDF (OCR if needed) and
stages it into the review queue exactly like `/parse/stage`.

* **Durable.** The queue is the `sds_parse_jobs` table (migration 294), not
  memory. A job whose worker dies is taken over once its lease lapses.
* **Safe to scale.** Claims go through `claim_sds_parse_job()`, which uses
  `FOR UPDATE SKIP LOCKED`, so extra replicas add throughput and never
  double-process. A worker that lost its lease cannot overwrite the result of
  the worker that took over.
* **Bounded retries.** An unreadable PDF fails at once; a transient error
  (storage, network) retries with backoff, up to 3 attempts.
* **Idempotent.** Re-queuing an SDS that already has a live job returns that job.

To turn it on: apply migration 294, set the Supabase vars, and set
`SDS_PARSE_JOBS_ENABLED=true`. With it off, `/jobs/parse-sds` answers 503 and
the web app falls back to parsing synchronously.

## Run it

```bash
cd services/sds-parser
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
sudo apt-get install tesseract-ocr   # macOS: brew install tesseract — only needed for scanned PDFs
cp .env.example .env            # set SDS_PARSER_API_KEY (and Supabase vars for /stage)
uvicorn app.main:app --reload   # http://localhost:8000/docs
```

Quick check (no DB needed):

```bash
curl -s -X POST localhost:8000/parse/file -F file=@/path/to/sds.pdf | jq .product_name
```

Stage into the review queue (requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`):

```bash
curl -s -X POST localhost:8000/parse/stage \
  -H 'content-type: application/json' -H "x-api-key: $SDS_PARSER_API_KEY" \
  -d '{"sds_id":"<uuid>","tenant_id":"<uuid>"}'
```

Docker:

```bash
docker build -t sds-parser services/sds-parser
docker run -p 8000:8000 --env-file services/sds-parser/.env sds-parser
```

## Configuration

| Var | Required | Purpose |
| --- | --- | --- |
| `SDS_PARSER_API_KEY` | recommended | If set, requests must send a matching `X-API-Key`. |
| `SUPABASE_URL` | for `/parse/stage` and jobs | Project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | for `/parse/stage` and jobs | Server-side only; bypasses RLS, so every query is tenant-scoped. |
| `SDS_PARSE_JOBS_ENABLED` | optional | `true` starts the background worker and enables `/jobs/parse-sds`. Needs migration 294. |

## Tests

The parser is stdlib-only, so its tests run without any installs. The PDF /
OCR tests (`tests/test_pdf_text.py`) build their PDFs in memory and skip
themselves unless `requirements.txt` and the `tesseract` binary are installed:

```bash
cd services/sds-parser
python -m unittest discover -s tests -v
```

## How it plugs into the app

`/parse/stage` writes the identical columns the AI route writes, so the
existing **SDS Review Queue** and the `/apply` approval flow work unchanged — a
reviewer sees the proposed fields (flagged by the capped confidence + the
`parser_notes`), edits as needed, and approves.

The web app's SDS parse route uses this service automatically when Claude is
unavailable (no key, usage cap, rate limit, 5xx) and `SDS_PARSER_URL` is set
(`apps/web/lib/ai/sdsFallback.ts`): it queues a background job and answers 202,
or — when jobs are off here — calls `/parse/file` and saves the result itself.
