---
description: Run the two lotoauditors over Snak King LOTO placards and emit a photo-fix hand-off report
argument-hint: "[department] [limit]   e.g. \"Tortilla Tc 1\" 6"
model: opus
---

# /lotoauditors — audit LOTO placard photos vs. isolation points

Orchestrate the two **lotoauditor** subagents to verify that each LOTO placard's isolation photo
shows the real energy-isolation point, consistent with the machine and its documented energy steps,
then write a markdown report for the `loto-photo-fixer` agent.

Arguments: `$1` = department (optional; omit to sweep all active Snak King placards in batches).
`$2` = limit (optional; max placards this run).

## Fixed facts

- Supabase project (Soteria Main Project): `zwtnpyjifbdytlektxlc`
- Snak King tenant (`Snak King - COI`): `ae3f1973-4c3e-4b6e-b91f-9de5ff10529e`
  (resolve generically with `select id from tenants where name ilike '%snak%'` if it ever changes)
- Verdict taxonomy + field names: `apps/web/lib/loto/audit/schemas.ts` (`FpeResult`)
- Energy codes: `packages/core/src/energyCodes.ts`
- Knowledge base: `docs/loto-audit/kb/`

## Pipeline (READ-ONLY against production)

1. **Scope.** Build the placard list with a SELECT (mirror `loadEquipment` in
   `apps/web/lib/loto/audit/runAudit.ts`): tenant = Snak King, `decommissioned is not true`,
   `equip_photo_url`/`iso_photo_url` present, `department = $1` if given, `limit $2` if given.
   For each placard also pull its `loto_energy_steps` (order by `sequence_order, step_number`).
   **SELECT only — never write to production or call `apply_migration`.**

2. **Fetch photos once.** `WORK=$(mktemp -d /tmp/loto-audit.XXXXXX)`; `curl -fsSL` each
   `equip_photo_url` → `$WORK/<id>_EQUIP.jpg` and `iso_photo_url` → `$WORK/<id>_ISO.jpg`. A null URL
   or failed download ⇒ that photo is `missing`. Note any `iso_photo_is_placeholder = true` /
   `iso_photo_provenance = 'reference_placeholder'` rows up front — their iso point is already
   known-unverified.

3. **Dispatch both auditors.** For the batch, invoke `loto-food-production-equipment-engineer` and
   `loto-snak-king-maintenance-engineer`, giving each: the equipment rows, the energy steps, and the
   local photo paths in `$WORK` (so they Read the images directly — no re-download). The equipment
   engineer owns equipment/manufacturer truth and may WebSearch/WebFetch OEM manuals; the maintenance
   engineer owns Snak King facility/line plausibility. Each returns one finding per placard.

4. **Merge by consensus (the safety floor).** Per placard, combine the two findings:
   - iso `verdict = match` ONLY if the equipment engineer says `match` AND the maintenance engineer
     concurs (`concurs_with_equipment_engineer = true`, `context_verdict = match`). 
   - Any disagreement, or either side `low_confidence` ⇒ floor to **`low_confidence`** (never silently
     `match`). Any `mismatch`/`missing` from either side ⇒ carry the worse verdict.
   - This mirrors the deterministic "isolation unverified" floor in
     `apps/web/lib/loto/audit/safetySignals.ts`.

5. **Write the report.** Render the merged findings using `docs/loto-audit/report-template.md` to
   `docs/loto-audit/reports/<YYYY-MM-DD>-snak-king-<dept-slug>.md` (suffix `-pilot` for a sample run).
   Include the human-readable per-placard blocks AND the machine-readable fenced JSON summary the
   `loto-photo-fixer` consumes.

6. **Summarize.** Report counts (match / low_confidence / mismatch / missing) and the top fixes.
   Confirm zero production writes occurred.

## Then

Hand the report to `loto-photo-fixer` to stage remediations (it never auto-applies). Do not modify any
`loto_equipment` / `loto_energy_steps` rows or storage objects in this command — fixes are staged for
human review through the existing audit pipeline.
