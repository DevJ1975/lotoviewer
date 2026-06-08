# RAG seed corpus

Source material for the platform-wide knowledge base — the `regulation` /
`state_reg` / `dot` / `epa` / `rcra` documents the assistant retrieves from, all
ingested as global rows (`tenant_id = NULL`) so every tenant's RAG sees them.

There are two ingestion paths, by source size:

## Federal OSHA 29 CFR Part 1910 (General Industry) — `scripts/osha_1910_ingest.py`

Part 1910 is fetched live from the eCFR API and ingested **one
`knowledge_documents` row per section / appendix**, so the assistant can cite a
pinpoint section (`[29 CFR 1910.147 § 1910.147(c)(4)]`) instead of a single
"[29 CFR Part 1910]". eCFR is several MB and Voyage embedding is slow + costs
money, so this runs **offline** (not on Vercel), then the generated SQL is applied
to Supabase.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r scripts/requirements.txt

# Stage-by-stage (recommended first time):
python scripts/osha_1910_ingest.py fetch  --date 2026-05-07
python scripts/osha_1910_ingest.py parse
python scripts/osha_1910_ingest.py verify        # diff parsed sections vs the source-map checklist
python scripts/osha_1910_ingest.py chunk
VOYAGE_API_KEY=... python scripts/osha_1910_ingest.py embed
python scripts/osha_1910_ingest.py emit-sql      # -> scripts/.osha-build/sql/batch-*.sql + record-snapshot.sql

# …or all at once:
VOYAGE_API_KEY=... python scripts/osha_1910_ingest.py all --date 2026-05-07
```

Then apply the generated SQL to Supabase (Supabase SQL editor / `psql` / the
Supabase MCP `execute_sql` tool), **in order**: every `batch-NNN.sql`, then
`record-snapshot.sql` last (it stamps the snapshot date the freshness cron
compares against — see migration `217_regulation_update_checks.sql`).

Each batch is idempotent: it deletes a section's prior global row by its eCFR
deep-link `source_url` (cascading its chunks) before re-inserting, so re-running
after an annual eCFR amendment rewrites only what changed. Cost ≈ $2–3 in Voyage
credits per full ingest.

> Note: `VOYAGE_API_KEY` must also be set in the **deployment** env — the
> assistant embeds each user query at retrieval time (`lib/ai/embeddings.ts`).

### Staying current — `/api/cron/check-regulation-updates`

A bi-monthly cron (~every 60 days, `vercel.json`) polls eCFR's versions API for
Part 1910, compares the newest amendment date against
`regulation_update_checks.ingested_snapshot`, and emails the operator to re-run
the ingester when an update is due. It never re-ingests on its own (Voyage cost +
function-timeout); re-running the tool above is the deliberate operator step.

## Other ship-with-the-product regulations — `seed-regulations` endpoint

Smaller markdown corpora (e.g. a future CalOSHA crawl) go through
`/api/superadmin/knowledge/seed-regulations`: drop a markdown file in this
directory, add an entry to the `MANIFEST` array in that route, and POST the
endpoint (idempotent). The MANIFEST is currently empty — Part 1910 moved to the
Python ingester above, and the partial OCR'd HazCom seed it superseded was removed.

```bash
curl -X POST -H "Authorization: Bearer <CRON_SECRET or INTERNAL_PUSH_SECRET>" \
  https://soteriafield.app/api/superadmin/knowledge/seed-regulations
```

## Queued — needs a crawler

| Folder | Source | Status |
|---|---|---|
| `calosha-giso/` | Cal/OSHA Title 8 CCR Subchapter 7 General Industry Safety Orders — 5 group source maps | ⏸ source maps only; needs a crawler to fetch each `dir.ca.gov/title8/<section>.html`, strip chrome, convert to markdown, then ingest as `state_reg` (`jurisdiction: 'CA'`) via the seed-regulations endpoint |

## What this isn't for

- **Per-tenant company policies** — those go through `/superadmin/policies/upload`
  (Supabase Storage staging + AI extraction for PDFs). The seed corpus is reserved
  for platform-wide regulations we ship with the product.
- **Soteria user manuals** — those flow through `/api/superadmin/manuals/sync-rag`
  and live in the `manuals` table.
