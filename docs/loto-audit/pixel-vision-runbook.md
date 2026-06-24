# LOTO pixel-vision audit — operator runbook (Snak King COI)

- **Tenant:** Snak King - COI (`ae3f1973-4c3e-4b6e-b91f-9de5ff10529e`) · Supabase project `zwtnpyjifbdytlektxlc` ("Soteria Main Project")
- **Prepared:** 2026-06-24 · **Predecessor:** [`reports/2026-06-23-snak-king-fleet-provenance.md`](reports/2026-06-23-snak-king-fleet-provenance.md)
- **Access posture:** the audit fetches image bytes **server-side on Vercel** (where egress works). Nothing mutates a live photo until a human approves staged changes and an admin runs Apply.

## Why this run exists

The provenance sweep (run `b80cee57-ec83-48d9-b55d-ac3561f112b9`, status `awaiting_review`) staged **289
`ehs_finding` rows across 270 placards** — all high-severity `Cal/OSHA T8 §3314(g)(4)`. Findings are a
**record, not a fix**: live photos are unchanged and **all 499 active placards still report
`iso_photo_provenance='field'`** even though 270 wear a demonstrably shared or wrong-slot ISO image.
Provenance can prove a photo is *shared* but not *which* sharer (if any) is the true owner, and it
cannot grade the within-line shares. **Pixel vision settles both.** This run drives the existing
multi-agent vision audit over the implicated placards and lets the real fixes flow through the
human-review gate.

## What the vision audit does per machine (no new code — `lib/loto/audit/runAudit.ts`)

FPE (Haiku **vision**, judges equip + ISO photos) → DS (consistency) → EHS (Opus Cal/OSHA gate) →
Author (corrected procedure, only on a gate failure). When the ISO point is unverified, `emitChanges`
(runAudit.ts:536–588) stages exactly one of, in order:

1. **Real in-house photo** — `findExistingIsoPhoto` searches the machine's *own* storage folder; a
   vision-verified match is staged as a **verified field photo** (`new_value.source='storage'`,
   `provenance='field'`, `is_placeholder=false`, **no watermark**). Best outcome — sidesteps stock photos.
2. **Watermarked reference placeholder** — else `buildPlaceholderPhoto` stages
   `new_value={photo_url, source_url}`. On Apply, migration 219 defaults it to
   `provenance='reference_placeholder'`, `is_placeholder=true` (the 217 trigger guarantees it can never
   read as "verified"). This is the chosen handling for can't-reshoot machines; the §3314 finding stays open.
3. **Open finding** — else an `ehs_finding` "capture a real isolation-point photo" (→ field re-capture).

> **Expect mostly (1) and (3).** Metadata is sparse — **34/499 manufacturer (6.8 %), 0/499 model** — so
> `buildPlaceholderPhoto` will usually find nothing usable and fall through to the open finding. That is
> the correct, honest outcome. The real automated win is (1): a correct shot already sitting in storage.

## Scope (two batches; together = the photo-provenance set)

| Batch | Machines | What | File |
|---|---:|---|---|
| 1 — high severity | **270** | cross-department shared ISO **+** wrong-slot (the exact set staged in `b80cee57`) | [`scope/batch1-high-severity.txt`](scope/batch1-high-severity.txt) |
| 2 — within-line | **140** | ISO shared by ≥2 machines on one line (the `[VISION PENDING]` grading set; includes the 2 broken-ISO SKAP machines) | [`scope/batch2-within-line.txt`](scope/batch2-within-line.txt) |

Batches are disjoint and verified all-active. The 89 placards in neither batch have a unique,
correctly-slotted ISO photo; run the **full-fleet alternative** below if you also want them judged.

## Prerequisites

The driver runs from a machine/CI with network egress to the deployment (**not** the Claude sandbox).

```sh
export SOTERIA_BASE_URL=https://soteriafield.app          # your actual deployment URL
export SOTERIA_BEARER_TOKEN=<tenant owner/admin token>     # same token used for other admin API calls
export SOTERIA_TENANT_ID=ae3f1973-4c3e-4b6e-b91f-9de5ff10529e
```

