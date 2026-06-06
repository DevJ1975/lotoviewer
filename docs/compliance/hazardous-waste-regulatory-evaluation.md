# Hazardous Waste Module — Regulatory Evaluation (Federal & Cal/OSHA)

**Date:** 2026-06-06
**Scope:** `packages/core/src/hazardousWaste.ts`, migrations 138–142 & 212, the
`/hazardous-waste` web surface, and the published module manual.
**Frameworks evaluated:**

- **Federal EPA / RCRA** — 40 CFR Parts 260–273 (generator standards, container
  management, manifests, LDR, universal waste, used oil).
- **Federal OSHA** — 29 CFR 1910.120 (HAZWOPER), 1910.1200 (HazCom).
- **California DTSC** — 22 CCR Division 4.5 (Title 22 hazardous waste control).
- **Cal/OSHA** — 8 CCR 5192 (HAZWOPER), 5194 (HazCom), 5191 (lab standard),
  3220 (Emergency Action Plan).

> **Not legal advice.** This is an engineering compliance evaluation of what the
> software models and computes. Generator category, waste type, facility
> activity, CUPA expectations, and state rules change what a site must do.
> Verify every cited rule against the current official source before acting on
> it — the same caution the module itself prints to users.

---

## 1. Executive summary

The module is genuinely strong. The data model (streams → containers →
areas → inspections), the static catalogs (field checks, calendar, document
packets), the multi-tenant RLS, the audit triggers, and the deliberate
"a draft is not a submission" posture are all well above the bar for an EHS
SaaS. The pure date helpers are correct and well-tested, and the manual is
honest about where the software stops and the regulated party's
responsibility begins.

The findings below are **gaps and refinements**, not a teardown. They cluster
into three themes:

1. **Area-aware accumulation clocks** — the single most consequential
   correctness issue. *(Fixed in this PR.)*
2. **California-forward claims vs. California rules** — the product bills
   itself as California-forward, but a few defaults are federal-only and are
   *wrong for California* (notably VSQG handling).
3. **Missing bright-line obligations** — satellite 3-day rule, on-site
   quantity caps, Land Disposal Restrictions, LQG contingency/Quick Reference
   Guide, and RCRA personnel training are referenced in prose but not modeled
   as data or computed deadlines.

Priorities are summarized in §6.

---

## 2. What the module already gets right

Credit where it is due — these are correct and should be preserved:

