# LOTO Photo Audit — Snak King — FLEET provenance sweep

- **Run date:** 2026-06-23
- **Auditors:** loto-food-production-equipment-engineer + loto-snak-king-maintenance-engineer (consensus)
- **Tenant:** Snak King - COI (`ae3f1973-4c3e-4b6e-b91f-9de5ff10529e`) · project `zwtnpyjifbdytlektxlc`
- **Scope:** **all 499 active placards** (`decommissioned is not true`)
- **Access:** READ-ONLY (no rows or storage objects modified)

> **Provenance-level — pixel vision pending.** This environment blocks image downloads (HTTP 403), so
> the sweep judges **photo provenance + data consistency**, not pixels. It flags placards whose isolation
> photo is *non-unique, cross-wired, broken, or wrong-slot* — strong signals that don't need vision — and
> marks anything that needs a pixel look `[VISION PENDING]`. Re-run `/lotoauditors` where egress to
> `*.supabase.co` is allowed to confirm each flagged machine and to grade the within-line shares.

## Executive summary

| Signal | Active placards affected | Severity |
|---|---|---|
| ISO photo shared **across departments** | **251** (20 images) | **high — an isolation point is machine-/area-specific; it cannot be the same across departments** |
| ISO photo shared **within one line** | 158 (22 images) | `[VISION PENDING]` — may be a legit group/combined LOTO or a line of identical units; confirm by pixels |
| Equipment photo shared (any) | 415 (39 images) | medium — wide shots matter less than ISO, but most are non-specific |
| Template-residue energy steps | 33 active (73 steps over 71 equipment IDs incl. decommissioned) | medium — placards carry "not yet implemented" / cross-line template text |
| Broken photo link (key not in storage) | 3 | medium — image 404s in the app |

**Headline:** **409 of 499 active placards (82%) wear an isolation photo that is shared with at least one
other machine** — one image (`SKT-CONV-IP-2.jpg`) is on **89 placards across 7 departments**. Because a
lockout photo must show *this* machine's energy-isolation device, **at most one machine per shared image
can be correct**; the other ~367 ISO instances are unverifiable as-is. The 251 that share *across
departments* are almost certainly wrong. This is a systemic photo-provenance problem, not a handful of
one-offs — the Tortilla-TC1 pilot was representative, not exceptional.

> **Honest caveats.** (1) A shared image may be the *correct* ISO photo for exactly one of its machines —
> provenance can't tell which; vision can. (2) Within-line sharing can be legitimate: e.g. the TC1
> fryer-oil loop (`SKT1-540/550/560/570`) is a documented *combined LOTO group* that may share one
> isolation photo. Those are flagged `[VISION PENDING]`, not auto-failed. (3) Several ISO slots hold an
> equipment ("-EQ") or OEM/stock image instead of an isolation point (see Signal 1b) — a distinct defect.

## Signal 1 — Shared ISOLATION photos (the life-safety signal)

