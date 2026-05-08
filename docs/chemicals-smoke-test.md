# Chemical Management module — smoke checklist (Phases A–G)

Use this after applying migrations `082_chemicals_module.sql`,
`083_chemical_label_prints.sql`, `084_chemical_inventory.sql`,
`085_chemical_sds_drift.sql`, `086_chemical_compliance.sql`, and
`087_chemical_guardrails.sql` and deploying the branch. Phase A ships
the foundation (catalog, detail, manual SDS upload, search/filter);
Phase B layers AI SDS parsing + the human review queue; Phase C adds
GHS-compliant label printing; Phase D adds inventory containers,
locations, barcode scan, and the expiring-soon dashboard; Phase E
adds the SDS drift monitor (nightly cron + manual trigger + drift
audit log); Phase F adds compliance rollups — Tier II export,
OSHA 300 chemical-exposure linkage, and fire-code MAQ scaffolding;
Phase G adds guardrails — restricted/banned chemical list,
storage-compatibility checker, container-approval workflow, and
push notifications on new SDS revisions + filed approval requests.

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

## 21 · SDS drift fetcher (Phase E) — host allowlist + SSRF guard

- [ ] Migration 085 applied; `chemical_sds_revision_checks` table
      visible with the `outcome` enum + RLS
- [ ] On a chemical WITHOUT `sds_source_url`, the "Check for
      revision" button is hidden; `POST .../check-revision` returns
      409 with "No manufacturer SDS source URL set"
- [ ] On a chemical WITH `sds_source_url = "http://example.com/x.pdf"`
      (http instead of https), drift outcome is `fetch_failed`,
      audit row `notes` reads "invalid_scheme: http:"
- [ ] On a chemical with `sds_source_url = "https://evil.com/x.pdf"`
      (host not on allowlist), outcome is `fetch_failed`, notes
      contains "is not in CHEMICAL_SDS_HOST_ALLOWLIST"
- [ ] Setting `CHEMICAL_SDS_HOST_ALLOWLIST=evil.com` env var lets
      that tenant's URL through (after redeploy)
- [ ] On a URL that resolves to `127.0.0.1`, `169.254.169.254`,
      `10.x.x.x`, or `192.168.x.x`, outcome is `fetch_failed`,
      notes contain "private/loopback address"
- [ ] On a URL that returns text/html instead of PDF, outcome is
      `fetch_failed` with `wrong_content_type` in notes
- [ ] On a URL serving a > 25 MB PDF, outcome is `fetch_failed`
      with `too_large` in notes (cap respected even when the server
      omits Content-Length)
- [ ] On a URL that times out > 30 s, outcome is `fetch_failed`
      with `timeout` in notes

## 22 · Manual drift trigger

- [ ] On a chemical with `sds_source_url` and an active SDS, click
      "Check for revision" on the SDS section
- [ ] If the bytes are byte-identical to the active SDS, the inline
      message reads "No change since last check." and an `unchanged`
      audit row is written; AI is NOT invoked (no ai_invocations row)
- [ ] If bytes differ but Anthropic isn't configured for the tenant,
      outcome `unknown`, notes "AI not configured"
- [ ] If bytes differ and AI returns a NEWER revision date,
      a new `chemical_sds_documents` row is inserted with
      `source = 'ai_fetch'`, `parse_review_status = 'pending'`,
      `revision_date` = the AI-extracted date, byte hash matches
      `latest_file_hash`. Inline message: "Newer revision detected.
      Review it on the SDS review queue."
- [ ] The pending row appears in `/chemicals/review`; reviewer can
      Apply selected fields onto the product (Phase B flow)
- [ ] If the AI returns an OLDER revision date, outcome `older`;
      no new SDS row is created; inline message warns to investigate
- [ ] Hammering `check-revision` past the parse-sds rate cap (30/hr)
      → 429 with retry-after; manual triggers do not bypass the cap
- [ ] An `ai_invocations` row is written with surface `parse-sds`,
      status `success`, `user_id = auth.uid()`, `context = product_id`

