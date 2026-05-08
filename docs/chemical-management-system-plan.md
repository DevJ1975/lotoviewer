# Chemical Management System — Plan

Module plan for adding chemical inventory, GHS labeling, SDS
storage, and AI-assisted SDS lookup + drift monitoring to Soteria
Field. Sits alongside existing EHS modules (LOTO, hot work,
incidents, BBS) and follows the same multi-tenant + RLS patterns.

Status: **proposed** — not yet scheduled. All paths relative to
`apps/web/`.

---

## 1. Goals

- Single source of truth for every chemical present on a tenant's
  sites: who owns it, where it lives, how much, and the active SDS.
- Operators can look up an SDS by name, CAS, manufacturer, or
  barcode in under 5 seconds from the field (offline tolerated for
  reads).
- AI-assisted SDS ingestion: drop a PDF or product name, get a
  parsed, structured record (hazards, PPE, GHS pictograms, exposure
  limits, first aid).
- AI-assisted **drift monitoring**: detect when a manufacturer
  publishes a revised SDS and surface the diff for review before
  the new version becomes the active one.
- GHS-compliant secondary container labels printable from the
  field (Avery / Brother label sizes, plus 8.5×11 placards).
- Reg-ready: HazCom (29 CFR 1910.1200), EPCRA Tier II, fire-code
  HMIS rollups, exposure tracking hooks for incidents.

## 2. Non-goals (v1)

- Real-time air monitoring / IoT sensor ingestion.
- Full waste-manifest e-signing (RCRA hazardous waste). Capture
  fields only; integrate with a waste vendor later.
- DOT shipping papers / placarding for transport.
- Multi-language SDS translation (English-only v1; Spanish v1.1).

---

## 3. Data model

New migration: `089_chemicals_module.sql`. All tables
`tenant_id`-scoped with RLS mirroring existing modules
(`027_multi_tenant_schema.sql` patterns).

### 3.1 Core tables

- `chemical_products` — the catalog row. One per
  manufacturer+product+revision. Shared across locations.
  - `id`, `tenant_id`, `name`, `manufacturer`, `product_code`
  - `cas_numbers text[]`, `synonyms text[]`
  - `physical_state` (solid/liquid/gas/aerosol)
  - `ghs_pictograms text[]` (GHS01..GHS09)
  - `ghs_signal_word` (`danger` | `warning` | null)
  - `hazard_statements jsonb` (H-codes + text)
  - `precautionary_statements jsonb` (P-codes + text)
  - `nfpa_health|flammability|instability|special` (0–4, plus
    HMIS equivalents)
  - `ppe_required text[]`
  - `flash_point_c`, `boiling_point_c`, `vapor_pressure_kpa`
  - `pel_twa_ppm`, `stel_ppm`, `idlh_ppm` (NIOSH/OSHA limits)
  - `first_aid jsonb`, `firefighting jsonb`, `spill_cleanup jsonb`
  - `storage_class`, `incompatibilities text[]`
  - `dot_un_number`, `dot_hazard_class`, `dot_packing_group`
  - `sds_revision_date`, `sds_source_url`
  - `active_sds_id` → `chemical_sds_documents.id`
  - `created_at`, `updated_by`, `archived_at`

- `chemical_sds_documents` — every SDS PDF we've stored, with
  full version history (never overwrite — append + supersede).
  - `id`, `tenant_id`, `product_id`
  - `revision_date`, `language` (default `en`)
  - `storage_path` (Supabase `chemical-sds` bucket)
  - `file_hash` (sha256 — dedupe + change detection)
  - `parsed_payload jsonb` (raw AI extraction, kept for audit)
  - `parse_model`, `parse_confidence`, `parse_review_status`
    (`pending` | `approved` | `rejected`)
  - `superseded_by`, `superseded_at`, `superseded_reason`
  - `source` (`upload` | `ai_fetch` | `manufacturer_portal`)

