# Confined Space module for lotoviewer-1

## Context

The user owns a field PWA that today manages LOTO (Lockout/Tagout) procedures for food-production equipment on iPads — equipment inventory, photos, energy-isolation steps, AI-assisted authoring, printable placards. They want a parallel module for **federal OSHA permit-required confined spaces** (29 CFR 1910.146, general industry) inside the same app.

OSHA defines a permit-required confined space (PRCS) as a space large enough to enter, with restricted entry/exit, not designed for continuous occupancy, AND containing a hazardous atmosphere, engulfment hazard, configuration hazard, or other recognized serious hazard. Food-production examples: silos, mixing tanks, hoppers, CIP vessels, ammonia-refrigeration machine rooms, drain pits, sumps, retorts, fermenters, dust-collection plenums.

The standard imposes a documented program with strict permit, training, atmospheric-testing, attendant, and rescue requirements — the kind of paperwork that lives in three-ring binders today and is exactly the use case this app is suited for.

## What OSHA actually requires (the load-bearing list)

Sourced from [29 CFR 1910.146](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.146).

**§1910.146(d) — Written program**: documented procedures for hazard ID, isolation, ventilation, monitoring, attendant assignment, rescue services, permit lifecycle, contractor coordination, annual review.

**§1910.146(f) — The entry permit (15 required elements)**:

1. Space identification (location)
2. Purpose of entry
3. Date and authorized duration (cannot exceed task time)
4. Authorized entrants (named or roster-linked)
5. Attendant(s)
6. Entry supervisor + signature authorizing entry
7. Identified hazards
8. Isolation / control measures (LOTO, purging, inerting, ventilation, flushing)
9. Acceptable entry conditions (atmospheric thresholds + physical)
10. Atmospheric test results — initial **and periodic** — with tester + timestamp
11. Rescue & emergency services contact + equipment
12. Communication method between entrants and attendant
13. Equipment list (PPE, monitors, comms, alarms, rescue gear)
14. Any other relevant safety info
15. Other concurrent permits (e.g., hot work)

**§1910.146(d)(5) — Atmospheric testing order is mandatory**: O₂ → combustible gases (LEL) → toxic gases. Direct-reading calibrated instruments. Acceptable defaults: O₂ 19.5–23.5%, LEL <10%, H₂S <10 ppm, CO <35 ppm.

**§1910.146(g) — Training certification** must record employee name, trainer, date, and be available for inspection.

**§1910.146(k) — Rescue services**: must be designated, evaluated, and informed of hazards. Practice rescue every 12 months. Retrieval system (harness + line) required for vertical entries >5 ft unless it would increase risk.

**§1910.146(d)(14) — Annual program review** using canceled permits retained for at least 1 year.

**§1910.146(e)(5)(6)** — Permits cancelled when entry completes or any prohibited condition arises; canceled permits retained ≥ 1 year.

This is what the data model needs to store, what the UI needs to capture, and what a printed permit must include.

## Data model

Two new tables, plus a small training-cert table.

### `loto_confined_spaces` — inventory (one row per permit space)

| Column | Type | Notes |
| --- | --- | --- |
| `space_id` | text PK | e.g. `CS-MIX-04` |
| `description` | text | "South side mixing tank #4" |
| `department` | text | matches existing `loto_equipment.department` for shared filters |
| `classification` | enum | `permit_required` \| `non_permit` \| `reclassified` |
| `space_type` | enum | tank, silo, vault, pit, hopper, vessel, sump, plenum, manhole, other |
| `entry_dimensions` | text | "24-inch top manway" — informs rescue planning |
| `known_hazards` | text[] | persistent hazards (e.g. `engulfment`, `H2S`, `confined_geometry`) |
| `acceptable_conditions` | jsonb | per-space override of default atmospheric thresholds |
| `isolation_required` | text | written reference to LOTO procedure if applicable |
| `equip_photo_url` | text | reuse photo pipeline |
| `interior_photo_url` | text | second slot |
| `internal_notes` | text | private — same pattern as migration 008 |
| `decommissioned` | boolean | mirrors equipment |
| `created_at` / `updated_at` | timestamptz | |

### `loto_confined_space_permits` — entry permits (many per space)

The 15 required fields from §1910.146(f), normalized:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `space_id` | text FK → `loto_confined_spaces` | |
| `purpose` | text | (f)(2) |
| `started_at` / `expires_at` / `canceled_at` | timestamptz | (f)(3), (e)(5)(6) |
| `entry_supervisor_id` | uuid FK → `profiles` | (f)(6) |
| `entry_supervisor_signature_at` | timestamptz | electronic sign-off |
| `attendants` | uuid[] FK → `profiles` | (f)(5) — array; OSHA allows multi-space attendants |
| `entrants` | uuid[] FK → `profiles` | (f)(4) |
| `hazards_present` | text[] | (f)(7) — checklist values |
| `isolation_measures` | jsonb | (f)(8) — `{type: 'LOTO', ref: 'EQ-123'}`, `{type: 'ventilation', method: 'forced air'}`, etc. |
| `acceptable_conditions_override` | jsonb | (f)(9) |
| `rescue_service` | jsonb | (f)(11) — `{name, phone, eta_minutes, equipment}` |
| `communication_method` | text | (f)(12) — radio, voice, line-of-sight |
| `equipment_list` | text[] | (f)(13) |
| `concurrent_permits` | text | (f)(15) — free text or FK list |
| `notes` | text | (f)(14) |
| `cancel_reason` | enum | `task_complete` \| `prohibited_condition` \| `expired` \| `other` |
| `cancel_notes` | text | required if reason ≠ task_complete |