## 23 · Nightly cron

- [ ] `vercel.json` has `/api/cron/check-sds-revisions` at `0 6 * * *`
- [ ] Hitting `GET /api/cron/check-sds-revisions` without
      `Authorization: Bearer ${CRON_SECRET}` → 401
- [ ] With the correct secret, cron returns
      `{ candidates_considered, counts: { unchanged, newer, … } }`
- [ ] Per-run cap respected: at most 50 products checked per run
      regardless of how many candidates exist
- [ ] Products checked within the last 30 days are skipped (interval
      window prevents re-running until the next cycle)
- [ ] `cron_runs` table has a row with `cron_path = /api/cron/check-sds-revisions`,
      `status = 'success'`, summary line including the counts
- [ ] Each product touched produces ONE `chemical_sds_revision_checks`
      row with `trigger = 'scheduled'`, `triggered_by = NULL`
- [ ] Scheduled runs do NOT log to `ai_invocations` (the table
      requires a non-null user_id; the per-product audit lives in
      the drift table)

## 24 · Drift admin page

- [ ] `/chemicals/drift` is reachable from the chemicals drawer
      entry "SDS Drift Log"
- [ ] Filter chips (All / Newer / Older / Fetch failed / Unchanged
      / Unknown) filter the list correctly
- [ ] Each row shows the outcome chip with the matching icon, the
      product name (link to detail), baseline vs latest revision
      dates, HTTP status, and the trigger source
- [ ] `newer` rows show a "→ review queue" link that lands on
      `/chemicals/review`
- [ ] `fetch_failed` and `older` rows show the notes inline
- [ ] Empty state renders cleanly when no checks exist yet

## 25 · Multi-tenant + permission isolation (Phase E)

- [ ] As tenant B, POST tenant A's `/check-revision` URL → 404
- [ ] As tenant B, GET `/api/chemicals/drift` returns only tenant
      B's checks (no tenant A rows leak)
- [ ] Cron is single-handler; tenant scoping comes from the per-row
      tenant_id flowing through chemical_sds_revision_checks RLS

## 26 · Tier II report (Phase F)

- [ ] `/chemicals/tier-two` is reachable from the catalog header
      "Tier II" button and the chemicals drawer entry "Tier II Report"
- [ ] On a tenant with no inventory, the page shows the empty
      state "No active inventory…" and the Download CSV button is
      disabled
- [ ] After adding three containers (different products, different
      locations, in_stock + in_use statuses), the rollup shows
      three rows; "Distinct chemicals" / "Distinct locations" tiles
      reflect the right counts
- [ ] Disposed and archived containers are EXCLUDED from the rollup
- [ ] Group-by toggle: "product" groups rows under each chemical;
      "location" groups under each location path
- [ ] Search filters on name, manufacturer, CAS, and location path
- [ ] Click "Download CSV" → file downloads with name
      `tier-two-YYYY-MM-DD.csv`; opening in Excel shows the BOM is
      handled, the header row reads `product_name,manufacturer,...`,
      arrays render as `67-64-1; 7732-18-5`, commas in product names
      are RFC-4180 quoted

## 27 · OSHA 300 chemical-exposure linkage (Phase F)

- [ ] On any incident detail page, scroll to the new "Chemical
      exposures" panel below the notification log
- [ ] Empty state reads "No chemical exposures recorded for this
      incident."
- [ ] Click "Add exposure", pick chemical "Acetone", route
      "Inhalation", severity "First aid only", duration 15,
      measured_ppm 95 → save → row appears with the chemical name
      (link to detail), route + severity, and a per-row PPE list
- [ ] Add a second exposure with measured_ppm 1500 on a chemical
      whose `pel_twa_ppm = 1000` → row shows the "EXCEEDS PEL
      (1000 ppm)" rose pill
- [ ] Submitting with an unknown route (POSTing `route="oral"`)
      → 400 inline; submitting without product_id → 400
- [ ] Trash-can on a row deletes the event with confirm prompt;
      gone from list after refresh