- `chemical_inventory_items` — physical containers on site.
  - `id`, `tenant_id`, `product_id`
  - `location_id` (FK to a new `chemical_locations` table:
    building → room → cabinet/shelf)
  - `department_id` (reuse existing `departments`)
  - `barcode` (unique within tenant; printed on label)
  - `quantity`, `unit` (gal, L, kg, lb, ea)
  - `container_type` (drum, IBC, pail, bottle, aerosol, …)
  - `received_date`, `opened_date`, `expiration_date`
  - `lot_number`, `manufacture_date`
  - `status` (`in_stock` | `in_use` | `empty` | `disposed` |
    `quarantined`)
  - `assigned_to` (worker), `purchase_order`, `cost_cents`
  - `disposed_at`, `disposed_method`, `manifest_id` (nullable)

- `chemical_locations` — hierarchical tenant locations (path-
  encoded with `ltree` or `parent_id`). Reuse for all modules
  later if useful.

- `chemical_label_prints` — audit of every secondary-container
  label printed (who, when, which template, what content).

- `chemical_sds_revision_checks` — log of each AI drift check.
  - `product_id`, `checked_at`, `latest_revision_found`,
    `diff_summary`, `requires_review`, `triggered_by`
    (`schedule` | `manual`).

- `chemical_exposure_events` — link to `incidents` when a
  chemical is implicated. Stores route (inhalation, skin, …),
  duration, dose estimate. Feeds OSHA 300 logic that already
  exists in `065_osha_compliance.sql`.

### 3.2 Reporting views

- `v_chemical_tier_two` — EPCRA Tier II rollups (per location,
  per CAS, max + average daily quantity). Materialized, refreshed
  nightly via `056_cron_runs.sql`.
- `v_chemical_hmis_by_room` — placard data for each room.
- `v_chemical_expiring_30d` — feeds dashboard alert.

---

## 4. AI features

Extend `047_ai_invocations.sql` so every call below is logged
(model, tokens, cost, tenant, user, latency, outcome). Same
pattern as the existing photo-validation and support-assistant
flows.

### 4.1 SDS PDF → structured record

- Trigger: user uploads a PDF, or pastes a URL, or scans a
  barcode that resolves to one.
- Pipeline:
  1. Server route `app/api/chemicals/parse-sds/` accepts
     upload, hashes it, writes to `chemical-sds` bucket.
  2. Extract text via `pdfjs` (already a dep) — **do not** send
     the raw PDF; send extracted text + page-1 image.
  3. Claude Sonnet with a strict JSON schema (zod-validated)
     covering all fields in §3.1.
  4. Confidence per field (model self-rates). Anything below
     threshold lands in a "needs review" queue at
     `app/chemicals/review/page.tsx`.
  5. On approve, write `chemical_products` row + set
     `active_sds_id`. Past versions retained, never overwritten.

### 4.2 SDS lookup by name / CAS / manufacturer

- `app/api/chemicals/lookup/`:
  - First check tenant's own catalog.
  - Then check a tenant-wide cached "global catalog" of
    previously parsed SDSs (cross-tenant, scrubbed of any custom
    fields). Big cost saver.
  - Last resort: AI web research with allowlisted domains
    (manufacturer site, NIOSH WISER, PubChem, ECHA, OSHA
    chemical sampling). Refuse arbitrary web crawl. Surface
    sources to the user.
  - Result is *proposed*, never auto-saved. User confirms.

### 4.3 SDS drift monitoring

- Nightly cron (`056_cron_runs.sql` infra) iterates products
  whose `sds_revision_date` is older than 365 days **or** whose
  `sds_source_url` host is in a watched list.
- For each: AI fetches the source URL, extracts the revision
  date, compares to stored. If newer:
  1. Download new PDF, parse via §4.1 pipeline.
  2. Compute structured diff (changed H-codes, PPE, exposure
     limits, pictograms).
  3. Insert new `chemical_sds_documents` row with
     `parse_review_status = 'pending'`.
  4. Notify tenant safety lead (existing push +
     `057_email_log.sql` channels). Old SDS stays active until
     review approves the new one.
- Diff is the headline UI: "PEL changed from 50 → 25 ppm",
  "Pictogram GHS08 added".

### 4.4 Guardrails

- Every AI extraction stores its source text; humans can audit.
- Refuse to mark an SDS active if any of: signal word missing,
  zero pictograms on a non-trivial product, no H-codes. Forces
  manual review.
