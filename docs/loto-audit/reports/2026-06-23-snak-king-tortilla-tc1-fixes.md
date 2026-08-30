# LOTO Photo Fix Plan — Snak King — Tortilla TC 1 (pilot) — STAGED ONLY

- **Run date:** 2026-06-23
- **Author:** loto-photo-fixer (consumes the 2026-06-23 lotoauditors pilot report)
- **Tenant:** Snak King - COI (`ae3f1973-4c3e-4b6e-b91f-9de5ff10529e`) · project `zwtnpyjifbdytlektxlc`
- **Source report:** `docs/loto-audit/reports/2026-06-23-snak-king-tortilla-tc1-pilot.md`

> **STAGED ONLY — no production writes.** Every proposal below is a *draft* row shaped for
> `public.loto_audit_changes` (status `pending`). Nothing here mutates `loto_equipment`,
> `loto_energy_steps`, or any storage object. The only sanctioned write path is the existing
> reviewed-and-approved apply RPC reached through the audit review link. This agent stages and asks;
> a qualified human approves.

> **Vision caveat — `[VISION PENDING]`.** This environment's egress proxy blocks all image downloads
> (HTTP 403), so no candidate photo could be pixel-verified. Per `storagePhotoSearch.ts`
> (`findExistingIsoPhoto`), an in-house photo may be promoted to a verified `field` ISO photo **only**
> after a high-confidence vision match. With vision unavailable, no reuse is auto-staged as `field`;
> every reuse option is listed for a reviewer to confirm under `[VISION PENDING]`, and the default
> action is capture-on-site. A watermarked reference placeholder (`buildPlaceholderPhoto`) also cannot
> be generated here — its watermarking + upload need egress — so it is noted as a fallback only.

> **Data correction vs the audit report.** Read-only checks show **all six placards' stored object
> keys (equipment and isolation) resolve to existing objects** — including `SKT1-500`'s ISO. See the
> SKT1-500 block: its `iso_photo_url` and its object **both** sit at the non-tenant-prefixed key, so
> they agree and the image does not 404. The pilot report's "broken link / spurious tenant prefix"
> finding for SKT1-500 is contradicted by live state and is **not** staged as a repoint.

---

## Apply order (safe data fixes first)

The pilot named two "safe data fixes that need no photo re-capture." Live DB changes the picture:

1. **SKT1-220 — remove the leftover `H` (Hydraulic) template stub.** A genuine, low-risk data-cleanup.
   The `H` step is unpopulated CHEESE_MIXER residue ("Procedure for energy type H not yet implemented.");
   hydraulic cover-lift is already described inside the live `E` and `M` steps. Staged as a single
   `step_field_edit` (delete-equivalent) on `loto_energy_steps`. **Apply first** — no photo, no vision.
2. **SKT1-500 — NOT a repoint.** Contrary to the report, the stored `iso_photo_url` already points at an
   existing object, so there is no 404 to fix. The only residual is that the object uses a legacy
   non-tenant-prefixed key (outside the migration-033 RLS folder). Staged as an `ehs_finding`
   documenting the contradiction + recommending RLS-key alignment, with the pixel check left
   `[VISION PENDING]`. **No `iso_photo_url` edit is staged** — editing a URL that already resolves would
   risk pointing it at a key that does not exist.

The remaining four placards (550, 540, 270, 820) require field photo work and are staged as
capture-on-site (life-safety, ISO first), with in-house reuse candidates listed for `[VISION PENDING]`
review.

---

## SKT1-550 — Fryer (Tortilla TC 1) — iso mismatch (cross-wired) · equip mismatch (cross-wired)

- **Current state.** equip = `SKCC-FRYER-EQ.jpg` (Cheese Curl line; also on SKT1-540). iso =
  `SKCC-FRYER-IP.jpg` (Cheese Curl). Both objects exist; both are the wrong *line* (`SKCC` ≠ `SKT1`).
- **In-house candidates found (NOT id-specific, NOT vision-verified).** Fryer ISO: `SKT-FRYER-IP.jpg`,
  `SKT-FRYER-IP-2…8.jpg`. Fryer EQ: `SKT-FRYER-EQ.jpg`, `SKT-FRYER-EQ-2…7.jpg`. These are `SKT-` (TC line)
  not `SKT1-550`-specific, so none can land as a verified field photo without a pixel check.