- [ ] As tenant B, POSTing to tenant A's
      `/api/incidents/{A_id}/chemical-exposures` → 404
- [ ] As tenant B, POSTing with `product_id` belonging to tenant A
      but `incident_id` belonging to tenant B → 404

## 28 · Compliance schema + Tier II view

- [ ] Migration 086 applied; `chemical_exposure_events`,
      `chemical_max_allowable_quantities`, and
      `v_chemical_tier_two` all exist with tenant-scoped RLS
- [ ] Inserting two MAQ rows for the same location with both
      storage_class set + product_id null is OK; setting both at
      once on the same row is rejected by the CHECK constraint
- [ ] `v_chemical_tier_two` returns rows only for the active
      tenant (security_invoker view inherits underlying RLS)
- [ ] Adding a container with status='disposed' does not appear
      in the view; flipping it back to 'in_stock' brings it back
- [ ] An archived chemical's containers do not appear in the view

## 29 · Restricted-chemical list (Phase G)

- [ ] Migration 087 applied; `chemical_restricted_list` and
      `chemical_incompatibility_overrides` exist with tenant-scoped
      RLS, and `chemical_restricted_match()` RPC is callable
- [ ] `/chemicals/restricted` is reachable from the chemicals drawer
      entry "Restricted Chemicals"
- [ ] Add a CAS rule: `cas_number=71-43-2`, severity `banned`,
      reason "Carcinogen" → row appears with the rose BANNED pill
- [ ] Add a name-pattern rule: `name_pattern=%benzene%`, severity
      `restricted` → row appears with the amber RESTRICTED pill
- [ ] Submitting a rule with both cas_number and name_pattern set
      → 400 inline; submitting with neither → 400
- [ ] Submitting a CAS that fails the regex (e.g. `bogus`) → 400 inline
- [ ] Trash-can deletes the rule with confirm prompt; gone from
      list after refresh

## 30 · Restricted block on product create

- [ ] After adding the banned CAS rule above, attempting to create
      a chemical with CAS `71-43-2` → 409 "Chemical is on the banned
      list", body includes `matched: [...]`, no row created
- [ ] After adding the `%benzene%` restricted rule, attempting to
      create a chemical named "Industrial Benzene Solvent" → 409
      with `requires_override: true`; resubmitting with
      `override_restricted=true` succeeds and `matched` is echoed
      back so the UI can record the override decision
- [ ] A `discouraged` rule never blocks; the response has
      `matched` for client-side warning rendering
- [ ] As tenant B, tenant A's restriction rules do not affect
      tenant B's product create flow

## 31 · Storage compatibility checker

- [ ] Add chemical "Acetone" with pictograms `GHS02` (flammable),
      and another chemical "Sodium Chlorate" with `GHS03` (oxidizer)
- [ ] Add a container of Acetone to "Cabinet 3"
- [ ] Open `/chemicals/inventory/new`, pick "Sodium Chlorate" and
      Cabinet 3 → rose warning panel appears with the conflict:
      "Flammable + oxidizer (GHS02 + GHS03) — NFPA 430. Must be
      stored in separate cabinets / rooms." Save is blocked until
      the "I understand" checkbox is ticked
- [ ] Acknowledging + saving creates the container; the warning
      stays a warning, not an automatic block
- [ ] Picking a different location with no flammables → warning
      disappears, save is enabled
- [ ] Acid (storage_class containing 'acid') in the same location
      as a base (storage_class containing 'base') → warning fires
      via the storage-class rule
- [ ] Inserting a row into `chemical_incompatibility_overrides`
      with `compatible=true` for `pictogram|GHS02|GHS03` makes the
      warning disappear for that pair (refresh to re-fetch overrides)
- [ ] Inserting an override with `compatible=false` for a non-default
      pair (e.g. `pictogram|GHS04|GHS08`) makes that pair start
      warning across the tenant
- [ ] As tenant B, tenant A's override does NOT leak; tenant B's
      compatibility check uses tenant B's own override set

## 32 · Compatibility-check API