- Cost ceiling per tenant per month, surfaced in
  `app/superadmin/`.
- Cache aggressively by `file_hash` and source URL.

---

## 5. Labeling system

### 5.1 Templates

- **Secondary container** (workplace label, HCS-compliant):
  product name, GHS pictograms, signal word, hazard statements,
  PPE icons. Default 4×6 in (Brother QL-820), with 2×4 and 1×3
  variants.
- **Primary placard** (room/cabinet): aggregate NFPA 704
  diamond + HMIS bar, top hazards, max quantities. 8.5×11.
- **Inventory tag**: barcode + product name + location + lot +
  received date. 2×1 in.

Templates live in `app/chemicals/labels/` as React components
rendered server-side to PDF via `pdf-lib` (already used in
LOTO). SVG pictograms checked into `public/ghs/`.

### 5.2 Print flow

- Field user selects an inventory item → "Print label" → picks
  template + size → preview → print.
- Browser print path for desktop; for Brother/Zebra label
  printers, generate a raw print payload via WebUSB / the
  tenant's print bridge (deferred — v1 = PDF download, manual
  print).
- Every print logs to `chemical_label_prints` (auditor asks
  "show me when this drum got relabeled" — we have the answer).

### 5.3 Pictograms

- Use ILO / UN GHS public-domain SVGs. Never AI-generate
  pictograms — regulatory exact match required.

---

## 6. Field UX

- `app/chemicals/page.tsx` — searchable catalog (name, CAS,
  hazard, location). Filters: pictogram, room, expiring soon,
  needs review.
- `app/chemicals/[id]/page.tsx` — product detail with active
  SDS preview, hazard summary, locations + quantities, version
  history, AI drift status banner.
- `app/chemicals/scan/page.tsx` — barcode/QR scan entry point
  (use `getUserMedia` + `BarcodeDetector`, fallback `zxing`).
  Already shipped scan UX in confined-spaces — reuse the
  component.
- `app/chemicals/review/page.tsx` — queue for AI-parsed SDSs
  awaiting human approval; side-by-side diff for revisions.
- Dashboard tile: count of expiring chemicals + count of SDS
  revisions awaiting review.
- Offline: catalog + SDS PDFs cached via existing service
  worker. Writes (new container, label print) queue and replay.

## 7. Permissions

Reuse `tenant_memberships.role`:

- `safety_admin`: full CRUD, approve AI parses, run drift checks.
- `supervisor`: add/move inventory, print labels, request review.
- `worker`: read SDS, scan inventory, log usage.
- `auditor` (read-only): everything read, including print log.

RLS: all tables filtered by `tenant_id = active_tenant_id()`.
Match the helper from `032_active_tenant_header_scope.sql`.

## 8. Compliance hooks

- **HazCom (1910.1200)**: every product has SDS + label;
  training records via `017_training_records.sql` get a new
  topic `hazcom_chemical_specific`.
- **EPCRA Tier II**: annual export from `v_chemical_tier_two`
  to the state-required CSV/T2S format.
- **OSHA 300/301**: when an incident references a chemical,
  pull exposure fields automatically.
- **Fire code (IFC/IBC)**: max allowable quantities per control
  area — flag when a room exceeds.
- **DOT**: capture UN/hazard class even though we don't ship —
  it's free metadata once the AI parses it.

## 9. Things you didn't list but should consider

1. **Chemical approval workflow** — before a new chemical can
   be ordered/received, safety has to approve. Catches
   "someone bought a banned solvent". Lightweight: a `requested
   → approved → received` state on `chemical_inventory_items`.
2. **Substitution / restricted list** — tenant-maintained list
   of banned or "use alternative" chemicals (Prop 65, REACH
   SVHC, internal greenlist). Block at the approval step.
3. **Compatibility checker** — when assigning a product to a
   storage location, warn if it's incompatible with what's
   already there (acid + base, oxidizer + flammable). Drives
   off `incompatibilities text[]`.
4. **Exposure / usage logging** — workers log who used what,
   how much, where, for how long. Feeds industrial-hygiene
   sampling decisions and chronic-exposure tracking. Cheap to
   add, hard to retrofit.
