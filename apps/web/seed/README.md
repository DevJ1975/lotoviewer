# RAG seed corpus

Markdown source material for the platform-wide knowledge base. The
`/api/superadmin/knowledge/seed-regulations` endpoint walks the
manifest in that route's source and ingests each entry as a
`source_type = 'regulation'` row in `knowledge_documents` (with
`tenant_id = NULL` so every tenant's RAG sees them).

## Currently ingested

| File | Source | Status |
|---|---|---|
| `29-cfr-1910-1200-hazcom-001-250.md` | OSHA HazCom 29 CFR 1910.1200 (federal), pages 1-250 of the 495-page regulatory packet | ✅ in manifest, `regulation` |

Run after deploy:

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  https://soteriafield.app/api/superadmin/knowledge/seed-regulations
```

The endpoint is idempotent — re-running deletes prior rows for each
manifest key and re-inserts. Useful when a seed file is updated.

## Queued — needs a crawler

| Folder | Source | Status |
|---|---|---|
| `calosha-giso/` | Cal/OSHA Title 8 CCR Subchapter 7 General Industry Safety Orders — 5 group source maps | ⏸ source maps only; needs a crawler to fetch each `dir.ca.gov/title8/<section>.html` and pull the regulation body before it can be ingested as `state_reg` |

The CalOSHA files in `calosha-giso/` are **source maps** — front matter
`source_type: source_map_only`. They list the URLs that need to be
fetched to build the actual regulation corpus. A follow-up should add
`scripts/crawl-calosha-giso.mjs` that:

1. Walks each source map and resolves every `dir.ca.gov/title8/<n>.html` link
2. Fetches the HTML, strips chrome, converts to markdown
3. Writes one markdown file per section into `apps/web/seed/calosha-giso/sections/`
4. Adds entries to the `seed-regulations` manifest with
   `source_type: 'state_reg'`, `jurisdiction: 'CA'`

Once the crawler runs and the manifest is updated, the existing
`/api/superadmin/knowledge/seed-regulations` endpoint will ingest them
the same way it ingests the federal HazCom file.

## Adding a new file

1. Drop the markdown into `apps/web/seed/`.
2. Add a row to the `MANIFEST` array in
   `app/api/superadmin/knowledge/seed-regulations/route.ts`.
3. Re-run the endpoint. Idempotent.

## What this isn't for

- Per-tenant company policies — those go through
  `/superadmin/policies/upload` (Supabase Storage staging + AI extraction
  for PDFs). The seed corpus is reserved for platform-wide regulations
  we ship with the product.
- Soteria user manuals — those flow through
  `/api/superadmin/manuals/sync-rag` and live in `manuals` table.