- [ ] `GET /api/chemicals/locations/{location_id}/compatibility-check?product={product_id}`
      → JSON with `candidate`, `conflicts[]`, `total`
- [ ] Co-locating multiple containers of the same product does NOT
      report self-conflict (de-duped on product_id)
- [ ] Disposed / empty containers in the location are excluded
      (status filter applied)
- [ ] Missing `product` query param → 400; bad UUID → 400
- [ ] Tenant A's product against tenant B's location → 404 product
      not found

## 33 · Approval workflow (Phase G slice 2)

- [ ] Migration 088 applied; `chemical_inventory_items` has the new
      `approved_at`, `approved_by`, `rejection_reason`, `requested_by`,
      `requested_at` columns and the status check now allows `rejected`
- [ ] Open `/chemicals/inventory/new`, tick "File as request",
      submit → container is created with status `requested`, the trigger
      stamps `requested_at` + `requested_by = auth.uid()`
- [ ] Tenant admin gets a Web Push notification "Chemical container
      request filed" → tap → lands on `/chemicals/approvals`
- [ ] Inventory list (default filter) shows the requested container
      because `requested` is in `ACTIVE_INVENTORY_STATUSES`
- [ ] As a viewer / member (NOT owner / admin), POSTing
      `/api/chemicals/inventory/{id}/approve` → 403
- [ ] As an admin, POSTing the same → status flips to `in_stock`,
      `approved_at` + `approved_by` get stamped by the trigger,
      requester receives a Web Push "Approved: …"
- [ ] Re-attempting approve on the now-approved container → 409
      "Container is in status \"in_stock\", not \"requested\""
      (optimistic-concurrency guard via second `eq('status', 'requested')`)
- [ ] As an admin, DELETE the approve endpoint with `{reason: ""}`
      → 400 "reason is required"
- [ ] DELETE with valid reason → status flips to `rejected`,
      `rejection_reason` stored, requester receives "Rejected: …" push
- [ ] On a rejected row, attempts to PATCH back to in_stock or
      in_use → blocked client-side via `isLegalStatusTransition`
      (rejected and disposed are terminal in core helpers)

## 34 · Drift push notifications (Phase G slice 2)

- [ ] With `VAPID_*` env configured and at least one
      tenant-admin Web Push subscription registered, run the manual
      drift "Check for revision" on a chemical whose source URL has
      a newer revision
- [ ] When the outcome is `newer`, the pipeline:
      (a) inserts the new SDS row,
      (b) writes the `chemical_sds_revision_checks` audit row,
      (c) sends a push to all tenant owner/admin profiles with title
      "New SDS revision detected" and a deep-link to `/chemicals/review`
- [ ] When the outcome is `unchanged` / `older` / `unknown` /
      `fetch_failed`, no push is fired
- [ ] If VAPID env is missing, the drift result is still `newer`
      and the row is still queued for review; the push is simply
      logged as `{sent:0, reason:'VAPID not configured'}` in
      Sentry, never blocking the business outcome
- [ ] Multi-tenant: tenant B's admins do NOT receive a push for a
      drift event in tenant A (membership lookup is tenant-scoped)

## 35 · Catalog header + drawer wiring

- [ ] `/chemicals/approvals` is reachable from the chemicals drawer
      entry "Approval Queue"
- [ ] When the queue is non-empty, the catalog header renders an
      amber "N awaits approval" pill linking to the queue
- [ ] Pill disappears once the queue is empty
- [ ] Add-container form: "File as request" checkbox toggles
      whether the new row writes status='in_stock' (default) or
      status='requested' (file-as-request)

## 36 · JHA × chemical PPE matrix (Phase G slice 3)

- [ ] Migration 089 applied; `jha_step_chemicals` table exists with
      tenant-scoped RLS, plus `v_jha_step_required_ppe` and
      `v_chemical_jha_usage` views (security_invoker)
- [ ] On a JHA step, the new "Chemicals" panel renders below the
      hazards list with empty state "No chemicals linked"
