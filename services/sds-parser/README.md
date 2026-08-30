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

> **Limitation:** it reads the PDF *text layer*. A scanned / image-only SDS with
> no text (and image-only GHS pictograms) can't be read without OCR, which is
> out of scope. Those return a clear 422.

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/health` | — | `{"status":"ok"}` |
| POST | `/parse/text` | `{"text": "...SDS text..."}` | `ParsedSdsPayload` |
| POST | `/parse/file` | multipart `file=@sds.pdf` | `ParsedSdsPayload` |
| POST | `/parse/url` | `{"url": "https://.../sds.pdf"}` | `ParsedSdsPayload` |
| POST | `/parse/stage` | `{"sds_id","tenant_id","product_id?"}` | `{staged, parsed}` |

`/parse/stage` downloads the SDS from the Supabase `chemical-sds` bucket and
writes the parse back to `chemical_sds_documents` (`parsed_payload`,
`parse_model='python-sds-parser@1'`, `parse_confidence`,
`parse_review_status='pending'`) — exactly like the AI route — so it appears in
**SDS Review Queue** (`/chemicals/review`) for approval.

## Run it

```bash
cd services/sds-parser
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
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
| `SUPABASE_URL` | for `/parse/stage` | Project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | for `/parse/stage` | Server-side only; bypasses RLS, so every query is tenant-scoped. |

## Tests

The parser is stdlib-only and tested without any installs:

```bash
cd services/sds-parser
python -m unittest discover -s tests -v
```

## How it plugs into the app

`/parse/stage` writes the identical columns the AI route writes, so the
existing **SDS Review Queue** and the `/apply` approval flow work unchanged — a
reviewer sees the proposed fields (flagged by the capped confidence + the
`parser_notes`), edits as needed, and approves. No web-app code change is
required to use this; point it at an `sds_id` and the row shows up pending.
Optionally, the in-app parse route can be wired to call `/parse/stage` as an
automatic fallback when Anthropic returns a usage-limit error — see the PR
description for that follow-up.
