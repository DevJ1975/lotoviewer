# LOTO Photo Audit — Snak King — Tortilla TC 1 (pilot)

- **Run date:** 2026-06-23
- **Auditors:** loto-food-production-equipment-engineer + loto-snak-king-maintenance-engineer (consensus)
- **Tenant:** Snak King - COI (`ae3f1973-4c3e-4b6e-b91f-9de5ff10529e`) · project `zwtnpyjifbdytlektxlc`
- **Scope:** department `Tortilla Tc 1`, 6 representative machines spanning E/G/H/P/M/T and 2 named OEMs
- **Access:** READ-ONLY (no production rows or storage objects were modified)

> **Run limitation — pixel vision pending.** This environment's outbound network policy blocks direct
> fetches of the storage images (Bash `curl` and WebFetch both return HTTP 403; `example.com` fails the
> same way — it is the environment egress proxy, not Supabase, which serves the public `loto-photos`
> bucket fine). The `Read` tool needs a local image file, so the **pixel-level vision check did not run
> here.** What you see below is the **data-provenance + consistency** half of the audit, run entirely
> through the Supabase MCP — which is already conclusive for cross-wiring, shared images, and broken
> links. Re-run `/lotoauditors` in an environment with egress to `*.supabase.co` (or on a workstation)
> to add the pixel verdicts; per-placard items needing pixels are marked `vision: pending`.

## Summary (data-provenance verdicts)

| isolation photo | count | equipment photo | count |
|---|---|---|---|
| mismatch (cross-wired) | 2 | mismatch (cross-wired) | 2 |
| low_confidence (shared or pixels-pending) | 3 | match / class (provenance) | 4 |
| match (provenance, pixels pending) | 1 | | |

**Headline:** Of 6 placards, **3 carry a wrong or unverifiable isolation photo** (`SKT1-550` mismatch,
`SKT1-270` mismatch, `SKT1-820` low-confidence) and **2 wear a cross-wired equipment photo** (`SKT1-550`
and `SKT1-540`, both showing the `SKCC-*` Cheese Curl fryer). `SKT1-270`/`SKT1-820` share one generic
conveyor isolation image. `SKT1-220` looks clean apart from a leftover Cheese-Curl `H` template step.

> **Correction (re-verified 2026-06-23):** an earlier draft of this report flagged `SKT1-500`'s isolation
> URL as a broken/404 link. Re-verification against live state shows its `iso_photo_url` and the object
> **both** at the non-tenant-prefixed key `SKT1-500/SKT1-500_ISO_2026-04-20T22-27-41Z.jpg` — it resolves.
> The SKT1-500 finding below is corrected to a low-severity storage-convention note (see the companion
> fixes report).

## Findings (worst first)

### `SKT1-550` — Fryer (Tortilla TC 1)
- **Mfr/model:** (blank) · **Energy steps:** G (manual gas valve / NFPA 86), E (480 V), M (+ hot oil ≥350 °F)
- **Equipment photo:** object `SKCC-FRYER-EQ.jpg` — **mismatch (cross-wired)**. By Snak King's own naming,
  `SKCC-*` is the **Cheese Curl** line; this is the Cheese Curl fryer's photo on the **Tortilla TC1**
  fryer. Same machine *class*, wrong machine/line. Also reused on `SKT1-540`.
- **Isolation photo:** object `SKCC-FRYER-IP.jpg` — **mismatch (cross-wired)** for the same reason.
  `vision: pending` for whether it even depicts a real isolation point.
- **Why both auditors are needed:** the equipment engineer alone might pass "a fryer photo on a fryer";
  the Snak King maintenance engineer recognizes `SKCC` ≠ `SKT1` and flags the cross-wire. Consensus → **mismatch**.
- **Recommended fix:** Re-shoot SKT1-550's own equipment + isolation photos — the TC1 fryer main fused
  disconnect and the manual gas-train shutoff (not the SSOV). Current images belong to the Cheese Curl line.