## Run it

Recommended — phased, spend-capped (review Batch 1 before spending on Batch 2):

```sh
# Batch 1 — high severity (270). Prints the review link when ready.
node apps/web/scripts/run-loto-audit.mjs \
  --equipment-ids "$(cat docs/loto-audit/scope/batch1-high-severity.txt)" --mint-link

# Batch 2 — within-line (140), after Batch 1 is reviewed.
node apps/web/scripts/run-loto-audit.mjs \
  --equipment-ids "$(cat docs/loto-audit/scope/batch2-within-line.txt)" --mint-link
```

The script polls, **self-resumes on stall**, and mints the review link. The `loto-audit-resume` cron
(`*/5 * * * *`, vercel.json) is the additional safety net — a fans-out-to-hundreds-of-model-calls run
outlives a single serverless invocation. Capture the `run_id` it prints.

Full-fleet alternative (all 499 active — completeness over cost): `node apps/web/scripts/run-loto-audit.mjs --mint-link`.

Minimal curl (no script), full active sweep:

```sh
curl -sS -X POST "$SOTERIA_BASE_URL/api/admin/loto/audit" \
  -H "authorization: Bearer $SOTERIA_BEARER_TOKEN" \
  -H "x-active-tenant: $SOTERIA_TENANT_ID" -H "content-type: application/json" \
  -d '{"only_active": true}'      # → 202 { "run_id": "…" }; cron drives it to awaiting_review
```

## Review & apply (the only step that writes a live photo)

1. Open the minted review link. Approve, per machine: **real-photo swaps** (best), **watermarked
   placeholders** (interim), and leave **field-recapture findings** as the open worklist.
2. Apply. The route snapshots first, calls `apply_approved_audit_changes`, and nulls `placard_url` so
   placards regenerate. `ehs_finding` rows are non-mutating no-ops. Apply is gated (migration 222) — no
   approval, no write.

## Verification (read-only SQL · project `zwtnpyjifbdytlektxlc`)

Set `:run = '<NEW_RUN_ID>'` from the 202 response.

```sql
-- (a) Pre-apply: the run reached review, and what it staged.
--     source='storage' → real in-house photo; has_source_url → watermarked web placeholder.
SELECT change_kind,
       new_value->>'source'       AS source,
       (new_value ? 'source_url')  AS watermarked_placeholder,
       severity, count(*)
FROM loto_audit_changes WHERE run_id = :run
GROUP BY 1,2,3,4 ORDER BY 1,2;

-- (b) Coverage: how many machines this run judged (compare to your batch size — 270 / 140 / 499).
SELECT count(*) AS judged FROM loto_equipment
WHERE tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e' AND last_audit_run_id = :run;

-- (c) Zero live mutation BEFORE apply — expect 0 (no machine has a placeholder today).
SELECT count(*) AS placeholders_now FROM loto_equipment
WHERE tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e' AND iso_photo_is_placeholder;

-- (d) Post-apply: watermarked placeholders are the clean discriminator (0 → N), and
--     storage swaps keep provenance='field' but changed iso_photo_url.
SELECT iso_photo_provenance, iso_photo_is_placeholder,
       count(*) FILTER (WHERE iso_photo_placeholder_source_url IS NOT NULL) AS with_source_url,
       count(*)
FROM loto_equipment
WHERE tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e' AND decommissioned = false
GROUP BY 1,2 ORDER BY 1,2;
```

## After the run — reconciliation report (Claude, read-only)

Once a run is `awaiting_review`, Claude produces `reports/2026-06-24-snak-king-pixel-vision.md` from
[`report-template.md`](report-template.md): vision verdicts mapped onto the 289 provenance findings —
**confirmed-wrong** cross-dept shares, **legitimate** within-line combined-LOTO groups (e.g. the TC1
fryer-oil loop `SKT1-540/550/560/570`), and the residual **field re-capture worklist**.

## Out of scope

Template-residue energy steps (33 active — a desk-fix text track, not photos); any write to
`iso_photo_url` outside the reviewed Apply RPC; treating a stock/OEM image as a verified isolation photo.