- **Proposed action — capture-on-site (ISO, life-safety) + reshoot-equipment.** Stop reusing `SKCC-*`.
  Capture SKT1-550's own main fused disconnect and the manual gas-train shutoff (not the SSOV).

  **Staged change 1 — ISO finding (capture-on-site)**
  | field | value |
  |---|---|
  | change_kind | `ehs_finding` |
  | target_table | `loto_equipment` · target_row_pk `SKT1-550` · target_column `iso_photo_url` |
  | old_value | `{ "iso_photo_url": "…/loto-photos/SKCC-FRYER-IP.jpg", "issue": "cross-wired Cheese Curl ISO on a Tortilla TC1 fryer" }` |
  | new_value | `{ "action": "capture_on_site", "subject": "TC1 fryer main fused disconnect + manual gas-train shutoff", "candidate_reuse_pending_vision": ["SKT-FRYER-IP.jpg","SKT-FRYER-IP-2.jpg"], "provenance_if_reused": "field" }` |
  | agent | `FPE` · severity `critical` · status `pending` |
  | rationale | ISO photo is another line's image (SKCC). Cal/OSHA T8 §3314 requires a verified isolation point for THIS machine. `[VISION PENDING]` before any reuse can be promoted to `field`. |

  **Staged change 2 — equipment reshoot**
  | field | value |
  |---|---|
  | change_kind | `ehs_finding` |
  | target_table | `loto_equipment` · target_row_pk `SKT1-550` · target_column `equip_photo_url` |
  | old_value | `{ "equip_photo_url": "…/loto-photos/SKCC-FRYER-EQ.jpg" }` |
  | new_value | `{ "action": "reshoot_equipment", "subject": "TC1 fryer wide shot", "candidate_reuse_pending_vision": ["SKT-FRYER-EQ.jpg"] }` |
  | agent | `FPE` · severity `high` · status `pending` |
  | rationale | Wide shot belongs to the Cheese Curl fryer; reshoot the TC1 unit. `[VISION PENDING]`. |

- `[VISION PENDING]`: confirm any `SKT-FRYER-*` candidate actually shows THIS fryer's disconnect before reuse.

---

## SKT1-540 — Main Oil Pump (Tortilla TC 1) — equip mismatch (cross-wired) · iso low_confidence (own path, pixel pending)

- **Current state.** equip = `SKCC-FRYER-EQ.jpg` (Cheese Curl FRYER on a TC1 PUMP — wrong line *and* wrong
  machine type). iso = `ae3f1973-…/SKT1-540/SKT1-540_ISO_v2.jpg` — correctly tenant-prefixed, id-specific,
  object exists; provenance match, pixels pending.
- **In-house equipment candidates (NOT vision-verified).** `SKT-FRYER-PUMP-EQ.jpg`, `HC-OIL-SYS-EQ.jpg`,
  `SKKC-OILTANK-EQ.jpg` (oil-system EQ images on the line). Pump/oil ISO if ever needed: `SKT-FRYER-PUMP-IP.jpg`,
  `OIL-TRAP-IP.jpg`.
- **Proposed action — reshoot-equipment only; leave ISO as-is pending vision.** The ISO already uses this
  machine's own id-specific key, so no ISO change is staged — only the cross-wired equipment photo.

  **Staged change — equipment reshoot**
  | field | value |
  |---|---|
  | change_kind | `ehs_finding` |
  | target_table | `loto_equipment` · target_row_pk `SKT1-540` · target_column `equip_photo_url` |
  | old_value | `{ "equip_photo_url": "…/loto-photos/SKCC-FRYER-EQ.jpg", "issue": "Cheese Curl fryer photo on a TC1 oil pump" }` |
  | new_value | `{ "action": "reshoot_equipment", "subject": "TC1 main oil pump / fryer-oil-loop", "candidate_reuse_pending_vision": ["SKT-FRYER-PUMP-EQ.jpg","HC-OIL-SYS-EQ.jpg"] }` |
  | agent | `FPE` · severity `high` · status `pending` |
  | rationale | Equipment photo is wrong line and wrong machine type. ISO (`SKT1-540_ISO_v2.jpg`) is the machine's own image — verify by vision but no change staged. `[VISION PENDING]`. |