### `SKT1-540` — Main Oil Pump (Tortilla TC 1 fryer oil loop)
- **Mfr/model:** (blank) · **Energy steps:** E, P, M, T (hot oil), chemical (CaCl₂ brine) · combined LOTO group (540/550/560/570)
- **Equipment photo:** object `SKCC-FRYER-EQ.jpg` — **mismatch (cross-wired)**. The Cheese Curl fryer photo
  on the TC1 **oil pump** placard: wrong line *and* wrong machine type (a pump is not a fryer).
- **Isolation photo:** object `…/SKT1-540/SKT1-540_ISO_v2.jpg` — machine-specific path, **provenance match**;
  `vision: pending` to confirm it shows the pump disconnect + oil-line isolation.
- **Recommended fix:** Replace the equipment photo with the actual TC1 main oil pump (or TC1 fryer-loop) image;
  it currently shows the Cheese Curl fryer. Verify the ISO photo shows this pump's disconnect/valve.

### `SKT1-270` — Masa Sheeter 16 Row (Tortilla TC 1)
- **Mfr/model:** (blank) · **Energy steps:** E, P, M (with `[VERIFY ON SITE]` markers) — coherent for a sheeter
- **Equipment photo:** object `…/SKT1-270/SKT1-270_EQUIP_v2.jpg` — own machine-specific path, **provenance match**; `vision: pending`.
- **Isolation photo:** object `SKT-CONV-IP-2.jpg` — **mismatch**. This is a generic **conveyor** isolation
  image, and it is **shared with `SKT1-820`** (a FastBack conveyor). A masa sheeter (roll/nip + pneumatic
  + main disconnect) and a conveyor do not share an isolation point.
- **Recommended fix:** Re-shoot the sheeter's own isolation point (main disconnect + lockable air-supply
  valve with bleed for the roll/gate cylinders). Stop sharing `SKT-CONV-IP-2.jpg` across machines.

### `SKT1-500` — Oven (Tortilla TC 1)
- **Mfr/model:** (blank) · **Energy steps:** G (manual gas valve / NFPA 86), M, E — coherent for a gas oven
- **Equipment photo:** object `SKT-OVEN-EQ-2.jpg` exists — **provenance match (class)**; `vision: pending`.
- **Isolation photo:** **low_confidence (resolves; pixels pending).** Re-verified against live state: the
  stored `iso_photo_url` and the object **both** sit at the non-tenant-prefixed key
  `SKT1-500/SKT1-500_ISO_2026-04-20T22-27-41Z.jpg` (1,044,665 bytes) — it resolves, **no 404**. The only
  residual is that this object uses a legacy flat key outside the migration-033 tenant-UUID-first RLS folder.
- **Recommended fix:** No URL repoint (the link already resolves; editing it would risk breaking it).
  Optionally align the object to the tenant-prefixed RLS folder as a separate, reviewed storage task. Then
  vision-verify the ISO shows the gas manual shutoff + main disconnect.

### `SKT1-820` — FastBack to Seasoning 1 (Tortilla TC 1) · Heat and Control
- **Mfr/model:** Heat and Control · **Energy steps:** E (VFD, 5-min DC-bus), M (eccentric, ~60 s coast-down) — coherent
- **Equipment photo:** object `SKT-CONV-EQ-2.jpg` — generic conveyor image, class-consistent; `vision: pending`.
- **Isolation photo:** object `SKT-CONV-IP-2.jpg` — **low_confidence**. Class-plausible (a conveyor disconnect),
  but it is a **generic image shared with `SKT1-270`**, so it is almost certainly a representative shot, not
  THIS FastBack's own disconnect. Never `match` while shared.
- **Recommended fix:** Capture SKT1-820's own equipment + isolation photos (its labeled disconnect). Retire
  the shared generic `SKT-CONV-*` images.

