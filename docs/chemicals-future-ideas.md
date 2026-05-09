# Chemical Management — future ideas backlog

Captured 2026-05-08 after the Phase A → G ship and the devjr audit pass.
None of these are bugs; they're real gaps or high-leverage adds. Effort
is a rough read for planning, not a commitment. Group ordering reflects
my read on payoff/effort ratio at the time of writing — re-prioritize
based on customer signal.

## My top 3 if only three get done

1. **First-aid emergency mode** on the scan flow — high field-worker
   value, low effort, differentiator vs competitors.
2. **SDS revision diff summary** (AI) — the drift monitor exists;
   without a summary, reviewers ignore it because reading two PDFs is
   too much work.
3. **Risk Assessment auto-link** — closes the obvious "I have 200
   chemicals, what's my top risk?" question customers ask in the first
   sales call.

---

## Compliance gaps still open

| Suggestion | Why it matters | Effort |
|---|---|---|
| **Waste manifest (RCRA Subtitle C)** | The `manifest_id` field is already a placeholder on `chemical_inventory_items`. Real value is the e-Manifest XML for disposed containers. EPA requires this for hazardous waste generators. | Medium — schema in place, needs UI + EPA submission flow |
| **DOT shipping placards** | NFPA 704 ships already; DOT hazard class diamonds for transport are different (UN number, packing group). Tier II already captures `dot_un_number` etc. | Low — extend the placard renderer |
| **1910.1020 exposure record retention** | OSHA requires 30 yrs post-employment on chemical exposure records. `chemical_exposure_events` captures it; needs a "do not delete" enforcement + per-employee export. | Low — RLS policy + export view |
| **EPCRA Tier I (summary)** | Tier II (detail) ships. Tier I is the per-category summary required where Tier II is overkill. | Low — same source data, different rollup view |
| **TRI Form R (40 CFR 372)** | Chemicals over the de minimis threshold need annual EPA reporting. Stop-the-bleed feature for facilities >10 employees. | High — separate report logic, EPA submission |

## Operational features that pay off fast

| Suggestion | Why it matters | Effort |
|---|---|---|
| **Bulk SDS import** | Drag a folder of PDFs → AI parses each → review queue populated. The friction-reducer for tenants migrating off paper SDS binders. | Medium — multipart upload + queue depth |
| **Reorder points / par levels** | Per-product min stock. Webhook fires when inventory < threshold; rolls into the dashboard "Procurement" tile. | Low |
| **First-aid emergency mode** | Scan a barcode in panic, see ONLY first-aid + spill cleanup + emergency phone. Big-button UI. Field workers need this. | Low |
| **Container split/decant logging** | Parent → child barcode relationship when transferring 5 gal of acetone from a drum into 4 bottles. Solves chain-of-custody for partially-filled containers. | Medium — recursive lineage in inventory table |
| **Duplicate detection on product add** | Fuzzy match against existing catalog (pg_trgm on name already in place). Prevents 14 entries for "Acetone" / "ACETONE" / "Acetone 99%". | Low |

## Cross-module integrations (within Soteria itself)

| Suggestion | Why it matters | Effort |
|---|---|---|
| **Risk Assessment ← chemicals** | Adding a chemical auto-creates a risk register entry seeded from GHS classification. Closes the "what's on site" → "what's our top risk" loop. | Medium |
| **Hot Work flammable-proximity check** | Before issuing a hot-work permit, scan the location for `ghs_pictograms ⊇ {GHS02}`. Blocks permit if flammables within radius without supervisor override. | Medium |
| **Toolbox Talks auto-topic** | Weekly talk auto-suggests "this week's chemical": newest container, drift event, or expiring soon. Already have the data. | Low |
| **Confined Spaces atmospheric pre-check** | If chemicals stored in a confined space have measured PEL data, pre-populate the permit's atmospheric monitoring section. | Low |

## AI / automation leverage

| Suggestion | Why it matters | Effort |
|---|---|---|
| **SDS revision diff summary** | When drift detects a newer revision, AI generates "What changed since v3.1: GHS pictogram added (GHS09), PEL revised 100→50 ppm, new precautionary statements P273 P391". Reviewer sees the delta, not the whole 16-section PDF. | Medium |
| **CAS-based hazard pre-fill** | When a user types a CAS number, look up known hazard data from external CAS registry / ChemSpider so the form is 80% pre-filled before SDS upload. | Medium — needs vendor or open dataset |
| **Camera GHS label OCR** | Point camera at an existing chemical's label, auto-extract product name + manufacturer + GHS pictograms via Claude Vision. Faster than typing. | Low — same Claude Vision pipeline as SDS |

## Data quality

| Suggestion | Why it matters | Effort |
|---|---|---|
| **CAS check-digit validation** | Real CAS numbers have a checksum (last digit). Reject invalid CAS at form-submit time. ~10 lines. | Trivial |
| **H-code / P-code lint** | Validate hazard / precautionary statement codes against the GHS list (H200-H335, P101-P501). | Trivial |
| **Required-field profiles** | Per-regulatory-context required-field gates: "Tier II ready" needs CAS + max qty + state of matter; "GHS-compliant label" needs pictograms + signal word + H-statements. Show a per-product completeness % bar. | Low |

## Performance / scale

| Suggestion | Why it matters | Effort |
|---|---|---|
| **Materialized view on Tier II rollup** | `v_chemical_tier_two` recomputes per request. At ~5k containers it'll get slow; refresh nightly via cron. | Low |
| **Batch label printing** | Generate all cabinet placards in one multi-page PDF instead of N round-trips. | Low |
| **Synonym-aware search** | `synonyms text[]` exists on products but search only hits `name`. Add to the GIN trgm index. | Trivial |

## Field UX (mobile is the real test)

| Suggestion | Why it matters | Effort |
|---|---|---|
| **Offline scan queue** | Scanner caches reads in IndexedDB when offline; syncs when back. Critical for warehouses with thin Wi-Fi. | Medium |
| **Quick-add from photo** | Photo an existing label → AI extracts product name / manufacturer / lot → creates a draft container. | Low — same Claude Vision pipeline as SDS |
| **NFPA diamond / GHS pictogram quick-flash** | When scanning a container, the result page should foreground the pictograms + signal word **before** the data table. Visual hierarchy currently buries it. | Trivial |

---

## How to use this list

- Treat as a backlog, not a roadmap. Re-prioritize based on customer
  signal as it comes in.
- "Trivial" rows are cheap quality-of-life wins; consider batching a
  few into a single sprint for a polish pass.
- The compliance gaps are revenue-blockers for specific verticals
  (pharma needs RCRA, manufacturing needs TRI). Sales conversations
  will tell you which to prioritize.
- Anything in the AI section assumes the existing Claude / SDS-parse
  infrastructure; cost-per-call is bounded by the rate limits already
  set up under `parse-sds`.