- `[VISION PENDING]`: (a) confirm `SKT1-540_ISO_v2.jpg` shows the pump disconnect + oil-line isolation;
  (b) confirm any candidate equipment image is THIS pump before reuse.

---

## SKT1-270 — Masa Sheeter 16 Row (Tortilla TC 1) — iso mismatch (generic conveyor, shared) · equip match (own path, pixel pending)

- **Current state.** equip = `ae3f1973-…/SKT1-270/SKT1-270_EQUIP_v2.jpg` — own id-specific key, object exists
  (provenance match, pixels pending). iso = `SKT-CONV-IP-2.jpg` — generic conveyor ISO **shared with SKT1-820**.
  A sheeter (roll/nip + pneumatic + main disconnect) and a conveyor cannot share an isolation point.
- **In-house sheeter ISO candidates (NOT id-specific, NOT vision-verified).** `SKT-SHEETER-IP.jpg`,
  `SKT-SHEETER-IP-2.jpg`, `SKT-SHEETER-IP-3.jpg`.
- **Proposed action — capture-on-site (ISO); stop sharing the conveyor image.** Leave the own-path
  equipment photo untouched.

  **Staged change — ISO finding (capture-on-site)**
  | field | value |
  |---|---|
  | change_kind | `ehs_finding` |
  | target_table | `loto_equipment` · target_row_pk `SKT1-270` · target_column `iso_photo_url` |
  | old_value | `{ "iso_photo_url": "…/loto-photos/SKT-CONV-IP-2.jpg", "issue": "generic conveyor ISO shared with SKT1-820" }` |
  | new_value | `{ "action": "capture_on_site", "subject": "sheeter main disconnect + lockable air-supply valve with bleed for roll/gate cylinders", "candidate_reuse_pending_vision": ["SKT-SHEETER-IP.jpg","SKT-SHEETER-IP-2.jpg","SKT-SHEETER-IP-3.jpg"], "provenance_if_reused": "field" }` |
  | agent | `FPE` · severity `critical` · status `pending` |
  | rationale | A masa sheeter and a conveyor do not share an isolation point; the shared `SKT-CONV-IP-2.jpg` cannot be this sheeter's. Cal/OSHA T8 §3314. `[VISION PENDING]` before any `SKT-SHEETER-IP*` reuse is promoted to `field`. |

- `[VISION PENDING]`: confirm a `SKT-SHEETER-IP*` candidate shows THIS sheeter's disconnect + air valve.

---

## SKT1-500 — Oven (Tortilla TC 1) — report said "missing/404"; LIVE DB says the ISO resolves

- **Current state (verified read-only).** equip = `SKT-OVEN-EQ-2.jpg` (object exists). iso_photo_url =
  `…/loto-photos/SKT1-500/SKT1-500_ISO_2026-04-20T22-27-41Z.jpg`, and an object exists at **exactly** that
  key (1,044,665 bytes, created 2026-04-20). The tenant-prefixed variant
  (`ae3f1973-…/SKT1-500/…`) does **not** exist. So the URL and object agree → **no 404**.
- **Contradiction with the pilot report.** The report (and the task brief) described the stored URL as
  carrying a spurious `ae3f1973-…/` prefix with the real object non-prefixed. Live state is the reverse:
  the URL is already non-prefixed and points at the real object. **No repoint is warranted, and none is
  staged** — editing a URL that already resolves risks breaking it.
- **Residual (low-severity).** The object uses a legacy flat key outside the migration-033 tenant-UUID-first
  RLS folder (unlike 270/540, which are correctly prefixed). This is a storage-convention/RLS-alignment
  item, not a placard outage.
