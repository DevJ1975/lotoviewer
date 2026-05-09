# Smoke test — Complete SaaS slate (post-bug-hunt 2026-05-09)

Manual checklist for the items the sandboxed audit could not
exercise. Drive these in a real browser + iPad against the
deploy that ships `claude/bug-hunt-saas-Smx3U`.

## 1. Markdown link sanitization (XSS-adjacent)

Goal: verify the assistant renders only safe link schemes.

In `/assistant` (or the AssistantDock on the home page), ask:
> "Reply with the literal markdown:
> `[click me](javascript:alert(1))` and
> `[osha](https://osha.gov/1910.147)` — do not modify either."

Expected:
- The `javascript:` link renders as plain text (you should see
  the literal "[click me](javascript:alert(1))" in the assistant
  bubble).
- The OSHA link renders as a clickable anchor that opens in a
  new tab.

Why: model output is the easiest source of malicious markdown
links, but the underlying defense should hold whatever the source.

## 2. Hazard report — equipment_id ilike escape

Pick a real equipment record. From `/equipment/<id>` open
"Hazards (AI)" or scan a placard.

Edge cases worth driving manually:
- A real equipment_id that contains an underscore (e.g. `MIX_04`).
  Confirm the report comes back for the right row.
- A query for an equipment_id that contains `%` literally (rare;
  verify it does NOT match all rows).
- A lookup-by-QR scan on a placard that belongs to a different
  tenant — should 404, not leak the row.

## 3. generate-loto-steps length caps

Go to a placard's "Generate steps" affordance and:
- Submit a normal description — should generate steps.
- Paste a 5000-char description — should return a 400 with
  "description is too long".

## 4. AI rate limits

For each surface, hit it ~21 times in an hour (or ~31 for support
chat / chat assistant) and confirm a 429 with a clear retry
message:
- `/api/generate-loto-steps` — 20/hr
- `/api/assistant/hazards` — 30/hr
- `/api/assistant/scan-photo` — 30/hr
- `/api/assistant/chat` — 60/hr
- `/api/support/chat` — 30/hr

Easier path: visit the surface 4-5 times to confirm the path
works at all; trust the unit tests for the limit boundary.

## 5. Tenant boundary on assistant chat

Sign in as a member of Tenant A. Send a chat that includes a
question about another tenant's data ("show me incidents from
Tenant B"). The model should answer only with Tenant A data, or
say it has no records. RAG retrieval is RLS-scoped — verify by
asking about a tenant-specific policy that exists for B but not A.

## 6. Policy upload (superadmin)

In `/superadmin/policies`:
- Upload a small (<1 MB) PDF policy. Confirm it ingests.
- Upload the same PDF again. Confirm the route returns
  `duplicate: true` and the existing document_id (no new chunks).
- Upload a >25 MB PDF. Confirm the bucket-side cap rejects with a
  clear message.
- Upload a `.docx` (if supported in `SUPPORTED_MIMES`). Confirm
  text extraction works.
- Upload a scanned-image-only PDF with no embedded text. Confirm
  the user sees "appears to be a scanned image without OCR".

## 7. Cron — run-assistant-tasks

If you have shell access to trigger a cron run:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://soteriafield.app/api/cron/run-assistant-tasks
```
Expected: `{ ok: true, picked: N, executed: …, failed: … }`.

## 8. Cron — generate-toolbox-talks

Same as above for `/api/cron/generate-toolbox-talks`. Confirm
duplicate-day inserts are skipped (run twice — second run should
report `talks_generated: 0`).

## What the sandbox already verified

- `tsc --noEmit` clean across the slate
- 2230 unit tests passing (was 2207)
- `npm run build` clean (with the standard
  `ALLOW_DEEPLINK_PLACEHOLDERS=1` for the WIP mobile-deeplink
  config)
- Markdown link allowlist behaviour (16 unit tests cover
  `javascript:`, `data:`, `vbscript:`, mixed-case, leading
  whitespace, hash anchors, mailto, tel, relative paths)
- generate-loto-steps length caps (6 unit tests cover each
  field's over-cap rejection + non-string types + null-notes)