- [ ] Click "Link chemical" → picker shows the tenant catalog →
      pick "Acetone" with usage_notes "5% solution" → linked row
      appears with the chemical name + DANGER pill + GHS02/GHS07
      pictogram chips
- [ ] "Derived PPE" pill row populates with the union of the
      chemical's `ppe_required` (e.g. "Nitrile gloves",
      "Safety glasses")
- [ ] If any derived PPE item is NOT in the JHA's `required_ppe`,
      that pill renders rose; matching items render emerald;
      a rose warning bar lists "Missing from JHA PPE: …"
- [ ] Linking a second chemical (Sodium Hydroxide, pictograms
      GHS05) — derived PPE row dedupes case-insensitively
      ("Nitrile gloves" + "nitrile gloves" → one chip)
- [ ] Re-linking the same chemical → idempotent (UNIQUE
      step_id+product_id), usage_notes updated to the new value
- [ ] Linking an archived chemical → 409 "Cannot link an archived
      chemical"
- [ ] Linking a chemical that belongs to a different tenant → 404
- [ ] Linking a step that doesn't belong to the JHA in the URL → 400
- [ ] Unlink (X button) removes the row + collapses derived-PPE chips
- [ ] On the chemical detail page, a new "Used in N JHAs" panel
      appears below the inventory containers when at least one
      JHA references the chemical; superseded JHAs are excluded
- [ ] Each row links to `/jha/{id}` and shows the JHA's job_number,
      title, status pill, and step count
- [ ] As tenant B, the chemical detail's JHA-usage panel does NOT
      show tenant A's JHAs

## 37 · Webhook events (Phase G slice 4)

- [ ] Migration 090 applied; the 4 trigger functions
      (`chemical_products_emit_webhooks`, `chemical_inv_emit_webhooks`,
      `chemical_exposure_emit_webhooks`, `chemical_sds_emit_webhooks`)
      and their AFTER triggers exist
- [ ] `loto_webhook_subscriptions` table comment lists the 9 new
      `chemical.*` event names
- [ ] With pg_net enabled and a subscription whose `events` array
      contains `chemical.product_created`, inserting a chemical
      via `/api/chemicals/products` POSTs to the subscriber URL
      with `{ "event": "chemical.product_created", "occurred_at",
      "data": { ...row... } }`
- [ ] HMAC signature header `X-Soteria-Signature` is present when
      the subscription has a `secret` set (verifies via SHA-256 of
      the body)
- [ ] Container insert with `status='requested'` fires
      `chemical.container_requested`; transition to `in_stock`
      fires `chemical.container_approved`; transition to `rejected`
      fires `chemical.container_rejected`; transition to `disposed`
      fires `chemical.container_disposed`
- [ ] Repeat insert of same status (no transition) does NOT
      double-fire (verified by trigger logic, not just behavior)
- [ ] Inserting a `chemical_exposure_events` row fires
      `chemical.exposure_logged`
- [ ] Drift cron writing a new SDS row with `source='ai_fetch'` AND
      `parse_review_status='pending'` fires
      `chemical.sds_revision_pending`; manual SDS upload
      (source='upload', already approved) does NOT fire it
- [ ] Archiving a chemical fires `chemical.product_archived`;
      un-archiving fires `chemical.product_unarchived`
- [ ] On a Postgres without pg_net installed, all triggers no-op
      gracefully (per migration 013's design); business INSERTs/
      UPDATEs still succeed
- [ ] Subscriptions list belongs to NO tenant — it's a
      superadmin-managed integration table. Multi-tenant routing
      is the subscriber's responsibility (filter on
      `data.tenant_id` in the payload)

## 38 · Weekly digest email (Phase G slice 5)

- [ ] `vercel.json` has `/api/cron/chemicals-weekly-digest` at
      `0 7 * * 1` (Mondays 07:00 UTC)
- [ ] Hitting the cron path without a Bearer CRON_SECRET → 401
- [ ] With the secret + a tenant that has zero pending SDS,
      zero approvals, zero drift events in the last 7 days, and
      zero containers expiring in 30 days → response says
      `tenants_skipped_empty: 1`, `emails_sent: 0`