Top shared ISO objects (object · #placards · #departments · severity · sample departments):

| ISO object | placards | depts | severity | sample departments |
|---|---:|---:|---|---|
| `SKT-CONV-IP-2.jpg` | 89 | 7 | **HIGH** | Conveyors, Jensen, Popcorn, Tortilla Tc 1, … |
| `MD14A_IMG_0504-IP.jpg` | 26 | 3 | **HIGH** | Detectors, Jensen Packaging, USDA Packaging |
| `USPK102-CASESEAL-IP.jpg` | 22 | 2 | **HIGH** | Case Sealer, USDA Packaging |
| `SKAP-1501-IP.jpg` | 20 | 3 | **HIGH** | Automated Packaging, Scales, USDA Packaging |
| `SKPO-176-IP.jpg` | 19 | 1 | vision-pending | Pop Chip |
| `SKPK-718-IP.jpg` | 18 | 1 | vision-pending | Discharge Conveyors |
| `LABELER-EQ.jpg` | 17 | 2 | **HIGH** + wrong-slot (EQ in ISO) | Automated Packaging, Jensen Packaging |
| `SKCC-CONV-IP.jpg` | 16 | 4 | **HIGH** | Cheese Curl, Cheese Puff, Pop Chip, USDA Process |
| `BGGN-031-IP.jpg` | 15 | 1 | vision-pending | Building & Grounds |
| `FANUC-PLTZKR-IP-2.jpg` | 15 | 1 | vision-pending | Automated Packaging |
| `LBLR-1-EQ.jpg` | 15 | 1 | vision-pending + wrong-slot | Automated Packaging |
| `SHGN-170-IP-2.jpg` | 15 | 1 | vision-pending | Shipping |
| `SKPK-401-IP.jpg` | 14 | 1 | vision-pending | Weight Feeder Fastback |
| `FOCKE-1-IP.jpg` | 14 | 1 | vision-pending | Automated Packaging |
| `SKCC-DISCONNECT-IP.jpg` | 12 | 4 | **HIGH** | Cheese Curl, Cheese Puff, Snakking 200, USDA Packaging |
| `SKCC-FRYER-IP.jpg` | 7 | 2 | **HIGH** | Tortilla Tc 1, Tortilla Tc 2 *(the pilot's SKT1-550 image)* |
| `JEGN-940-IP.jpg` | 6 | 4 | **HIGH** | Jensen, Popcorn, USDA Packaging, USDA Process |
| `SKCC-SEASONER-IP.jpg` | 5 | 4 | **HIGH** | Cheese Puff, Popcorn, USDA Packaging, USDA Process |

…and 24 more shared ISO objects (full split: **20 cross-department objects → 251 placards**;
**22 within-line objects → 158 placards**). The fixer can enumerate each object's placard list from the DB.

## Signal 1b — Shared EQUIPMENT photos & wrong-slot / stock images

Top shared equipment objects:

| EQUIP object | placards | depts | note |
|---|---:|---:|---|
| `SKT-CONV-EQ-2.jpg` | 82 | 7 | generic conveyor wide shot across 7 depts |
| `MD14A_IMG_0503.jpg` | 26 | 3 | metal-detector image |
| `ATLAS-SNK16-EQ-2.jpg` | 21 | 1 | Baggers |
| `USPK102-CASESEAL-EQ.jpg` | 21 | 2 | Case Sealer + USDA Packaging |
| `SKAP-1501-EQ.jpg` | 20 | 3 | |
| `SKPO-101-NPOSK-OEM-EQ.jpg` | 19 | 1 | **OEM/stock image** used as the equipment photo (Pop Chip) |
| `SKCC-CONV-EQ.jpg` | 17 | 4 | |
| `SKCC-FRYER-EQ.jpg` | 10 | 4 | Cheese Curl fryer photo on TC1/TC2/USDA machines *(pilot finding, fleet-wide)* |

**Wrong-slot images:** `LABELER-EQ.jpg` (17×) and `LBLR-1-EQ.jpg` (15×) are equipment ("-EQ") images sitting
in the **isolation** slot — they cannot be lockout-point photos regardless of pixels.

## Signal 2 — Template-residue energy steps

**73 steps across 71 equipment IDs** carry unimplemented template text ("…not yet implemented", "detail
pending", or `CHEESE_MIXER`/`CHEESE_CURL` cross-line residue). **33 are active placards**, concentrated in:

| department | active placards with residue |
|---|---:|
| Jensen | 16 |
| Tortilla Tc 1 | 6 |
| Tortilla Tc 2 | 4 |
| Building & Grounds | 3 |
| Scales | 2 |
| Cheese Puff | 1 |
| Jensen Packaging | 1 |

These are desk fixes (populate the real procedure or remove the stub); none should ship on a live placard.
The remaining ~38 residue equipment IDs are decommissioned or orphaned steps — worth a cleanup pass.

## Signal 3 — Broken photo links (key absent from storage)

| equipment_id | department | broken slot | missing object key |
|---|---|---|---|
| `SKAP-305` | Automated Packaging | equipment | `FOCKE-3-EQ.jpg` |
| `SKAP-903` | Automated Packaging | isolation | `FOCKE-9-IP.jpg` |
| `SKAP-905` | Automated Packaging | isolation | `FOCKE-9-IP.jpg` |

Only 3 fleet-wide — repoint to a real object or re-capture. (Contrast the pilot's `SKT1-500`, which
re-verified as resolving.)

## Per-department rollup

`active` · `on_shared_iso` · `residue (active)`. Sorted by shared-ISO exposure.

| department | active | on shared ISO | residue |
|---|---:|---:|---:|
| Automated Packaging | 94 | 92 | 0 |
| Jensen | 53 | 33 | 16 |
| USDA Packaging | 32 | 30 | 0 |
| Tortilla Tc 2 | 30 | 29 | 4 |
| Tortilla Tc 1 | 33 | 24 | 6 |
| Detectors | 22 | 22 | 0 |
| Building & Grounds | 25 | 20 | 3 |
| Pop Chip | 22 | 20 | 0 |
| Case Sealer | 20 | 19 | 0 |
| Discharge Conveyors | 18 | 18 | 0 |
| Cheese Puff | 22 | 17 | 1 |
| Shipping | 17 | 17 | 0 |
| Weight Feeder Fastback | 14 | 14 | 0 |
| USDA Process | 14 | 12 | 0 |
| Cheese Curl | 20 | 11 | 0 |
| Two Stage Tortilla | 9 | 9 | 0 |
| Popcorn | 7 | 7 | 0 |
| Jensen Packaging | 4 | 3 | 1 |
| Conveyors | 3 | 3 | 0 |
| Kettle Popcorn | 7 | 2 | 0 |
| Scales | 2 | 2 | 2 |
| Mixers | 2 | 1 | 0 |
| Baggers | 22 | 0 | 0 |
| (8 single-machine areas) | 8 | 6 | 0 |

## Machine-readable summary (loto-photo-fixer consumes this)

```json
{
  "run": { "date": "2026-06-23", "tenant": "Snak King - COI", "scope": "499 active placards",
           "level": "provenance", "vision_status": "pending_egress" },
  "totals": {
    "active_placards": 499,
    "iso_shared_placards": 409,
    "iso_shared_cross_department": 251,
    "iso_shared_within_line": 158,
    "equip_shared_placards": 415,
    "template_residue_steps": 73, "template_residue_active_placards": 33,
    "broken_links": 3
  },
  "worst_shared_iso": [
    { "object": "SKT-CONV-IP-2.jpg", "placards": 89, "departments": 7, "severity": "high" },
    { "object": "MD14A_IMG_0504-IP.jpg", "placards": 26, "departments": 3, "severity": "high" },
    { "object": "USPK102-CASESEAL-IP.jpg", "placards": 22, "departments": 2, "severity": "high" },
    { "object": "SKAP-1501-IP.jpg", "placards": 20, "departments": 3, "severity": "high" },
    { "object": "SKCC-CONV-IP.jpg", "placards": 16, "departments": 4, "severity": "high" },
    { "object": "SKCC-DISCONNECT-IP.jpg", "placards": 12, "departments": 4, "severity": "high" },
    { "object": "SKCC-FRYER-IP.jpg", "placards": 7, "departments": 2, "severity": "high" }
  ],
  "wrong_slot_iso": [ "LABELER-EQ.jpg", "LBLR-1-EQ.jpg" ],
  "broken_links": [
    { "equipment_id": "SKAP-305", "slot": "equip", "missing_key": "FOCKE-3-EQ.jpg" },
    { "equipment_id": "SKAP-903", "slot": "iso", "missing_key": "FOCKE-9-IP.jpg" },
    { "equipment_id": "SKAP-905", "slot": "iso", "missing_key": "FOCKE-9-IP.jpg" }
  ],
  "note": "Full per-object placard lists and the 33 residue equipment_ids are recoverable from the DB with the read-only queries used here. No verified field photo is asserted; cross-department shares are high-severity, within-line shares are [VISION PENDING]."
}
```

## Recommended sequencing for the fixer / safety team

1. **Cross-department shared ISO (251 placards, 20 images)** — highest priority. Each image is at best
   correct for one machine; the rest need their own isolation-point photo. Start with `SKT-CONV-IP-2.jpg`
   (89), `MD14A_IMG_0504-IP.jpg` (26), `USPK102-CASESEAL-IP.jpg` (22), `SKAP-1501-IP.jpg` (20).
2. **Wrong-slot ISO** (`LABELER-EQ`, `LBLR-1-EQ`) — an equipment image can never be a lockout photo.
3. **Template-residue steps (33 active)** — desk fixes; remove/populate.
4. **Broken links (3)** — repoint or re-capture.
5. **Within-line shared ISO (158)** — `[VISION PENDING]`: confirm whether each is a legit group LOTO or a
   line of identical units before mass re-capture.
