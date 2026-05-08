# Chemical Management module — smoke checklist (Phase A)

Use this after applying migration `082_chemicals_module.sql` and
deploying the branch. Phase A ships the foundation: catalog list +
detail, manual SDS PDF upload + storage, search/filter, and module
registration. AI parsing (Phase B), labeling (Phase C), and inventory
items (Phase D) are not in scope for this checklist.

See `docs/chemical-management-system-plan.md` for the full roadmap.

## 0 · Setup

- [ ] Migration 082 applied on a branch DB
      (`supabase migration up` or `apply_migration`)
- [ ] `chemical-sds` storage bucket exists, private, with the four
      tenant-scoped policies (insert / update / delete / read)
- [ ] `npm run build` from repo root passes
- [ ] `npm test` from `apps/web/` passes — confirm
      `__tests__/lib/chemicals.test.ts` is in the run

## 1 · Module registration + drawer

- [ ] Sign in as a member of a tenant with `chemicals` enabled (or
      no explicit override → defaults to enabled)
- [ ] Drawer shows "Chemical Management" with the FlaskConical icon
      and indigo accent
- [ ] Expanding it lists: Add Chemical
- [ ] Clicking the parent navigates to `/chemicals` (catalog list)
- [ ] On a tenant where `modules.chemicals = false`, the drawer
      entry is hidden AND `/chemicals` shows the
      "module isn't enabled for {tenant}" guard screen

## 2 · Empty state + add-chemical flow

- [ ] On a tenant with no products yet, `/chemicals` shows the
      "No chemicals yet — Add the first one" call-to-action
- [ ] "Add chemical" button → `/chemicals/new`
- [ ] Submit with empty Name → browser-required validation blocks
      submit
- [ ] Submit with `name = "Acetone"`, `manufacturer = "Acme"`,
      `cas = "67-64-1"`, signal word `danger`, pictograms
      `GHS02 GHS07`, NFPA 1/3/0 → success → redirected to
      `/chemicals/{id}` detail
- [ ] Detail page shows DANGER pill + GHS02/GHS07 badges +
      NFPA tiles 1/3/0
- [ ] Submit with `cas = "bogus"` → form-level error "Invalid CAS
      number(s): bogus", no row created
- [ ] Submit with `nfpa_health = "9"` → form-level error
      "NFPA Health must be an integer 0..4"

## 3 · Search + filter

- [ ] Add a second product `Methanol` (CAS 67-56-1, GHS02 + GHS06)
      and a third `Sodium Hydroxide` (GHS05)
- [ ] Catalog list shows all three rows, alphabetical by name
- [ ] Counts tile reads `Products: 3`, `With active SDS: 0`,
      `Missing SDS: 3`
- [ ] Type `meth` in search → only Methanol remains (debounced ~250ms)
- [ ] Clear search → all three return
- [ ] Filter by pictogram `GHS06 — Acute toxicity` → only Methanol
- [ ] Filter by `GHS05 — Corrosive` → only Sodium Hydroxide
- [ ] Reset filter to "All hazards" → all three return

## 4 · Manual SDS upload

- [ ] On the Acetone detail page, "Safety Data Sheets" section says
      "No SDS uploaded yet."
- [ ] Set revision date `2025-06-01`, click "Choose PDF", pick a
      real SDS PDF (~500 KB) → upload spinner → list shows one row
      with `2025-06-01` date, ACTIVE pill, file size in KB/MB
- [ ] Catalog list now shows Acetone with no "No SDS" badge,
      "With active SDS" tile increments to 1
- [ ] Try a non-PDF file (e.g. PNG) → 415 error surfaced inline
- [ ] Try a > 25MB PDF → 400 error "File size out of range"
- [ ] Re-upload the SAME PDF → response is dedupe (no duplicate row)
- [ ] Upload a different PDF dated `2026-04-01` → new row inserted
      with ACTIVE pill, the previous row loses ACTIVE and shows
      "superseded {today}"
- [ ] Click "View" on either row → opens a signed URL in a new tab,
      PDF renders, URL expires within ~5 minutes
- [ ] Open the new product in an incognito window without auth →
      `/chemicals/{id}` redirects to login

## 5 · Multi-tenant isolation

- [ ] As tenant A, create chemical `T-A-Only`
- [ ] As tenant B (same user, different active tenant), `/chemicals`
      does NOT show `T-A-Only`
- [ ] As tenant B, `/chemicals/{T-A-Only-id}` returns 404
- [ ] As tenant B, GET `/api/chemicals/products/{T-A-Only-id}` → 404
- [ ] As tenant B, POST `/api/chemicals/products/{T-A-Only-id}/sds`
      with a PDF → 404 "Product not found"

## 6 · Storage path tenant scoping

- [ ] In the Supabase dashboard → Storage → `chemical-sds`, every
      uploaded object's path starts with the uploader's tenant UUID
- [ ] As tenant B, attempting to read tenant A's storage path
      directly via the JS client returns RLS error
- [ ] Superadmin can read any tenant's path

## 7 · Archive

- [ ] On a chemical detail page, click "Archive" → confirm prompt →
      redirected back to the list, the chemical is no longer shown
- [ ] DB row has `archived_at` set; `chemical_sds_documents` rows
      are still present (retention)
- [ ] GET `/api/chemicals/products?include_archived=true` returns
      the archived row

## 8 · Build + lint

- [ ] `npm run lint` from `apps/web/` passes with zero warnings on
      the chemicals folders
- [ ] `npx tsc --noEmit` reports no errors in `app/chemicals/**`,
      `app/api/chemicals/**`, or `packages/core/src/chemicals.ts`
- [ ] Vercel preview deploy completes, page renders correctly with
      the active dark/light theme

## Known follow-ups (not in Phase A)

- AI SDS parsing → Phase B
- Drift monitoring (nightly cron) → Phase E
- Inventory containers + locations + scan → Phase D
- Label printing + GHS pictogram SVGs → Phase C
- HazCom training topic, Tier II export, OSHA 300 linkage → Phase F

If a step fails, file under `docs/incident-uat.md` with screenshot +
console + request ID, then triage on the next session.
