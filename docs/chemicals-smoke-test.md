# Chemical Management module — smoke checklist (Phases A + B + C + D)

Use this after applying migrations `082_chemicals_module.sql`,
`083_chemical_label_prints.sql`, and `084_chemical_inventory.sql`
and deploying the branch. Phase A ships the foundation (catalog,
detail, manual SDS upload, search/filter); Phase B layers AI SDS
parsing + the human review queue; Phase C adds GHS-compliant label
printing; Phase D adds inventory containers, locations, barcode
scan, and the expiring-soon dashboard. Drift monitoring (Phase E)
is still out of scope.

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

## 9 · AI SDS parse (Phase B)

Run after Sections 1–8 pass. Requires `ANTHROPIC_API_KEY` (or per-tenant
override) configured for the deployment.

- [ ] On a chemical with an active SDS, click "Parse with AI" on the
      revision row → button shows spinner, then redirects to
      `/chemicals/review`
- [ ] `ai_invocations` table has a new row with `surface = 'parse-sds'`,
      `status = 'success'`, non-null `input_tokens` / `output_tokens`,
      `context = {sdsId}`
- [ ] `chemical_sds_documents` row for that SDS has `parsed_payload`
      populated, `parse_model = 'claude-sonnet-4-6'`,
      `parse_review_status = 'pending'`, `parse_confidence` between 0 and 1
- [ ] Catalog list now shows "1 pending review" pill in the header
- [ ] Detail page shows the indigo "AWAITING REVIEW" banner

## 10 · Review queue + apply

- [ ] `/chemicals/review` is reachable from the catalog header pill
      AND the chemicals drawer entry "SDS Review Queue"
- [ ] Sidebar lists every pending parse, sorted newest first; each
      row shows product name, manufacturer, and confidence chip
- [ ] Selecting a row shows: header with model + overall confidence;
      parser_notes banner when present; field grid with checkboxes
- [ ] Fields where the proposed value matches current show
      "(no change)" and the checkbox is disabled
- [ ] Fields that differ are auto-checked by default; user can
      uncheck individual rows
- [ ] Each field row shows its per-section confidence (high / medium / low)
- [ ] "Apply N fields" with selection → product row updates with
      ONLY the selected fields, untouched fields preserve manual edits
- [ ] After apply, the SDS row's `parse_review_status` flips to
      `approved`; queue removes the row; user sees the next pending one
- [ ] On a parse, click "Reject parse" → confirm prompt → row
      disappears from queue, DB has `parse_review_status = 'rejected'`,
      `parsed_payload = null`, product fields untouched
- [ ] Re-uploading the same PDF (file_hash dedupe) does not re-trigger
      a parse — the existing pending or approved row is returned

## 11 · Rate limiting + cost guardrails

- [ ] Hammer the parse endpoint past `parse-sds` per-hour cap
      (currently 30) → 429 with `retry-after` header
- [ ] Each rate-limited attempt creates an `ai_invocations` row with
      `status = 'rate_limited'`
- [ ] As a tenant without an Anthropic key configured, parsing
      returns a friendly 503 "AI is not configured for this deployment"
- [ ] An > 25 MB SDS PDF returns 413 instead of attempting the parse

## 12 · Multi-tenant + permission isolation (Phase B)

- [ ] As tenant B, POST to tenant A's `/parse` URL → 404 "SDS not found"
- [ ] As tenant B, POST to tenant A's `/apply` URL → 404
- [ ] As tenant B, GET `/api/chemicals/review-queue` returns only
      tenant B's pending parses

## 13 · Label printing (Phase C)

Run after Sections 1–12 pass. Migration 083 must be applied so the
audit log table exists.

- [ ] On a chemical with full hazard metadata, scroll to the
      "Print labels" panel above SDS revisions
- [ ] Three template tiles render: Secondary container · Cabinet
      placard · Inventory tag, with descriptions
- [ ] Selecting "Cabinet placard" swaps the size dropdown to the
      placard sizes (8.5 × 11, 11 × 17). Selecting "Inventory tag"
      reveals the optional barcode input.
- [ ] Click "Print label" with `secondary_container 4x6` → new tab
      opens a PDF; PDF shows product name, signal-word pill, GHS
      pictograms (red diamond + black symbol), hazard statements,
      PPE strip, QR code linking to `/chemicals/{id}`, tenant +
      print-date footer
- [ ] Print `placard 8.5x11` → PDF shows NFPA 704 diamond with the
      product's 1/3/0 ratings in the correct quadrants (blue=health
      left, red=flammability top, yellow=instability right, white=
      special bottom), pictogram strip, top hazards list, PPE strip,
      QR + footer
- [ ] Print `inventory_tag 2x1` with barcode "CHEM-0001" → PDF
      shows product name, CAS, barcode text, and a square QR
- [ ] On a chemical whose `product_name` contains `H₂SO₄` or
      similar Unicode, the print succeeds (WinAnsi sanitiser)
- [ ] Each print creates a `chemical_label_prints` row with
      `template`, `size_key`, `field_snapshot` (full JSON of the
      product fields), `filename`, `printed_by = auth.uid()`
- [ ] Detail page "Print history" disclosure opens to a list of
      past prints with timestamp, template, size, byte count
- [ ] Trying to print on an archived chemical returns 409 inline
- [ ] As tenant B, POSTing to tenant A's `/labels` URL → 404

## 14 · GHS pictogram fidelity

- [ ] Print all nine pictograms by adding a chemical with every
      GHS code → each renders as a red diamond on point with a
      recognizable black symbol (flame, skull, exclamation, etc.)
