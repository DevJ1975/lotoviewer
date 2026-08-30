<!--
TEMPLATE for the lotoauditors hand-off report. The /lotoauditors command renders a copy of this to
docs/loto-audit/reports/<YYYY-MM-DD>-snak-king-<dept-slug>.md (suffix -pilot for sample runs).
Replace every <placeholder>. Keep BOTH the human-readable per-placard blocks and the machine-readable
JSON summary at the end — loto-photo-fixer parses the JSON; humans read the blocks.
-->

# LOTO Photo Audit — Snak King — <Department> <(pilot)>

- **Run date:** <YYYY-MM-DD>
- **Auditors:** loto-food-production-equipment-engineer + loto-snak-king-maintenance-engineer (consensus)
- **Tenant:** Snak King - COI (`ae3f1973-4c3e-4b6e-b91f-9de5ff10529e`) · project `zwtnpyjifbdytlektxlc`
- **Scope:** <dept / filters> · **placards audited:** <N>
- **Access:** READ-ONLY (no production rows or storage objects were modified)

## Summary

| iso verdict | count | equipment-photo verdict | count |
|---|---|---|---|
| match | <n> | match | <n> |
| low_confidence | <n> | low_confidence | <n> |
| mismatch | <n> | mismatch | <n> |
| missing | <n> | missing | <n> |

**Headline:** <one or two sentences: how many isolation photos are NOT trustworthy and the dominant
failure mode (e.g., nameplate-instead-of-disconnect, cross-wiring, placeholder).>

## Findings

Repeat one block per placard. Order worst-first (mismatch → missing → low_confidence → match).

### `<equipment_id>` — <description> — <department>
- **Manufacturer / model:** <mfr / model or "(blank)">
- **Documented energy steps:** <e.g., E (480V isolate), T (hot-oil cool-down), G (gas shutoff)>
- **Equipment photo:** `<verdict>` (<confidence>) — <one-sentence evidence>
- **Isolation photo:** `<verdict>` (<confidence>) · shows_isolation_point=`<bool>` ·
  consistent_with_energy_steps=`<bool>` — <one-sentence evidence>
- **Consensus note:** <agree/disagree between the two auditors and why; what floored the verdict>
- **Recommended fix:** <concrete, actionable: what to re-shoot and where; use "[VERIFY ON SITE: ...]"
  for any unknown device ID — never guess one>

## Machine-readable summary (loto-photo-fixer consumes this)

Field names mirror `apps/web/lib/loto/audit/schemas.ts` (`FpeResult`). `merged_iso_verdict` is the
consensus result; `action_priority` is `high` for any iso `mismatch`/`missing`, else `medium`/`low`.

```json
{
  "run": { "date": "<YYYY-MM-DD>", "tenant": "Snak King - COI", "department": "<dept>", "scope": "<filters>" },
  "placards": [
    {
      "equipment_id": "<id>",
      "description": "<desc>",
      "department": "<dept>",
      "manufacturer": "<mfr|null>",
      "model": "<model|null>",
      "equip_photo": { "verdict": "match|mismatch|low_confidence|missing", "confidence": "high|medium|low", "notes": "<...>" },
      "iso_photo":   { "verdict": "match|mismatch|low_confidence|missing", "confidence": "high|medium|low",
                       "shows_isolation_point": false, "consistent_with_energy_steps": false, "notes": "<...>" },
      "merged_iso_verdict": "match|mismatch|low_confidence|missing",
      "consensus": { "equipment_engineer": "<verdict>", "maintenance_engineer": "<verdict>", "agreed": true },
      "recommended_fix": "<actionable fix>",
      "action_priority": "high|medium|low"
    }
  ]
}
```