- **Proposed action — record a finding; NO photo change.**

  **Staged change — finding (no edit)**
  | field | value |
  |---|---|
  | change_kind | `ehs_finding` |
  | target_table | `loto_equipment` · target_row_pk `SKT1-500` · target_column *(none)* |
  | old_value | `null` |
  | new_value | `{ "report_claim": "iso link broken (404, spurious tenant prefix)", "live_finding": "iso_photo_url and object BOTH at non-prefixed SKT1-500/SKT1-500_ISO_2026-04-20T22-27-41Z.jpg; object exists; URL resolves", "residual": "legacy flat key outside migration-033 tenant-UUID-first RLS folder", "recommended": "no URL edit; optional RLS-key alignment (copy object under ae3f1973-…/SKT1-500/ then repoint) as a separate, reviewed storage task" }` |
  | agent | `EHS` · severity `low` · status `pending` |
  | rationale | The pilot's broken-link verdict is contradicted by live state; do not stage a repoint. Flag the non-prefixed legacy key for optional RLS alignment. `[VISION PENDING]` only to confirm the ISO depicts the gas manual shutoff + main disconnect. |

- `[VISION PENDING]`: confirm `SKT1-500_ISO_2026-04-20T22-27-41Z.jpg` shows the gas manual shutoff + main disconnect.

---

## SKT1-820 — FastBack to Seasoning 1 (Tortilla TC 1) · Heat and Control — iso low_confidence (generic, shared) · equip low_confidence (generic)

- **Current state.** equip = `SKT-CONV-EQ-2.jpg` (generic conveyor, class-consistent). iso = `SKT-CONV-IP-2.jpg`
  (generic conveyor ISO **shared with SKT1-270**). Class-plausible but a shared representative shot, never
  this unit's own labeled disconnect → never `match` while shared.
- **In-house FastBack candidates (NOT id-specific, NOT vision-verified).** ISO: `FASTBACK-IP.jpg`,
  `FASTBACK-IP-2…5.jpg`, `FASTBACK_IMG_0450-IP.jpg`, `FASTBACK_IMG_0458-IP.jpg`, `FASTBACK_IMG_0463-IP.jpg`,
  `SKT-CONV-IP.jpg/-3/-4`. EQ: `FASTBACK-EQ.jpg` (+ many), `SKT-CONV-EQ.jpg/-3…6`. Manufacturer = Heat and
  Control matches the FastBack family. None is `SKT1-820`-specific.
- **Proposed action — capture-on-site (ISO + equipment); retire shared generic `SKT-CONV-*`.**

  **Staged change 1 — ISO finding (capture-on-site)**
  | field | value |
  |---|---|
  | change_kind | `ehs_finding` |
  | target_table | `loto_equipment` · target_row_pk `SKT1-820` · target_column `iso_photo_url` |
  | old_value | `{ "iso_photo_url": "…/loto-photos/SKT-CONV-IP-2.jpg", "issue": "generic conveyor ISO shared with SKT1-270" }` |
  | new_value | `{ "action": "capture_on_site", "subject": "SKT1-820 labeled disconnect (VFD, 5-min DC-bus; eccentric ~60s coast-down)", "candidate_reuse_pending_vision": ["FASTBACK-IP.jpg","FASTBACK_IMG_0450-IP.jpg","FASTBACK_IMG_0463-IP.jpg"], "provenance_if_reused": "field" }` |
  | agent | `FPE` · severity `high` · status `pending` |
  | rationale | Shared generic image is not this FastBack's own disconnect. Cal/OSHA T8 §3314. `[VISION PENDING]` before any `FASTBACK-*` reuse is promoted to `field`. |

  **Staged change 2 — equipment reshoot**
  | field | value |
  |---|---|
  | change_kind | `ehs_finding` |
  | target_table | `loto_equipment` · target_row_pk `SKT1-820` · target_column `equip_photo_url` |
  | old_value | `{ "equip_photo_url": "…/loto-photos/SKT-CONV-EQ-2.jpg" }` |
  | new_value | `{ "action": "reshoot_equipment", "subject": "SKT1-820 FastBack wide shot", "candidate_reuse_pending_vision": ["FASTBACK-EQ.jpg","SKT-CONV-EQ.jpg"] }` |
  | agent | `FPE` · severity `medium` · status `pending` |
  | rationale | Retire shared generic `SKT-CONV-*`; capture this unit. `[VISION PENDING]`. |

- `[VISION PENDING]`: confirm a `FASTBACK-*` candidate shows THIS FastBack's labeled disconnect before reuse.

---

