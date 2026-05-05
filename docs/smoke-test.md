# Smoke test checklist — Risk / Near-Miss / JHA + cross-cutting

Manual verification checklist for the Phase 1 trinity (Risk
Assessment, Near-Miss Reporting, Job Hazard Analysis) on web +
iPad. Drive each path through to confirm the code in this
session works end-to-end against a real DB.

This checklist supplements the automated test suite (1453 vitest
cases as of devjr Phase D). It exists because tests can't drive
real browsers / Expo Go and can't catch UX regressions like a
button being unclickable on mobile or a color failing WCAG in
the wild.

## Conventions

- "Web" = `npm run dev` from `/apps/web`, browser at localhost.
- "Mobile" = `npx expo start` from `/apps/mobile`, scanned into
  Expo Go on an iPad (or simulator).
- "Admin" / "Member" = the active user's role in the active
  tenant via `tenant_memberships.role`. The web's
  `requireTenantAdmin` and the legacy `profile.is_admin` flag
  are both honored.
- Each step lists the expected result; failure means file a bug.

## Setup

- [ ] `npm run dev` (web) boots clean — no console errors
- [ ] `npx expo export --platform ios` bundles cleanly
- [ ] Login + active tenant selector both work
- [ ] At least one tenant with all three modules visible
      (`modules: { 'risk-assessment': true, 'near-miss': true, 'jha': true }`)
- [ ] Logged in as both an admin user AND a member-only user
      (test both)

## Risk Assessment

### Heat map (`/risk`)

- [ ] Loads the 5×5 grid with band-colored cells
- [ ] Cell counts match `select count(*) from risks where ...`
- [ ] Inherent / Residual toggle changes counts (residual hides
      risks without a residual score)
- [ ] Filter bar (hazard category, status) updates the grid
      live, URL search params reflect the filter
- [ ] Click a populated cell → drill-down panel lists the risks
- [ ] Click a risk in the drill-down → `/risk/[id]`
- [ ] Top 5 residual-risks panel shows below the grid
- [ ] "View as list →" button carries filters to `/risk/list`
- [ ] Export menu (top-right): JSON / PDF / IIPP printable —
      all three download the file with the right MIME type
- [ ] Empty-tenant state renders without errors

### Risk register (`/risk/list`)

- [ ] Table renders 50 rows per page with band pills
- [ ] Sort by residual_score / inherent_score / next_review /
      risk_number — all four work
- [ ] Filter bar matches the heat map's filter bar
- [ ] Search box matches title + risk_number (ILIKE)
- [ ] Pagination (Next / Prev) updates `?offset=` and renders
      the right rows
- [ ] "Bulk import →" (admin) → `/risk/import`
- [ ] "Heat map →" / "+ New risk" / "Heat map ↶" navigations all work

### Risk detail (`/risk/[id]`)

- [ ] Score card shows Inherent + Residual band pills with patterns
- [ ] PPE alert renders ONLY when `inherent_score >= 8` and
      every applied control is `hierarchy_level = 'ppe'` AND
      no `ppe_only_justification` is set
- [ ] Controls table shows hierarchy badge (highest-impact first)
- [ ] Reviews timeline renders (most recent first)
- [ ] Audit timeline renders the last 20 events
- [ ] Quick actions (admin only) — change status / mark reviewed /
      reassign — all PATCH and update the page
- [ ] Reassign owner — popover loads members
- [ ] Mark reviewed — bumps `next_review_date` per band cadence

### New-risk wizard (`/risk/new`)

- [ ] All 8 step indicators render in the header
- [ ] Step 1 (Identify) requires title + description
- [ ] Step 2 (Categorize) requires hazard category + source +
      activity + exposure
- [ ] Step 3 (Inherent) — severity × likelihood selectors,
      score updates live, band pill updates color live
- [ ] Step 4 (Controls) — controls library picker filters by
      hazard_category; custom-name fallback works
- [ ] Step 5 (Residual) — optional; live preview updates
- [ ] Step 6 (Assign) — three MemberPicker instances; cache
      shared so they don't fire 3 lookups
- [ ] Step 7 (Review) — read-only summary
- [ ] Step 8 (Confirm) — Submit creates the risk and redirects
- [ ] **PPE-alone** — submit with inherent_score=8, all
      PPE-level controls, no justification → server returns 422,
      wizard jumps back to Controls step with error message
- [ ] **Refresh mid-wizard** — page reloads → "Draft restored"
      banner appears with the previous state
- [ ] **Discard draft** button on the banner → reverts to step 1
- [ ] Submit success → draft cleared from sessionStorage