5. **Emergency response view** — a single screen that, given a
   room, prints first-aid, firefighting, spill, and PPE guidance
   for everything present. Designed for the responding fire
   crew. PWA share-link with no auth, time-boxed token.
6. **Spill kit + eyewash inventory** — same module, different
   item type. Inspection schedules. Often required by code; very
   often missed.
7. **Waste characterization** — when an inventory item is
   disposed, capture characterization codes (D001 ignitable,
   etc.). Sets up future RCRA module without committing to it.
8. **Container barcode generation** — assign a stable internal
   barcode at receipt; the manufacturer's barcode rarely
   survives the warehouse. Print with the inventory tag.
9. **Cost / consumption analytics** — per-department spend,
   shrinkage, expiry write-offs. Same chart pattern as the
   existing department dashboard.
10. **Vendor / manufacturer registry** — separate table; lets
    drift monitoring track "all SDSs from this vendor" and lets
    purchasing dedupe.
11. **PPE matrix per task** — link tasks (JHA steps already
    exist via `043_jha_module.sql`) to chemicals used → derive
    required PPE automatically. Cuts JHA authoring time.
12. **Notifications**: SDS revision available, expiring stock,
    Tier II reporting deadline, training overdue for a chemical
    in the user's department. Reuse `016_push_subscriptions.sql`.
13. **QR code on every label** that deep-links to the SDS view
    — phone camera → SDS in 2 taps, no app install. The single
    highest-leverage feature for floor adoption.
14. **Bulk import** — CSV + existing SDS-PDF folder. Most
    tenants already have a binder or a SharePoint folder; the
    onboarding flow has to ingest it without manual re-entry.
15. **Data retention** — SDSs must be retained for **30 years
    after** the last use of the chemical (1910.1020). Never
    hard-delete; soft-archive only. Document this in the
    privacy/retention page.
16. **Audit trail** — every field change on a product or SDS is
    immutable-logged (extend the pattern from
    `038_risk_audit_log.sql`).
17. **Cross-tenant SDS sharing (opt-in)** — superadmin-toggled
    "contribute parsed SDSs to the shared catalog". Massive cost
    and accuracy win; requires a clear privacy story.
18. **Integration surface** — webhooks (`013_webhooks.sql`) for
    "new SDS revision detected", "chemical approved", "spill
    incident logged". Lets ERP/purchasing systems hook in.

## 10. Phased rollout

- **Phase A — foundation (≈1 sprint)**: migration, `chemicals`
  catalog list + detail pages, manual SDS upload + storage,
  basic search. No AI yet. Ships value on day one.
- **Phase B — AI ingestion (≈1 sprint)**: parse-SDS pipeline,
  review queue, structured fields, confidence scoring.
- **Phase C — labeling (≈1 sprint)**: secondary-container +
  inventory-tag templates, print log, QR deep links.
- **Phase D — inventory & locations (≈1 sprint)**: containers,
  locations, barcodes, scan UX, expiring-soon dashboard.
- **Phase E — drift monitoring (≈0.5 sprint)**: nightly cron,
  diff UI, notifications.
- **Phase F — compliance rollups (≈1 sprint)**: Tier II export,
  HMIS placards, incident exposure linkage, PPE-matrix → JHA.
- **Phase G — extras**: approval workflow, compatibility
  checker, emergency response view, cross-tenant catalog.

Each phase ends with a smoke-test doc in `docs/` matching the
existing pattern (`bbs-smoke-test.md`,
`toolbox-talks-smoke-test.md`).

## 11. Open questions

- Storage budget: SDS PDFs average ~500 KB; 2 000 products ≈ 1
  GB per tenant before revisions. OK on Supabase Storage but
  worth confirming against current plan.
- AI cost per tenant: estimate 200 parses + 2 000 drift checks
  /month → confirm against the `ai_invocations` baseline before
  enabling drift by default.
- Which label printers are actually in use at pilot tenants?
  Drives whether v1 ships PDF-only or invests in a print bridge.
- Do any pilot tenants need French/Spanish SDSs at launch?
  WHMIS (Canada) requires bilingual — relevant if Canadian
  rollout is on the roadmap.