## SKT1-220 — Shaffer Mixer (Tortilla TC 1) · Shaffer (AMF Bakery Systems) — photos clean; `H` template stub = data-cleanup

- **Current state.** equip = `SKT1-MIXER-EQ.jpg`, iso = `SKT1-MIXER-IP.jpg` — both objects exist; row note
  records a 2026-05-13 repair from prior `SKCC-MIXER` (Cheese Curl) photos. Provenance clean, pixels pending.
  Live energy steps: `E`, `P`, `M`, and a leftover `H` (id `ae407bb6-2fc0-4fdd-98c6-bbd5ff00f0cc`) whose
  body is unpopulated CHEESE_MIXER template text ("(CHEESE_MIXER/H) — detail pending…" / "Procedure for
  energy type H not yet implemented." / "Verification for energy type H not yet implemented.").
  The live `E` step already names the "hydraulic lift pump (if cover lift)" and the `M` step already
  describes the "Hydraulic-lifted cover with stored gravity load," so hydraulic cover-lift is **already
  covered** — the `H` row is pure residue, not a missing energy source.
- **Proposed action — data-cleanup: remove the `H` stub.** No photo change.

  **Staged change — remove H step**
  | field | value |
  |---|---|
  | change_kind | `step_field_edit` |
  | target_table | `loto_energy_steps` · target_row_pk `ae407bb6-2fc0-4fdd-98c6-bbd5ff00f0cc` (equipment `SKT1-220`) |
  | target_column | *(whole-row removal — `energy_type='H'` stub)* |
  | old_value | `{ "energy_type": "H", "step_type": "isolate", "tag_description": "(CHEESE_MIXER/H) — detail pending…", "isolation_procedure": "Procedure for energy type H not yet implemented.", "method_of_verification": "Verification for energy type H not yet implemented." }` |
  | new_value | `{ "action": "remove_step", "reason": "unpopulated CHEESE_MIXER template residue; hydraulic cover-lift already covered in live E + M steps" }` |
  | agent | `DS` · severity `medium` · status `pending` |
  | rationale | A live placard must not carry "not yet implemented" text. The H stub is Cheese-Curl cross-wire residue and is redundant with the existing E/M hydraulic language. If site walkdown finds a *distinct* hydraulic cover-lift isolation not covered by E/M, replace this stub with a real procedure instead of removing it — flagged `[VERIFY ON SITE: distinct hydraulic isolation point?]`. |

- `[VISION PENDING]`: confirm `SKT1-MIXER-EQ.jpg` / `SKT1-MIXER-IP.jpg` show the repaired Shaffer mixer + its disconnect.
- `[VERIFY ON SITE: …]`: whether the Shaffer cover-lift has its own lockable hydraulic isolation distinct from E/M.

---

## Wiring (left for a human)
To make any of these real, route them through the existing staged-change path
(`emitChanges` → `loto_audit_changes` (status `pending`) → audit review link → apply RPC) in
`apps/web/lib/loto/audit/runAudit.ts`. Do NOT add a direct UPDATE to `loto_equipment.iso_photo_url` /
`equip_photo_url` or to `loto_energy_steps`; the only sanctioned write is the reviewed, approved apply RPC.

## Proposal summary
| equipment_id | action | change_kind | target_table.column | severity |
|---|---|---|---|---|
| SKT1-220 | data-cleanup (remove H stub) | step_field_edit | loto_energy_steps (row) | medium |
| SKT1-500 | finding only (no repoint; report 404 disproven) | ehs_finding | loto_equipment (—) | low |
| SKT1-550 | capture-on-site (iso) + reshoot (equip) | ehs_finding ×2 | loto_equipment.iso/equip | critical / high |
| SKT1-540 | reshoot equipment (iso left as own path) | ehs_finding | loto_equipment.equip_photo_url | high |
| SKT1-270 | capture-on-site (iso) | ehs_finding | loto_equipment.iso_photo_url | critical |
| SKT1-820 | capture-on-site (iso) + reshoot (equip) | ehs_finding ×2 | loto_equipment.iso/equip | high / medium |

_All rows status `pending`. No verified `field` photo is fabricated; reuse candidates are listed for
`[VISION PENDING]` reviewer confirmation only. Reference/watermark placeholders not generated (egress blocked)._