### `loto_atmospheric_tests` — readings (many per permit)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `permit_id` | uuid FK → permits | |
| `tested_at` | timestamptz | |
| `tested_by` | uuid FK → profiles | (f)(10) tester ID |
| `o2_pct` | numeric | |
| `lel_pct` | numeric | |
| `h2s_ppm` | numeric | nullable |
| `co_ppm` | numeric | nullable |
| `other_readings` | jsonb | `[{name, value, unit, threshold}]` |
| `instrument_id` | text | calibration chain — last calibrated date in metadata |
| `kind` | enum | `pre_entry` \| `periodic` \| `post_alarm` |

A computed view derives acceptable/unacceptable per row by comparing against the permit's effective `acceptable_conditions_override` ?? per-space override ?? site default.

### `loto_training_certs` — §1910.146(g)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid FK → profiles | |
| `role` | enum | `entrant` \| `attendant` \| `supervisor` \| `rescuer` \| `cpr_first_aid` |
| `trained_at` | date | |
| `trainer_name` | text | OSHA requires named trainer |
| `expires_at` | date | nullable; CPR/First-aid expires |
| `cert_doc_url` | text | optional scanned cert |

## Three scope options

### Option A — "Inventory + paper permit" (~1 week)

Just the inventory side. Add `loto_confined_spaces` table, a `/confined-spaces` route mirroring the dashboard layout, photo upload, and a printable blank PRCS permit PDF (matching the OSHA Quick Card layout). Permits stay on paper. Annual review still manual.

**Wins**: lowest risk, fastest to ship, immediately useful (tablet replaces a binder for the inventory).
**Misses**: doesn't capture entries, no atmospheric trail, no annual-review automation.

### Option B — "Inventory + electronic permits" (~2-3 weeks) ← recommended starting point

Everything in A, plus:
- `loto_confined_space_permits` table and a permit-issuance flow (supervisor opens, fills the 15 fields, signs)
- `loto_atmospheric_tests` table with mobile-first reading entry and red/green threshold UI
- AI assist for hazards + isolation suggestions based on space description + photos (mirrors the LOTO step generator we just shipped)
- AI assist for the **acceptable-conditions block** — proposes per-space thresholds based on space type
- PDF permit (filled, electronically signed) attached to the permit record
- "Active permits" view + cancel flow with reason capture

**Wins**: covers the core OSHA paperwork, AI saves real time on hazard authoring, electronic signatures + atmospheric trail give a defensible audit record.
**Misses**: no training-cert UI yet, no annual-review report, no bluetooth atmospheric-meter integration.

### Option C — "Full PRCS program" (~5-6 weeks)

Everything in B, plus:
- `loto_training_certs` table, training-status dashboard, expiring-cert email reminders
- Annual program review report — auto-aggregates the past 12 months of canceled permits, surfaces incidents and prohibited-condition cancellations for sign-off
- Rescue service registry and rescue-drill log (12-month timer per §1910.146(k))
- Multi-employer / contractor coordination notes per permit
- Optional: bluetooth atmospheric monitor pairing (4-gas meters that broadcast readings)
- Optional: post-incident reporting flow tied to permits

**Wins**: a complete federal-OSHA program-management tool, not just paperwork.
**Misses**: significantly larger build; the bluetooth piece in particular is hardware-dependent.

## Recommended path: ship Option B, design with C in mind

Option B captures the high-value paperwork (permits + atmospheric trail) without the long tail of program-administration features. The schema below leaves room to layer C on without migration churn.

## Build plan for Option B

### New routes / files