### Bulk CSV import (`/risk/import`)

- [ ] Admin-only screen
- [ ] Download template button → CSV with all required columns
- [ ] Upload a valid CSV → all rows show "Valid"
- [ ] Upload a CSV with invalid hazard_category on row 3 →
      that row shows "Invalid" with the error message; the
      others show "Valid"
- [ ] Click Import → POSTs each valid row, results show
      "Imported" / failure inline; partial-failure does not
      block other rows
- [ ] Concurrency = 4 — large file (50+ rows) uploads in
      reasonable time

### Risk settings (`/admin/risk-settings`)

- [ ] Admin-only screen
- [ ] Band scheme radio cards — both 4-band + 3-band selectable
- [ ] Acceptance threshold accepts integers 1..25
- [ ] Save persists; reload shows the saved values
- [ ] Tenant context refresh — heat map immediately reflects
      the new band scheme (3-band collapses extreme into high)

### Cron review reminders (`/api/cron/risk-review-reminders`)

- [ ] Set `CRON_SECRET` in Vercel
- [ ] Manually invoke with `Authorization: Bearer $CRON_SECRET`
      → returns `{ overdue, ownersNotified, emailsSent, emailsSkipped }`
- [ ] Without the secret → 401
- [ ] With placeholder `RESEND_API_KEY` unset → emailsSkipped
      bumps and emailsSent stays at zero (no errors thrown)

## Near-Miss Reporting

### List (`/near-miss`)

- [ ] Default view shows active reports (new / triaged /
      investigating)
- [ ] "Show closed" toggle adds closed + escalated rows
- [ ] Severity desc → reported_at asc sort order
- [ ] 4 KPI tiles (extreme / high / moderate / low counts)
      match the rendered rows
- [ ] Empty state CTA → `/near-miss/new`

### Capture form (`/near-miss/new`)

- [ ] Any tenant member can file (not admin-only)
- [ ] All 4 severity radio cards selectable; help text matches
      severity level
- [ ] Description required; submit blocked on empty
- [ ] occurred_at defaults to "now"; future timestamp rejected
      client-side (5-min skew tolerance)
- [ ] Submit success → redirects to detail page

### Detail (`/near-miss/[id]`)

- [ ] Header pill matches severity color
- [ ] Status pill matches NM_STATUS_LABEL value
- [ ] Triage section (admin-only) — status select + escalate button
- [ ] Status select transitions properly (new → triaged →
      investigating → closed); resolved_at gets stamped on close
- [ ] **Escalate to Risk Register** modal — collects activity
      type + exposure frequency, creates a `risks` row, sets
      `linked_risk_id`, flips status to `escalated_to_risk`
- [ ] After escalation, status select is disabled
- [ ] After escalation, "Linked risk" meta cell is a clickable
      link to `/risk/[id]`
- [ ] Re-escalating an already-escalated near-miss → 409
      with `linked_risk_id`

### Audit timeline

- [ ] Insert / update / delete events all render
- [ ] Actor email shows when JWT contains it; falls back to
      actor_id otherwise
- [ ] Append-only — direct UPDATE / DELETE on the audit table
      raises an exception (verify in psql)

## Job Hazard Analysis

### Register list (`/jha`)

- [ ] Default view filters out superseded
- [ ] "Show superseded" toggle adds them
- [ ] Status pill colors match expected
- [ ] Frequency label localized (Continuous / Daily / etc.)
- [ ] Admin-only "+ New JHA" button

### Header create (`/jha/new`)

- [ ] Admin-only screen
- [ ] Title + frequency required
- [ ] Frequency radio cards with help text
- [ ] Submit creates the JHA, redirects to detail with empty
      breakdown

### Detail (`/jha/[id]`)