- [ ] Add a pending SDS row + run the cron → admins receive an
      email with subject "Chemicals weekly: 1 SDS pending — Acme"
- [ ] Email body lists the chemical name, manufacturer, parse date,
      and a link to `/chemicals/review`
- [ ] Pending approval row → email lists the barcode, requester
      name (resolved via `profiles.full_name`), age in days,
      bolded if ≥ 7d
- [ ] Drift event row from the last 7 days → email lists
      product, outcome chip color (newer=indigo, older=amber,
      fetch_failed=red), checked_at date, optional notes
- [ ] Expiring container within 30 days → email lists product,
      barcode, location_path, days remaining (red ≤ 7, amber
      ≤ 30, green > 30), expiration_date
- [ ] Email sender writes a row to `email_log` with
      `kind = 'chemicals-digest'`, `status = 'sent'`, `tenant_id`
      set, `provider_id` populated from the Resend response
- [ ] Without RESEND_API_KEY in env, email_log row is `status =
      'skipped'` with `error_text = 'RESEND_API_KEY not set'`
- [ ] `cron_runs` row written by withCronLogging with summary
      JSON containing tenants_scanned, emails_sent, emails_failed,
      tenants_skipped_empty
- [ ] Archived chemicals are excluded from every section
- [ ] Multi-tenant: tenant A's admins do NOT receive tenant B's
      digest (membership lookup is tenant-scoped)

## 39 · MAQ caps admin (Phase G slice 6)

- [ ] Migration 091 applied; `v_chemical_maq_status` view exists
      and inherits tenant RLS via security_invoker
- [ ] `/chemicals/maq` is reachable from the chemicals drawer
      entry "MAQ Caps"
- [ ] Add a storage-class rule: storage_class "flammable",
      location "Cabinet 3", unit "gal", max_quantity 50,
      reference "IFC 2018 Tbl 5003.1.1(1)" → row appears
- [ ] Submitting with neither storage_class nor product_id → 400
      "Provide exactly one of storage_class or product_id"
- [ ] Submitting with both → 400 same error
- [ ] Submitting with `unit: 'other'` → 400
- [ ] Submitting with negative max_quantity → 400
- [ ] Submitting with a product_id from a different tenant → 404
- [ ] With 60 gal of flammable_cabinet stock in Cabinet 3 (e.g.
      Acetone × 2 drums @ 30 gal each), the rule shows
      `60 / 50 gal`, fill bar is rose, `exceeds_cap = true`
- [ ] Catalog header shows the rose "1 MAQ exceeded" pill
      linking to `/chemicals/maq`
- [ ] Reducing one container's quantity to 15 gal → next reload
      shows `45 / 50 gal`, fill bar amber (>80%), pill removed
- [ ] Containers in a different unit than the rule are NOT
      counted in the total but ARE flagged in the per-row notes
      ("N container(s) in another unit are not counted")
- [ ] Containers with status `disposed` / `empty` / `rejected`
      do NOT count toward the total
- [ ] Archived chemicals do NOT count toward the total
- [ ] Storage-class match is ILIKE — a rule for "flammable"
      catches products whose storage_class is "flammable_cabinet"
      or "Flammable Cabinet (Class IB)"
- [ ] Trash-can deletes the rule with confirm prompt
- [ ] As tenant B, GET `/api/chemicals/maq` returns only tenant
      B's rules (no tenant A leakage)

## 40 · HazCom training cross-link (Phase G slice 7)

- [ ] Migration 092 applied; loto_training_records.role check now
      accepts 'hazcom' and 'chemical_specific'; chemical_training_requirements
      table exists with tenant-scoped RLS and UNIQUE(tenant_id,
      product_id, role)
- [ ] On a chemical detail page, the new "Training requirements"
      panel renders below the inventory containers + above the JHA
      usage panel
- [ ] Click "Add requirement" → role dropdown shows HazCom 2012,
      Chemical-specific handler, Other → submit a HazCom row →
      requirement chip appears