| Path | Purpose |
| --- | --- |
| `migrations/009_confined_spaces.sql` | Three new tables + RLS using the existing `auth.uid() is not null` pattern from [migrations/003_auth_profiles_audit.sql](migrations/003_auth_profiles_audit.sql) |
| `lib/types.ts` | Add `ConfinedSpace`, `ConfinedSpacePermit`, `AtmosphericTest`, `TrainingCert` interfaces alongside `Equipment` |
| `app/confined-spaces/page.tsx` | Dashboard mirroring [app/page.tsx](app/page.tsx) — sidebar + list + detail panel |
| `app/confined-spaces/[id]/page.tsx` | Single-space detail mirroring [app/equipment/[id]/page.tsx](app/equipment/[id]/page.tsx) — recent permits, photos, edit details, "Issue new permit" |
| `app/confined-spaces/permits/[permitId]/page.tsx` | Permit issuance + active-permit view (the live form during an entry) |
| `app/api/generate-confined-space-hazards/route.ts` | AI hazard + isolation suggester. Same SDK pattern as [app/api/generate-loto-steps/route.ts](app/api/generate-loto-steps/route.ts), Sonnet 4.6, vision, structured output |
| `lib/pdfPermit.ts` | Permit PDF generator mirroring [lib/pdfPlacard.ts](lib/pdfPlacard.ts) |
| `components/confined/SpaceDetailsSheet.tsx` | Edit sheet — same prop pattern as [components/placard/PlacardDetailsSheet.tsx](components/placard/PlacardDetailsSheet.tsx) |
| `components/confined/PermitIssuanceForm.tsx` | The 15-field permit form |
| `components/confined/AtmosphericTestEntry.tsx` | Mobile-first test reading widget with threshold-coloring |
| `components/confined/PermitActivePanel.tsx` | "Live entry" view: shows time elapsed, last reading, periodic-retest reminder, cancel button |
| `lib/csvImportConfinedSpaces.ts` | CSV importer modeled on [lib/csvImport.ts](lib/csvImport.ts) |

### Files to extend (not rewrite)

- [components/AppChrome.tsx:22](components/AppChrome.tsx#L22) — add `{ href: '/confined-spaces', label: 'Confined Spaces' }` to `NAV_LINKS`
- [components/placard/PlacardPhotoSlot.tsx](components/placard/PlacardPhotoSlot.tsx) — already generic; reuse for confined-space photos with a different bucket prefix
- Existing photo bucket `loto-photos` from [migrations/005_storage_loto_photos_rls.sql](migrations/005_storage_loto_photos_rls.sql) — store under `confined-spaces/{space_id}/...` prefix; no new RLS needed

### AI features specific to confined spaces

The hazard authoring problem is harder than LOTO authoring — there are more hazard categories and the wrong call is even more dangerous. Two AI surfaces:

1. **"Generate hazards"** in `SpaceDetailsSheet` — given description + photos + space_type, propose: identified hazards (atmospheric, engulfment, configuration, mechanical), recommended acceptable conditions, recommended isolation methods, recommended PPE/equipment list. Lands as draft fields the user reviews. Disclaimer: "AI suggestions — qualified safety professional must review before issuing a permit."

2. **"Pre-entry checklist"** on the permit form — given the issuing context, suggest a hazard-control checklist. Same draft-row UX as the LOTO step generator we just shipped.

Both routes use Sonnet 4.6, adaptive thinking, vision (pass photos), structured JSON output via `output_config.format`. Reuses the pattern in [app/api/generate-loto-steps/route.ts](app/api/generate-loto-steps/route.ts).

### Permit PDF

Single-page printable matching OSHA's Quick Card layout — sections in order:

1. Space ID + purpose + dates
2. Authorized personnel (entrants / attendants / supervisor + sig)
3. Hazards + isolation methods
4. Acceptable atmospheric conditions
5. Test results table (rows for pre-entry + each periodic re-test)
6. Rescue service contact + equipment
7. Communication + equipment list
8. Concurrent permits + cancellation block

Generate via pdf-lib, mirror the patterns in [lib/pdfPlacard.ts](lib/pdfPlacard.ts).

### Verification

- Apply `migrations/009_confined_spaces.sql` in Supabase SQL Editor
- Seed one space, issue a permit end-to-end: open form → AI suggest hazards → enter atmospheric tests → sign → cancel
- Print the permit PDF, confirm all 15 fields appear and that the test results table includes tester ID + timestamp per row (§1910.146(f)(10))
- Verify RLS by hitting the new tables from an unauthenticated context (should 401)
- Verify a hazardous reading (e.g. O₂ 18%) flips the UI to red and blocks the supervisor sign-off button
- Re-run `bun test` — existing tests should be unaffected since no LOTO files are modified

### Non-goals for this phase

- Training-cert tracking (Option C)
- Annual review automation (Option C)
- Bluetooth meter integration (Option C)
- Real-time multi-attendant chat (out of scope)
- Geofence-based attendant proximity (out of scope)

## Open questions for the user

1. **Branding** — the app is currently "Soteria LOTO Pro." Adding confined spaces broadens the scope. Rename to "Soteria Field Safety" / similar, or keep the LOTO brand and treat confined spaces as a sub-module?
2. **Single team or multi-tenant?** — current RLS is "any authenticated user." If confined-space permits should be department-scoped (so a supervisor in Packaging can't sign Bottling permits), that's a small RLS change but worth deciding upfront.
3. **Scope confirmation** — Option A, B, or C as the starting point? Default recommendation: B.
4. **Electronic signatures** — is "supervisor signs by clicking a button while logged in" sufficient, or do you need a paper-equivalent capture (drawn signature, captured timestamp + IP)?