### `SKT1-220` — Shaffer Mixer (Tortilla TC 1) · Shaffer (AMF Bakery Systems)
- **Mfr/model:** Shaffer (AMF Bakery Systems) · **Energy steps:** E, P, M, **H (leftover stub)**
- **Equipment photo:** object `SKT1-MIXER-EQ.jpg` — **provenance match**. The row's own note records a
  2026-05-13 repair: it previously wore `SKCC-MIXER` (Cheese Curl) photos and was repointed to the real
  Tortilla Shaffer mixer images. `vision: pending` to confirm the repair visually.
- **Isolation photo:** object `SKT1-MIXER-IP.jpg` — **provenance match**; `vision: pending`.
- **Data-consistency defect:** an `H` (Hydraulic) energy step remains as **unpopulated template text** —
  `"(CHEESE_MIXER/H) — detail pending; populate in loto_templates.TAG_BODY"` / `"Procedure for energy type
  H not yet implemented."` — a residue of the prior Cheese-Curl cross-wire. A Shaffer dough mixer's cover
  lift *may* be hydraulic, but a live placard must not carry "not yet implemented" text.
- **Recommended fix:** Photos look correctly repaired — confirm by vision. **Resolve the `H` step:** either
  populate a real hydraulic cover-lift procedure or remove the Cheese-Curl stub. (Photo audit: clean.)

## Machine-readable summary (loto-photo-fixer consumes this)

Field names mirror `apps/web/lib/loto/audit/schemas.ts` (`FpeResult`). Verdicts here are **provenance/data
layer**; `vision_status: "pending_egress"` means the pixel check still owes confirmation. `merged_iso_verdict`
applies the consensus floor.