- [ ] Header (job#, title, status pill) renders
- [ ] Meta grid: frequency / location / performed_by / step+
      hazard counts / worst_case / next_review / approved
- [ ] Required PPE chips render when present
- [ ] Empty breakdown — placeholder message points to "Edit
      breakdown"
- [ ] **Steps & hazards** — steps in sequence order, hazards
      grouped under their step, "General" bucket appears for
      step_id=null hazards
- [ ] Each hazard shows severity pill, category, description,
      controls list (hierarchy ordered)
- [ ] Each hazard renders a green RSK-NNNN pill if escalated,
      else admin sees an Escalate button
- [ ] Audit timeline renders

### Breakdown editor (`/jha/[id]/edit`)

- [ ] Hydrates from existing breakdown
- [ ] Add step → renders empty step at the bottom with
      sequence=N+1
- [ ] Move step up/down → sequence renumbers 1..N
- [ ] Remove step → orphan hazards rebadge as "General"
- [ ] Add hazard inline under a step → category defaults to
      'physical', severity 'moderate'
- [ ] Add control under a hazard — library picker filters
      by hazard_category; custom-name fallback works
- [ ] PPE-alone warning banner appears when inherent
      severity is high/extreme AND every linked control is
      PPE-level
- [ ] Save → PUT /api/jha/[id]/breakdown replaces the whole
      breakdown atomically(-ish); redirect to detail
- [ ] required_ppe array recomputed correctly on save

### Hazard escalation

- [ ] Admin escalate button on a JHA hazard → creates a
      risks row with `source='jsa'` + `source_ref_id=hazard.id`
- [ ] Idempotent: second escalation of the same hazard → 409

## Control Center home

### Visibility filtering

- [ ] Tenant with all 3 modules → all 3 KPI panels render +
      ModulesGrid lists all 3
- [ ] Tenant with only LOTO → KPI panels are absent;
      ModulesGrid shows only LOTO
- [ ] Empty modules object → catalog defaults apply
- [ ] Comprehensive coming-soon strip — currently empty, but
      verify it doesn't break

### Quick actions

- [ ] Hides actions whose underlying module is gated off
- [ ] Returns null when every action is gated off

## Mobile (iPad / Expo Go)

### Setup

- [ ] `EXPO_PUBLIC_WEB_ORIGIN` set in `app.json` extras or
      `.env` so JHA breakdown editor + risk new form can POST
- [ ] Login works (Supabase auth via expo-secure-store)
- [ ] Tenant switcher shows the active tenant name + number
- [ ] Bottom tabs: Dashboard / Equipment / Near-Miss / JHA / Risk

### Near-Miss tab

- [ ] List loads via Supabase RLS-scoped client
- [ ] Pull-to-refresh works
- [ ] Tap row → detail
- [ ] FAB "+ Report" → /near-miss/new
- [ ] Capture form fields all functional; submit creates
- [ ] Detail page read-only; severity pill / status pill / meta
      grid all render

### JHA tab

- [ ] List loads
- [ ] Admin sees "+ New JHA" FAB
- [ ] Tap row → detail
- [ ] Detail shows steps + hazards + controls tree
- [ ] Required PPE chips render
- [ ] **Edit breakdown** (admin) → editor screen
- [ ] Editor: add/remove/reorder steps, add hazards, add controls
- [ ] Library modal picker (filtered by hazard category)
- [ ] Save → POST to `${EXPO_PUBLIC_WEB_ORIGIN}/api/jha/[id]/breakdown`
- [ ] PPE-alone banner shows under same conditions as web

### Risk tab

- [ ] List loads with band-colored score pills
- [ ] "Show closed" toggle works
- [ ] Tap row → detail
- [ ] Detail: side-by-side inherent + residual ScoreTiles,
      meta grid, controls hierarchy, reviews
- [ ] "Heat map →" header link → /risk/heatmap
- [ ] Heat map: 5×5 grid, residual / inherent toggle, tap
      cell → drill-down modal → tap risk → detail
- [ ] Admin "+ New Risk" FAB → /risk/new
- [ ] New form: all sections render, score selectors update
      band-colored preview live, PPE-alone warning fires under
      same conditions as web, Submit POSTs to web origin

## Known acceptable limitations

These are documented behaviors, not bugs:

- **JHA breakdown PUT** is "atomic-ish" — Supabase JS doesn't
  expose transactions. If a step in the bulk-replace sequence
  fails after the existing breakdown is deleted, the JHA is
  left empty. Mitigation: future migration could wrap in a
  SECURITY DEFINER stored procedure.
- **Mobile triage actions** — status mutations on near-miss
  detail aren't available on mobile yet (web only). The mobile
  detail pages are read-only by design.
- **Mobile risk wizard** — the 8-step web wizard is collapsed
  into a single scrollable form on mobile. Same data shape,
  intentionally different UX.
- **Mobile breakdown editor** — POSTs to the web origin via
  `EXPO_PUBLIC_WEB_ORIGIN`. Without the env var set, Save throws
  a descriptive error.
- **expo export** has been intermittently flaky in some
  environments (Metro entry-resolution). tsc + the test suite
  validate the code; clean reproductions on a fresh machine
  before submitting to TestFlight.

## When something fails

1. Capture: which tenant, which user role, browser/device, any
   console output
2. Check tsc + tests: `cd apps/web && npx tsc --noEmit && npx vitest run`
3. If it's a real bug, file an issue and add a regression test
   under `__tests__/` that reproduces it