- [ ] Re-adding the same role → idempotent (UNIQUE upsert) — no
      duplicate row, notes update if supplied
- [ ] Submitting a role outside CHEMICAL_TRAINING_ROLES (e.g.
      'entrant') → 400 with the allowed list
- [ ] Trash-can deletes the row; gone after refresh
- [ ] Coverage check: type "Alice, Bob" in the worker box → API
      cross-references loto_training_records, returns one row per
      (worker × role) pair with status pill (covered / expired /
      missing) and days-until-expiry
- [ ] Worker name match is case-insensitive + whitespace-tolerant
      (matches the existing §1910.146(g) gate behavior)
- [ ] When the same worker has multiple records in the same role,
      the latest `completed_at` wins
- [ ] A future-dated cert (completed_at after today) shows as
      missing — protects against forward-dated paperwork
- [ ] Top-of-section banner: emerald when all workers covered,
      rose when any gaps with "N gaps across M workers"
- [ ] As tenant B, requirements list is empty for tenant A's
      chemical (RLS scopes to tenant_id)
- [ ] As tenant B, POSTing a requirement to tenant A's product → 404

## 41 · Per-tenant webhook subscriptions (Phase G slice 8)

- [ ] Migration 093 applied; `loto_webhook_subscriptions` has the
      new nullable `tenant_id` column with the ON DELETE CASCADE FK
      to `tenants(id)`, plus a partial index on `tenant_id IS NOT NULL`
- [ ] Existing rows keep `tenant_id = NULL` after the migration
      (backwards compatible — they remain global subscriptions)
- [ ] On `/admin/webhooks` as a tenant owner / admin, "Add webhook"
      → the new row gets `tenant_id = active_tenant_id()` baked in
- [ ] List view shows only this tenant's subscriptions (RLS scope)
      plus any subscriptions a superadmin created with NULL tenant
- [ ] As a tenant member without admin role, GET to the list
      returns 403 / empty (RLS blocks)
- [ ] As tenant B, tenant A's subscriptions do NOT appear
- [ ] Submitting "Add webhook" with no active tenant context →
      inline error "No active tenant — sign in and pick a tenant"
      (defends in depth before the RLS-on-insert rejects)
- [ ] Add a chemical event (e.g. `chemical.product_created`) to a
      tenant-scoped subscription
- [ ] Inserting a `chemical_products` row in tenant A → only
      tenant A's matching subscriptions fire (and any global ones)
- [ ] Inserting in tenant B → only tenant B's matching subscriptions
      fire — tenant A's webhook does NOT receive the event
- [ ] A global (NULL tenant_id) subscription receives BOTH
      tenant A's and tenant B's events
- [ ] When the payload doesn't include a `tenant_id` field (e.g. a
      legacy permit table where to_jsonb(NEW) somehow misses it),
      only global subscriptions receive the event
- [ ] HMAC `X-Soteria-Signature` header still computed when the
      subscription has a `secret` set (now via `extensions.hmac`)

## Known follow-ups (not in Phase G slice 8)

- Cross-tenant SDS catalog opt-in (massive cost win at parse time) → Phase G+
- Per-state Tier II form mappings (T2S file format, etc.) → Phase F+
- Bulk parse on import (queue many SDSs at once) → Phase B follow-up
- Per-tenant pictogram override (upload official UN artwork) → Phase C+
- Live label-printer integration (WebUSB to Brother/Zebra) → post-D
- JHA editor pre-fills `required_ppe` from derived chemical PPE
  on save → Phase G+ (today the gap is flagged but not auto-applied)
- Sweep cron: when a chemical's PPE updates (drift apply), flag
  every linked JHA for re-review → Phase G+
- Per-user notification preferences (mute the digest, mute push, etc.)
  → Phase G+ (the email already references /settings/notifications)
- Inventory containers + locations + scan → Phase D
- Label printing + GHS pictogram SVGs → Phase C
- HazCom training topic, Tier II export, OSHA 300 linkage → Phase F

If a step fails, file under `docs/incident-uat.md` with screenshot +
console + request ID, then triage on the next session.