```json
{
  "run": { "date": "2026-06-23", "tenant": "Snak King - COI", "department": "Tortilla Tc 1",
           "scope": "6 representative machines", "vision_status": "pending_egress",
           "note": "Pixel vision blocked by environment network policy (HTTP 403 on image fetch); data-provenance audit only." },
  "placards": [
    { "equipment_id": "SKT1-550", "description": "Fryer", "department": "Tortilla Tc 1", "manufacturer": null, "model": null,
      "equip_photo": { "verdict": "mismatch", "confidence": "high", "notes": "Wears SKCC (Cheese Curl) fryer photo SKCC-FRYER-EQ.jpg; wrong line." },
      "iso_photo":   { "verdict": "mismatch", "confidence": "high", "shows_isolation_point": null, "consistent_with_energy_steps": false, "notes": "SKCC-FRYER-IP.jpg is the Cheese Curl fryer's photo; pixel check pending." },
      "merged_iso_verdict": "mismatch",
      "consensus": { "equipment_engineer": "low_confidence", "maintenance_engineer": "mismatch", "agreed": false },
      "recommended_fix": "Re-shoot TC1 fryer's own equipment + isolation photos (main disconnect + manual gas shutoff). Stop reusing SKCC-FRYER-* images.",
      "action_priority": "high" },

    { "equipment_id": "SKT1-540", "description": "Main Oil Pump", "department": "Tortilla Tc 1", "manufacturer": null, "model": null,
      "equip_photo": { "verdict": "mismatch", "confidence": "high", "notes": "Wears SKCC-FRYER-EQ.jpg (Cheese Curl fryer) on a TC1 oil pump; wrong line and wrong machine type." },
      "iso_photo":   { "verdict": "match", "confidence": "low", "shows_isolation_point": null, "consistent_with_energy_steps": null, "notes": "Own path SKT1-540_ISO_v2.jpg; pixel check pending." },
      "merged_iso_verdict": "low_confidence",
      "consensus": { "equipment_engineer": "pending", "maintenance_engineer": "match_provenance", "agreed": true },
      "recommended_fix": "Replace equipment photo with the real TC1 oil pump / fryer-loop image. Vision-verify the ISO shows the pump disconnect + oil-line isolation.",
      "action_priority": "high" },

    { "equipment_id": "SKT1-270", "description": "Masa Sheeter 16 Row", "department": "Tortilla Tc 1", "manufacturer": null, "model": null,
      "equip_photo": { "verdict": "match", "confidence": "low", "notes": "Own path SKT1-270_EQUIP_v2.jpg; pixel check pending." },
      "iso_photo":   { "verdict": "mismatch", "confidence": "high", "shows_isolation_point": null, "consistent_with_energy_steps": false, "notes": "SKT-CONV-IP-2.jpg is a generic conveyor ISO shared with SKT1-820; a sheeter and conveyor cannot share an isolation point." },
      "merged_iso_verdict": "mismatch",
      "consensus": { "equipment_engineer": "mismatch", "maintenance_engineer": "mismatch", "agreed": true },
      "recommended_fix": "Re-shoot the sheeter's own isolation point (main disconnect + lockable air valve with bleed). Stop sharing SKT-CONV-IP-2.jpg.",
      "action_priority": "high" },

    { "equipment_id": "SKT1-500", "description": "Oven", "department": "Tortilla Tc 1", "manufacturer": null, "model": null,
      "equip_photo": { "verdict": "match", "confidence": "low", "notes": "SKT-OVEN-EQ-2.jpg resolves; pixel check pending." },
      "iso_photo":   { "verdict": "low_confidence", "confidence": "medium", "shows_isolation_point": null, "consistent_with_energy_steps": null, "notes": "Re-verified: iso_photo_url and object BOTH at non-prefixed SKT1-500/SKT1-500_ISO_2026-04-20T22-27-41Z.jpg; it resolves (no 404). Residual: legacy flat key outside the migration-033 RLS folder. Pixel check pending." },
      "merged_iso_verdict": "low_confidence",
      "consensus": { "equipment_engineer": "low_confidence", "maintenance_engineer": "low_confidence", "agreed": true },
      "recommended_fix": "No URL repoint (already resolves). Optional: align object to the tenant-prefixed RLS folder as a separate reviewed storage task; then vision-verify the ISO shows the gas manual shutoff + main disconnect.",
      "action_priority": "low" },

    { "equipment_id": "SKT1-820", "description": "Fastback to Seasoning 1", "department": "Tortilla Tc 1", "manufacturer": "Heat and Control", "model": null,
      "equip_photo": { "verdict": "match", "confidence": "low", "notes": "SKT-CONV-EQ-2.jpg generic conveyor image; class-consistent; pixel check pending." },
      "iso_photo":   { "verdict": "low_confidence", "confidence": "medium", "shows_isolation_point": null, "consistent_with_energy_steps": true, "notes": "SKT-CONV-IP-2.jpg class-plausible but generic and shared with SKT1-270 — not this unit's own disconnect." },
      "merged_iso_verdict": "low_confidence",
      "consensus": { "equipment_engineer": "low_confidence", "maintenance_engineer": "low_confidence", "agreed": true },
      "recommended_fix": "Capture SKT1-820's own equipment + isolation photos (its labeled disconnect). Retire shared generic SKT-CONV-* images.",
      "action_priority": "medium" },

    { "equipment_id": "SKT1-220", "description": "Shaffer Mixer", "department": "Tortilla Tc 1", "manufacturer": "Shaffer (AMF Bakery Systems)", "model": null,
      "equip_photo": { "verdict": "match", "confidence": "medium", "notes": "SKT1-MIXER-EQ.jpg; row note records a 2026-05-13 repair from SKCC mixer photos. Pixel check pending." },
      "iso_photo":   { "verdict": "match", "confidence": "medium", "shows_isolation_point": null, "consistent_with_energy_steps": true, "notes": "SKT1-MIXER-IP.jpg own image; pixel check pending." },
      "merged_iso_verdict": "match",
      "consensus": { "equipment_engineer": "match", "maintenance_engineer": "match", "agreed": true },
      "recommended_fix": "Photos appear correctly repaired — confirm by vision. Separately, resolve the leftover 'H' Cheese-Curl template step ('not yet implemented') on this placard.",
      "action_priority": "low" }
  ]
}
```
