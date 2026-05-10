# Mobile (Expo) smoke test — devjr 2026-05-09

This is a manual checklist to drive against the iOS/iPad build after the
2026-05-09 audit pass. Each item lists the screen, what to do, and what
to verify.

Run on **two tenants** (one as admin, one as non-admin member) so you
exercise the gating paths.

## Prereqs
- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` set.
- `EXPO_PUBLIC_WEB_ORIGIN` (or `EXPO_PUBLIC_API_BASE_URL`) set —
  required for JHA breakdown save and Risk new (both POST to /api).
- Test tenants seeded with at least one piece of equipment and one
  open near-miss / risk / JHA each.

## Auth + tenant
- [ ] Sign in with email/password — landing on Dashboard tab
- [ ] Tenant pill shows the active tenant name
- [ ] Tap pill → switcher modal lists every tenant you're a member of
- [ ] Switch to a second tenant → equipment count + every list re-fetches with new data
- [ ] Sign out → returns to login screen
- [ ] Cold-start with prior session → goes straight to Dashboard (Keychain-stored token)

## Dashboard tab (`/(tabs)/index.tsx`)
- [ ] Equipment count renders for the active tenant only
  - **Audit fix**: query now filters explicitly by tenant_id; verify a switch from tenant A
    (e.g. 12 items) to tenant B (e.g. 3 items) flips the count correctly
- [ ] Email greeting shows the signed-in user's address

## Equipment tab + detail (`/(tabs)/equipment.tsx`, `/equipment/[id].tsx`)
- [ ] Equipment list renders for the active tenant
- [ ] Open one piece of equipment with documented energy steps
  - **Audit fix**: the detail screen now queries `loto_energy_steps` (was `loto_steps`,
    a wrong table name that returned an error). **This is the most-likely-broken-before
    behavior — verify it works at all now.**
- [ ] Steps appear in `step_number` order
- [ ] Open a piece of equipment with no steps documented → "no steps" empty state, no error
- [ ] Tap a photo slot → PhotoCaptureSheet opens; capture or pick → upload completes; thumbnail refreshes
- [ ] Force a network failure mid-upload → error surfaces in UI

## Near-Miss tab (`/(tabs)/near-miss.tsx`, `/near-miss/new.tsx`, `/near-miss/[id].tsx`)
- [ ] Tab shows active near-misses (excludes 'closed' and 'escalated_to_risk') sorted for triage
- [ ] Tap "Report" (admins only? No — any member) → form
- [ ] Submit with empty description → client-side validation error
- [ ] Submit with all fields → list refreshes with the new entry on focus
- [ ] Open a detail → header + meta grid + "Occurred" timestamp shows time-of-day
  - **Audit refactor**: this now uses `formatShortDateTime` from `lib/dateFormat.ts`
- [ ] Pull-to-refresh works on the list

## JHA tab (`/(tabs)/jha.tsx`, `/jha/new.tsx`, `/jha/[id]/index.tsx`, `/jha/[id]/edit.tsx`)
- [ ] List excludes superseded JHAs, sorted by `updated_at` desc
- [ ] As a non-admin: "New JHA" header button is hidden; opening `/jha/new` directly shows "Admins only."
- [ ] As admin: create a JHA → redirects to detail
- [ ] Detail page renders header pill + meta grid + steps tree + required PPE
- [ ] "Approved" date uses the new `formatShortDate` helper (Audit refactor — no behavior change)
- [ ] As admin: tap "Edit breakdown" → editor loads with existing tree
- [ ] Add a step → it appends with sequence = N+1
- [ ] Move step up/down → sequences renumber 1..N with no gaps
- [ ] Remove a step that has hazards → hazards detach to "general" (not deleted)
- [ ] Add a hazard with severity = catastrophic and only PPE controls → PPE-alone warning surfaces
- [ ] Save → server-side breakdown PUT returns 200; redirects to detail with new tree
- [ ] As non-admin: "Edit breakdown" button is hidden on detail

## Risk tab (`/(tabs)/risk.tsx`, `/risk/new.tsx`, `/risk/[id].tsx`, `/risk/heatmap.tsx`)
- [ ] List sorts by residual_score desc, then inherent_score desc
- [ ] Toggle "show closed" → closed + accepted_exception entries appear
- [ ] Open `/risk/heatmap` → 5×5 grid renders, drilling into a cell shows the matching risks
- [ ] Toggle inherent ↔ residual axes; risks without residual scores drop out of residual view
- [ ] As non-admin: "New Risk" gated to Admins only
- [ ] As admin: create a risk with high inherent score + only PPE controls → form blocks until justification entered (ISO 45001 8.1.2)
- [ ] As admin: submit → redirects to detail with score card + controls list + reviews
- [ ] Detail uses the new `formatShortDate` helper for "Last reviewed" and review timestamps

## LOTO Devices tab (`/(tabs)/loto-devices.tsx`)
- [ ] Tab loads (Audit refactor: 5 fetches now run in parallel via Promise.all instead of serial → noticeable speedup)
- [ ] Search by device_label or description filters the list
- [ ] Available device → "Check out" button visible
- [ ] Checked-out device → "Return" button + "held by ..." line
- [ ] Open the check-out modal:
  - [ ] Worker list + app-user list both populated
  - [ ] Pick a worker WITH valid LOTO training → green badge, "Check out" enabled
  - [ ] Pick a worker WITHOUT training (or expired) → amber/red badge, button disabled
  - [ ] Add new worker (shop-floor) → name + completion date validation works
  - [ ] Submit checkout → modal closes, list refreshes, device shows "checked out"
- [ ] Return a device → confirms via Alert, closes the open checkout, status flips to "available"
- [ ] **Race-condition gut-check**: try to check out the same device from two phones at once
  - One should succeed, the other should surface "Already checked out. Return it first." (DB unique index catches it)

## Auth-gating spot checks
For each of the following, verify the **non-admin** path is blocked:
- [ ] /jha/new shows "Admins only."
- [ ] /risk/new shows "Admins only."
- [ ] JHA detail edit button is hidden
- [ ] (Near-miss reporting is intentionally allowed for any member — verify)

## Cross-tenant safety spot check
This audit confirmed migration 029 properly tenant-scopes RLS for every domain table.
To verify it's still in effect:
- [ ] Sign in as a member of tenant A only
- [ ] Try to manually navigate to a known-good URL with tenant B's risk_id (e.g. `/risk/<tenant-b-uuid>`)
- [ ] Detail page should show "Not found." (RLS filters the query, the `.eq('tenant_id', tenant.id)` filter doubles up)
- [ ] Repeat with JHA, Near-Miss, Equipment

## Deferred / known-not-tested
- **LOTO checkout compensation**: if the device-status update fails after the checkout
  insert succeeds, the checkout row is orphaned and future check-outs are blocked by
  the unique-open-checkout index. The DB constraint catches double-checkout (tested
  above) but no compensation for the second-step failure. Fix would be a server-side
  RPC that does both writes in one transaction. **Documented as deferred.**
- **Web-app `loto_steps` typo**: `apps/web/app/review/[token]/page.tsx:82` queries
  `loto_steps` (wrong; canonical is `loto_energy_steps`). Same typo this audit fixed
  on mobile, still present on web. **Filed as separate issue — not in this audit's scope.**
- **PPE-alone DB trigger**: web tests cover the migration-039 trigger; mobile relies on
  the same backend, so no separate mobile test needed.

## What this audit *did*
- Mobile tsc: clean (was clean before too, no regression)
- Web tsc: clean (verified once)
- One real bug fixed: `loto_steps` → `loto_energy_steps` in equipment detail
- Two missing-tenant-filter additions for defense-in-depth (Dashboard count, Equipment steps)
- LOTO Devices load: deduped from 7 sequential queries to 5 parallel fetches
- One refactor: `fmt(iso)` extracted to `lib/dateFormat.ts` (3 detail screens deduped)

## What this audit could *not* do (run these yourself)
- Open Expo Go on a physical iPad and tap through every flow above
- Verify EAS build succeeds on iOS/Android
- Run the app against staging Supabase and confirm RLS shapes match
- Verify TestFlight upload + review submission