- [ ] Pictograms scale correctly on each label size — no clipping,
      no overlap with text
- [ ] If a tenant later swaps in official UN artwork (per plan
      §5.3), the swap is one file change in `lib/ghsPictograms.ts`

## 15 · Locations admin (Phase D)

- [ ] `/chemicals/locations` is reachable from the chemicals drawer
      entry "Storage Locations"
- [ ] "Add location" with name "Building A", kind "building",
      no parent → row appears under it
- [ ] Add child "Wash Bay 2" under Building A (kind: room) → row
      indents one level, `path` reads "Building A / Wash Bay 2"
- [ ] Add "Cabinet 3" under Wash Bay 2 (kind: cabinet) → indents
      two levels, full path renders
- [ ] Archive a location with no inventory → row disappears from
      list; row stays in DB with `archived_at` set
- [ ] Archive a location that still has an active container →
      409 with the active count, archive blocked

## 16 · Inventory list + add container

- [ ] `/chemicals/inventory` shows the four tiles (Containers /
      Expired / ≤ 7 days / ≤ 30 days), all 0 initially
- [ ] "Add container" → `/chemicals/inventory/new`
- [ ] Pick chemical "Acetone", location "Cabinet 3", quantity 5,
      unit "gal", container_type "drum", expires "today + 14 days",
      blank barcode → save → redirected to container detail with an
      auto-allocated barcode like `CHEM-{tenant#}-{year}-0001`
- [ ] List page now shows 1 container; "≤ 30 days" tile reads 1
- [ ] Submit with negative quantity → 400 inline
- [ ] Submit with a duplicate barcode (manually entered) → 409
      "Barcode is already in use"
- [ ] Filter by status `disposed` → empty (none disposed yet)
- [ ] "Expiring within 60 days" toggle → only the test container
      is shown
- [ ] Per-row expiry pill renders correct color (rose for ≤ 7d,
      amber for ≤ 30d, emerald for > 30d, slate for "no expiry")

## 17 · Container detail + move/dispose

- [ ] Container detail shows the four cards (Quantity / Dates /
      Location / Status) and a status-action toolbar
- [ ] "Mark in use" flips status; chemical_inventory_items row has
      `opened_date = current_date` (auto-stamped trigger)
- [ ] "Move" with a different location → location card updates,
      catalog header still shows the item
- [ ] Try to dispose without filling the disposal method → inline
      error, no PATCH sent
- [ ] Dispose with method "Hazardous waste pickup" → confirm prompt
      → status becomes "Disposed", `disposed_at` + `disposed_by` +
      `disposed_method` populated; status toolbar disappears (final)
- [ ] Disposed container no longer appears in the default
      inventory list (status filter excludes it); shows when the
      caller selects `disposed`

## 18 · Barcode scan

- [ ] `/chemicals/scan` is reachable from the catalog header,
      inventory list header, and chemicals drawer
- [ ] On a desktop browser without `BarcodeDetector`, the warning
      banner appears and manual-entry remains usable
- [ ] On a Chromium-based browser (Chrome/Edge), "Start camera" →
      browser prompts for permission → live video preview appears
      with the indigo guide rectangle
- [ ] Holding a printed CHEM-… barcode in front of the camera
      detects it, stops the camera, and routes to the matching
      container detail page
- [ ] Holding a chemical-detail QR code (from a label) routes
      directly to `/chemicals/{id}` (URL pattern match short-circuit)
- [ ] Manual entry of a known barcode → routes to container detail
- [ ] Manual entry of an unknown code → 404 inline "No container
      with that barcode."

## 19 · Catalog + chemical-detail integration

- [ ] Catalog header now shows three buttons: Scan · Inventory ·
      Add chemical (plus the existing pending-review pill)
- [ ] Catalog dashboard has a fourth tile "Expiring ≤ 60 days"
      with click-through to `/chemicals/inventory?expiring=true`
- [ ] Chemical detail page has a "Inventory containers" panel
      above the print + SDS panels
- [ ] The panel lists containers for that chemical with location,
      quantity, status, and expiry pill
- [ ] "Add container" link on the panel pre-selects the chemical
      via `?product=<id>` query param
- [ ] Empty state ("No active containers for this chemical.")
      renders cleanly when the chemical has no inventory

## 20 · Multi-tenant + permission isolation (Phase D)

- [ ] As tenant B, GET tenant A's `/chemicals/inventory/{id}` → 404
- [ ] As tenant B, POST tenant A's `/chemicals/inventory` (any
      product_id from A) → 404 "Product not found"
- [ ] Scan a tenant-A barcode while logged into tenant B → 404
      "No container with that barcode."
- [ ] Locations from tenant A do not appear in tenant B's
      add-container location dropdown
- [ ] Storage path on the chemical-sds bucket is unchanged — Phase
      D does NOT add new storage objects, only DB rows

## Known follow-ups (not in Phase D)

- Bulk parse on import (queue many SDSs at once) → Phase B follow-up
- Per-tenant pictogram override (upload official UN artwork) → Phase C+
- Live label-printer integration (WebUSB to Brother/Zebra) → post-D
- Compatibility checker (block storing acid + base in same cabinet) → Phase G
- Drift monitoring (nightly cron) → Phase E
- Inventory containers + locations + scan → Phase D
- Label printing + GHS pictogram SVGs → Phase C
- HazCom training topic, Tier II export, OSHA 300 linkage → Phase F

If a step fails, file under `docs/incident-uat.md` with screenshot +
console + request ID, then triage on the next session.