| Area | Evidence | Standard |
| --- | --- | --- |
| LQG / SQG / long-haul accumulation limits (90 / 180 / 270 days) | `baselineLimitDays`, `containerAgeStatus` | 40 CFR 262.16(f), 262.17 |
| Future/invalid start dates surfaced as `unknown`, not silently aged | `containerAgeStatus` edge cases + tests | data integrity |
| Biennial report due March 1 of even years for the prior odd year | `nextBiennialDueDate` + tests | 40 CFR 262.41 |
| SAA guideposts (55 gal / 1 qt acute / 1 kg solid acute) stated to the field | `saa-volume-under-limit` check, manual Step §Satellite | 40 CFR 262.15(a) |
| Manifest is a *preparation packet*, never presented as a valid shipping doc | `HAZARDOUS_WASTE_DOCUMENT_PACKETS`, manual Step 8 | 40 CFR 262 Subpart B / e-Manifest |
| Critical-fail findings come from the server-side catalog (client can't downgrade) | hub page note, `findingsFromDraft` | audit integrity |
| Cross-tenant container/stream guard at the schema level | `hazardous_waste_container_guard()` | defense in depth |

---

## 3. Federal RCRA evaluation

### 3.1 Container accumulation clock was not area-aware — **FIXED (this PR)**

**Finding (was P0).** `ageStatusForContainer()` applied the generator-category
clock (90 / 180 / 270 days) to **every** area type. That is correct only for
*central accumulation*. It produced both false positives and false negatives:

- **Universal waste** has a **1-year** limit (40 CFR 273.15 / 273.35), not 90
  days. A lamp box bound to an LQG stream was flagged `OVER LIMIT` at 91 days
  when the handler legitimately has up to a year — and a genuinely
  >1-year-old box bound to a VSQG stream was shown as "no limit" and never
  flagged at all (a missed compliance condition).
- **Used oil** is managed under 40 CFR 279 and has no dated accumulation clock;
  the 90-day flag was simply wrong.
- **Satellite accumulation** has **no time limit** until the volume cap is
  exceeded (40 CFR 262.15); applying a 90-day clock to a drum that may sit for
  many months below the cap manufactured false alarms.

**Fix shipped here.** `ageStatusForContainer()` now dispatches on
`container.area_type`:

- `central_accumulation` → federal generator clock (unchanged).
- `universal_waste` → new `universalWasteAgeStatus()` (1-year limit,
  `UNIVERSAL_WASTE_LIMIT_DAYS = 365`, 30-day warn window).
- `satellite_accumulation` / `used_oil` / `inspection_only` → new
  `not_time_limited` status: `ageDays` is still surfaced for context, but no
  false clock verdict is rendered. The shared `ageStatusAgainstLimit()` core
  removes the duplicated date math. Tests added for every branch; full suite
  green (3,395 tests).

### 3.2 Generator category is modeled per *stream*, not per *site* — **P1**

Generator category (VSQG / SQG / LQG) is a **facility-level** determination —
the total hazardous waste generated **across all streams** in a calendar month
(40 CFR 262.13), not a property of one waste stream. The schema puts
`generator_category` on `hazardous_waste_streams` (migration 140), so two
streams at one site can disagree, which is regulatorily incoherent, and the
category cannot be *derived* because monthly generation quantity isn't tracked.

**Recommendation.** Introduce a facility/site profile that owns
`generator_category` (and EPA ID, contacts, jurisdiction). Optionally compute a
*suggested* category from summed monthly generation once quantities are
tracked. Keep a per-stream override only for genuinely multi-site tenants, and
make that override explicit.

### 3.3 On-site quantity caps are not modeled — **P1**

Time limits are tracked; **quantity** caps are not:

- **SQG** may never have **> 6,000 kg** of hazardous waste on site at once
  (40 CFR 262.16(b)). Exceeding it makes the site an LQG.
- **VSQG** may never accumulate **> 1,000 kg** (or **> 1 kg acute**) on site
  (40 CFR 262.14). Exceeding it pushes the site up a category.

The module stores `volume_quantity` + `volume_unit` per container but never
sums them against these caps. **Recommendation:** a site-level on-site-total
roll-up (with unit normalization) that warns as the cap approaches. This is the
quantity analogue of the aging clock already built.

### 3.4 Satellite "3-day move" rule is not computed — **P1**

Once an SAA container exceeds 55 gal / 1 qt liquid acute / 1 kg solid acute,
the generator has **three consecutive calendar days** to mark the excess with
its date and move it to a central accumulation area or off site
(40 CFR 262.15(a)(6)). Today this lives only as a manual checkbox
(`saa-volume-under-limit`) and prose. **Recommendation:** when a satellite
container's `volume_quantity` crosses the cap, start a 3-day move clock
(reuse `ageStatusAgainstLimit` with a 3-day limit and a 1-day warn). This needs
an **acute / extremely-hazardous flag** on the stream to pick the right cap
(see §3.5).

### 3.5 No structured "acute / extremely hazardous" classification — **P2**

The SAA cap (55 gal vs. 1 qt/1 kg), the LQG acute threshold (> 1 kg/month), and
the VSQG acute cap (1 kg) all hinge on whether a waste is **acute hazardous**
(federal P-listed / acute) or **extremely hazardous** (California). Today
`hazards: text[]` is free text, so none of these can be computed.
**Recommendation:** a structured boolean/enum (`is_acute_hazardous`,
`is_extremely_hazardous_ca`) on the stream, feeding the SAA and category logic.

### 3.6 Land Disposal Restrictions (LDR) not tracked — **P2**

Generators must make an LDR determination per waste stream and send a one-time
LDR notification/certification to the TSDF with the **first** shipment of each
stream (40 CFR 268.7). This is a frequent audit finding and is absent.
**Recommendation:** an `ldr_subcategory` / `ldr_notice_sent` field on the
stream and an LDR notice in the manifest packet.

### 3.7 LQG contingency plan + Quick Reference Guide not modeled — **P2**

LQGs must maintain a contingency plan and submit a **Quick Reference Guide** to
local emergency responders, updating it on amendment (40 CFR 262 Subpart M,
specifically 262.262; relocated from 40 CFR 265 Subpart D by the 2016 Generator
Improvements Rule). The manual lists an "emergency response and contingency
plan review packet," but there is no structured record or deadline.
**Recommendation:** a contingency-plan record + a calendar obligation for LQG
tenants (annual review / amendment-triggered QRG re-submission).

### 3.8 RCRA personnel training is not a tracked obligation — **P2**

RCRA personnel training (40 CFR 262.17(a)(7) for LQGs — within 6 months of
assignment and **annually** thereafter) is distinct from Cal/OSHA HAZWOPER
(§5). The manual references training, but there is no calendar item.
**Recommendation:** seed an annual RCRA-training obligation for LQG tenants in
`complianceCalendar.ts` (it already seeds OSHA 300A/ITA and EPCRA Tier II — the
pattern is right there).

---

## 4. California (DTSC / 22 CCR) evaluation

The module is explicitly "California-forward." These are the places where
California diverges from — and is **more stringent than** — the federal program,
and where federal-only defaults are therefore *incorrect* for California.

### 4.1 California does **not** adopt the federal VSQG exemption — **P1 (correctness)**

This is the most important California finding. California adopted the Generator
Improvements Rule (effective for state purposes in 2024) and recognizes the
**VSQG** term, but **did not adopt the federal VSQG conditional exemption**: a
California VSQG must comply with **SQG** requirements, including accumulation
**time limits** (22 CCR 66262.16 / 66262.13).

The code treats `vsqg` as "no federal time limit → `unknown`"
(`baselineLimitDays` returns `null`). That is correct for a federal-only site
but **wrong for California** — exactly the audience the module targets. A
California VSQG drum that should be on the SQG 180-day clock currently shows
"No start date / no limit" and is never flagged.

**Recommendation.** Thread a **jurisdiction** dimension (tenant- or
site-level: `federal` vs `california`, extensible to other authorized states).
For `california`, map VSQG → SQG accumulation rules. This is a design decision
for the EHS owner (per-tenant vs per-site jurisdiction), so it is flagged
rather than silently implemented. Until then, the containers page should not
imply a California VSQG is unlimited.

### 4.2 California waste codes are not distinguished from EPA codes — **P1**

California requires **both** the federal EPA waste codes (D/F/K/P/U) **and** the
California-specific **three-digit** waste codes (e.g., 134, 221, 791) on
manifests for California-regulated wastes, and California regulates **non-RCRA
("California-only") hazardous wastes** that have no federal code at all. The
schema stores a single flat `waste_codes: text[]`, which cannot represent dual
coding or validate against either list.

**Recommendation.** Split into `epa_waste_codes` + `ca_waste_codes` (or tag each
code with its system), and add a reference catalog for validation/auto-complete.
This also unblocks correct manifest generation for California shipments.

### 4.3 California universal waste is broader and has its own categories — **P2**

California's universal waste program covers **eight** categories — batteries,
**electronic devices**, mercury-containing equipment, lamps, **CRTs**, **CRT
glass**, **aerosol cans**, and **PV modules** (22 CCR 66273.1) — well beyond the
federal list. The module has a single `universal_waste` area type with no
sub-category. The 1-year clock (now fixed in §3.1) is shared federal/California,
but the *handler requirements* differ by category.

**Recommendation.** Add a universal-waste sub-type enum (driven by jurisdiction)
so labels, handler requirements, and the inspection checklist can specialize —
e.g., e-waste/CRT handling vs. lamps.

### 4.4 California manifest copy & EPA ID verification workflows — **P2**

California has historically had additional manifest-copy submission
expectations and requires periodic **EPA ID verification / renewal** and a
generator fee (administered via CDTFA/DTSC). The "California Annual Facility
Report support file" calendar item is vague about which obligation it maps to.
**Recommendation:** pin the calendar item to the specific DTSC obligation
(verification questionnaire / fee / LQG report to DTSC) and confirm against
current DTSC instructions, which the manual already advises.

### 4.5 Used oil — California-specific management standards — **P3**

Used oil is managed under 22 CCR 66279 in California (rebuttable presumption of
mixing with halogenated solvents at > 1,000 ppm total halogens, "Used Oil"
labeling, recycling standards). The `used_oil` area type exists but carries no
California-specific handling. Low priority but worth a note in the manual.

---

## 5. Cal/OSHA (8 CCR) worker-protection evaluation

The user explicitly asked about **Cal/OSHA**. Hazardous-waste records are also
worker-protection records. The manual's "Cal/OSHA Worker-Protection Context"
section is good prose; the gap is that none of it is **operationalized**.

### 5.1 HAZWOPER applicability is described but not triaged — **P2**

Cal/OSHA HAZWOPER (8 CCR 5192, mirroring 29 CFR 1910.120) applies to TSD
operations, corrective actions, voluntary cleanups, and **emergency response**
to hazardous substance releases — but **not** to routine, in-control generator
accumulation and inspection by trained staff. This distinction is the single
most-confused point in practice. The module references "HAZWOPER applicability
review" but offers no decision aid.

**Recommendation.** A small applicability/triage helper (pure function, like
the confined-space and working-at-heights helpers already in `packages/core`)
that classifies an activity as *routine generator work* vs. *HAZWOPER-covered*,
and, when covered, surfaces the required training tier:

- 40-hour (general site workers) + 3 days supervised field experience,
- 24-hour (limited exposure) ,
- **8-hour annual refresher** (5192(e)(8)) — a recurring deadline,
- 8-hour supervisor,
- emergency-responder tiers under 5192(q) (Awareness / Operations / HazMat
  Technician / Specialist / Incident Commander).

### 5.2 Incidental release vs. emergency response — no decision aid — **P2**

Under 5192(q), an **emergency response** to an uncontrolled release requires a
written Emergency Response Plan and trained responders; an **incidental** spill
that staff can safely clean in their work area does not. The field checklist has
"emergency contacts and spill instructions are available," which is good, but
there is no aid that helps a worker decide *evacuate-and-call* vs. *clean-it-up*.
**Recommendation.** A short, embedded decision aid (and a link to the site ERP),
tied to the spill/incident workflow already in the Incident module.

### 5.3 Annual recurring training deadlines aren't surfaced — **P2**

HAZWOPER 8-hour refresher (5192(e)(8)) and RCRA personnel training (§3.8) are
both **annual**. Neither appears in `complianceCalendar.ts`. **Recommendation:**
seed them as `annual` obligations gated on the hazardous-waste module +
jurisdiction, alongside the existing OSHA/EPCRA seeds.

### 5.4 HazCom / lab-standard linkage is correct as prose — **OK**

Hazardous waste in RCRA-regulated containers is exempt from HazCom labeling
under 8 CCR 5194(b) (it's labeled under RCRA instead), and lab-generated waste
ties to the lab standard (8 CCR 5191). The manual handles this correctly; no
change needed beyond keeping the cross-module links live.

---

## 6. Prioritized recommendations

| # | Recommendation | Standard | Priority | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Area-aware accumulation clocks (UW 1-yr; satellite/used-oil not time-clocked) | 40 CFR 273.15, 262.15, 279 | **P0** | S | ✅ done (this PR) |
| 2 | California VSQG = SQG rules (add jurisdiction dimension) | 22 CCR 66262.16 | **P1** | M | open |
| 3 | Facility/site profile owns generator category (+ derive from monthly qty) | 40 CFR 262.13 | **P1** | M | open |
| 4 | On-site quantity caps (SQG 6,000 kg / VSQG 1,000 kg / 1 kg acute) | 40 CFR 262.14, 262.16 | **P1** | M | open |
| 5 | Satellite 3-day move clock once volume cap exceeded | 40 CFR 262.15(a)(6) | **P1** | S–M | open |
| 6 | Split EPA vs. California waste codes (+ catalog/validation) | 22 CCR 66262 / manifest | **P1** | M | open |
| 7 | Structured acute / extremely-hazardous flag on streams | 40 CFR 262.15, 22 CCR | **P2** | S | open |
| 8 | LDR determination + one-time notice tracking | 40 CFR 268.7 | **P2** | M | open |
| 9 | LQG contingency plan + Quick Reference Guide record & deadline | 40 CFR 262.262 | **P2** | M | open |
| 10 | RCRA personnel training annual obligation (calendar seed) | 40 CFR 262.17(a)(7) | **P2** | S | open |
| 11 | HAZWOPER applicability triage + 8-hr refresher deadline | 8 CCR 5192 | **P2** | M | open |
| 12 | Incidental-vs-emergency spill decision aid | 8 CCR 5192(q) | **P2** | S | open |
| 13 | California universal-waste sub-categories (e-waste/CRT/aerosol/PV) | 22 CCR 66273.1 | **P2** | M | open |
| 14 | California EPA-ID verification / fee calendar mapping | DTSC | **P2** | S | open |
| 15 | California used-oil management notes | 22 CCR 66279 | **P3** | S | open |

`S` ≈ hours, `M` ≈ a day or two, given the existing patterns.

**Suggested next slice (highest value : lowest risk):** #5 (satellite 3-day
clock) and #7 (acute flag) pair naturally and reuse the `ageStatusAgainstLimit`
core shipped here; #10 (RCRA training calendar seed) is a one-line addition to
an established pattern. #2 (California VSQG) is the most *important* correctness
item but needs a jurisdiction design decision first — recommend confirming
tenant-vs-site jurisdiction scope before building.

---

## 7. What this PR changes

Code (the P0 correctness fix only — everything else is left as recommendations
for the domain owner to prioritize):

- `packages/core/src/hazardousWaste.ts`
  - `ageStatusForContainer()` is now **area-aware** (central / universal waste /
    satellite / used oil / inspection-only).
  - New `universalWasteAgeStatus()` + `UNIVERSAL_WASTE_LIMIT_DAYS` (1-year clock).
  - New `not_time_limited` member on `ContainerAgeStatus` for areas with no
    dated clock (distinct from `unknown`).
  - Extracted `ageStatusAgainstLimit()` shared core; `containerAgeStatus()`
    delegates to it (behavior unchanged — existing tests still pass).
- `apps/web/app/hazardous-waste/containers/page.tsx` — renders the new status
  and corrects the header copy.
- `apps/web/__tests__/lib/hazardousWaste.test.ts` — adds coverage for the
  universal-waste clock and the area-aware dispatch.

No schema migration is required for the fix.

---

## 8. References (verify current versions before acting)

- 40 CFR Part 262 — generator standards (262.13 categories, 262.14 VSQG, 262.15
  satellite, 262.16 SQG, 262.17 LQG, 262.41 biennial report, Subpart M
  contingency/QRG): <https://www.ecfr.gov/current/title-40/chapter-I/subchapter-I/part-262>
- 40 CFR 262.15 — satellite accumulation: <https://www.ecfr.gov/current/title-40/chapter-I/subchapter-I/part-262/subpart-A/section-262.15>
- 40 CFR 262.262 — copies of contingency plan (Quick Reference Guide): <https://www.ecfr.gov/current/title-40/chapter-I/subchapter-I/part-262/subpart-M/section-262.262>
- 40 CFR Part 268 — Land Disposal Restrictions.
- 40 CFR 273.15 — universal waste accumulation time limits: <https://www.ecfr.gov/current/title-40/chapter-I/subchapter-I/part-273/subpart-B/section-273.15>
- 40 CFR Part 279 — used oil management standards.
- EPA — Categories of Hazardous Waste Generators: <https://www.epa.gov/hwgenerators/categories-hazardous-waste-generators>
- EPA — Generator Improvements Rule: <https://www.federalregister.gov/documents/2016/11/28/2016-27429/hazardous-waste-generator-improvements-rule>
- DTSC — Hazardous Waste Generator Requirements: <https://dtsc.ca.gov/hazardous-waste-generator-requirements-fact-sheet/>
- DTSC — Universal Waste fact sheet (eight California categories): <https://dtsc.ca.gov/universal-waste-fact-sheet/>
- 22 CCR 66262.16 (California VSQG → SQG requirements) — Title 22 Division 4.5.
- Cal/OSHA 8 CCR 5192 — HAZWOPER: <https://www.dir.ca.gov/title8/5192.html>
- Cal/OSHA 8 CCR 5194 — Hazard Communication: <https://www.dir.ca.gov/title8/5194.html>
- Cal/OSHA 8 CCR 5191 — Laboratory standard: <https://www.dir.ca.gov/title8/5191.html>
