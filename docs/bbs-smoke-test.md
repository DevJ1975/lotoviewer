# BBS module — smoke checklist

Use this after applying migration `081_bbs_module.sql` and deploying
the branch. Drive against a real browser (desktop) plus a real
phone or tablet (for the QR scan). Each line is one assertion.

## 0 · Setup

- [ ] Migration 081 applied successfully on a branch DB
      (`supabase migration up` or `apply_migration`)
- [ ] `supabase db push` shows no schema drift
- [ ] `npm run build` from repo root passes (no env overrides)
- [ ] `npm test` from `apps/web/` passes — confirm BBS test count

## 1 · Module registration + drawer

- [ ] Sign in as an admin of a tenant with `bbs` enabled (or no
      explicit override → defaults to enabled)
- [ ] Drawer shows "Behavior-Based Safety" with the eye icon, teal
      accent
- [ ] Expanding it lists: New Observation · Leaderboard · QR Codes
      · BBS Scorecard
- [ ] Clicking the parent navigates to `/bbs` (list view)
- [ ] On a tenant where `modules.bbs` is explicitly `false`, the
      drawer entry is hidden AND `/bbs` 404s via ModuleGuard

## 2 · QR code generation (admin)

- [ ] As an admin, navigate to `/bbs/qr`
- [ ] Add a location: name "Line 3 Entrance", area "Packaging" →
      row appears with a generated QR image
- [ ] Click "Print" → new window opens with QR + name + area + URL,
      print dialog appears
- [ ] Click "Rotate" on a location → confirm prompt appears, token
      changes (compare URL footer before/after)
- [ ] Click "Disable" → row dims, the row's token still resolves to
      a 404 on `/r/bbs/{token}` (test next section)
- [ ] Re-enable and confirm intake works again

## 3 · Public anonymous QR submission (phone or tablet)

For each step, use a real phone with the network reachable.

- [ ] Scan the printed QR with the device camera → opens
      `/r/bbs/{token}` in the default browser
- [ ] No login prompt appears (route is in `PUBLIC_PREFIXES`)
- [ ] Header shows tenant name + location name + area
- [ ] Pick "Unsafe Condition" → form expands with risk matrix
- [ ] Tap a cell on the 3×3 matrix → score badge appears next to
      the "Risk rating" label
- [ ] Submit with description = "wet floor near valve" → thank-you
      screen with `BBS-{year}-NNNN`
- [ ] "Submit another" returns to a blank form
- [ ] Try submitting a description with 4 chars → field error
      appears, no network call
- [ ] Pick "Safe Behavior" → matrix disappears, severity not
      required
- [ ] Submit anonymously (no name) → succeeds; verify the row in
      the DB has `submitted_by IS NULL` and `anonymous = true`
- [ ] Submit with name "Alex" + email → succeeds; row has
      `submitted_name = 'Alex'`
- [ ] Visit `/r/bbs/{token-that-doesnt-exist}` → "QR not recognized"
      error card
- [ ] Disable the QR location, reload the same URL → "Invalid or
      expired QR" error

## 4 · Authenticated submission (logged-in user)

- [ ] As a member, navigate to `/bbs/new`
- [ ] Submit "Unsafe Act" with description "operator skipped LOTO
      step" + risk matrix high × medium → redirected to detail page
- [ ] Detail page shows the BBS-{seq} report number, kind badge,
      risk score badge, status "Open"
- [ ] Submitter name appears (not "anonymously")
- [ ] **+points** appear in the metadata strip under the title
- [ ] Submit a "Safe Behavior" without severity → succeeds, no
      validation errors

## 5 · Triage / close-out workflow (admin)

- [ ] As an admin, open an Unsafe Condition detail page
- [ ] Close-out panel appears (panel is NOT visible for
      `safe_behavior` or `closed`/`invalid` rows)
- [ ] Type a corrective action + due date, click "Save & mark in
      progress" → page reloads with status "In progress" and the
      timeline shows a status_change event
- [ ] Click "Close out" → status flips to "Closed", `closed_at` is
      filled, panel hides, green "Closed out" card appears with the
      saved corrective action
- [ ] As a non-admin member, attempt PATCH via curl:
      `curl -X PATCH .../api/bbs/observations/{id} -H ...` → 403
- [ ] Click "Mark invalid" on an Unsafe Act → status becomes
      Invalid, leaderboard view excludes it (verify next section)

## 6 · Leaderboard + gamification

- [ ] Submit several authenticated observations as different users
      (different points totals)
- [ ] Visit `/bbs/leaderboard` → top contributors with avatars,
      ranked by `points_total` desc
- [ ] Profile pictures render via the `<Avatar>` component (falls
      back to initials when avatar_url is null)
- [ ] Anonymous submissions do NOT appear on the leaderboard
- [ ] An "Invalid"-status submission does NOT contribute to the
      submitter's points
- [ ] On the home dashboard (`/`), the BBS panel shows top-3 with
      avatars matching `/bbs/leaderboard`

## 7 · Scorecard

- [ ] Visit `/bbs/scorecard` → big EHS score number renders (0..100)
- [ ] Submit a few unsafe observations and close them out → score
      moves toward 100 (refresh page to recompute)
- [ ] With every unsafe closed and avg risk score = 1, EHS score
      should be ~89
- [ ] With no submissions, EHS score is 10 (severity component
      only) — not 0
- [ ] On the home dashboard, the BBS KPI panel shows the same EHS
      score as `/bbs/scorecard`

## 8 · Tenant isolation

- [ ] Sign in to Tenant A, file a BBS observation
- [ ] Switch to Tenant B (header tenant switcher) → observation
      from A does NOT appear in `/bbs`, `/bbs/leaderboard`, or the
      home KPI panel
- [ ] Direct-navigate to `/bbs/{id-from-tenant-A}` while on Tenant
      B → 404 (RLS scoped via `active_tenant_id()`)
- [ ] Generate a QR code on Tenant A, scan it from a device that's
      logged into Tenant B in the same browser → still works
      anonymously (the QR token is the auth, tenant is resolved
      server-side from the location row)

## 9 · Mobile / iPad UX (real device)

- [ ] Form fields are tap-friendly on iOS Safari (no zoom on input
      focus)
- [ ] 3×3 matrix cells are large enough to tap without mis-taps
- [ ] The kind selector buttons stack on phone-width and side-by-
      side on tablet
- [ ] Thank-you card after public submission renders cleanly in
      both portrait and landscape

## 10 · Regression checks (other modules unaffected)

- [ ] Home dashboard still renders all existing KPI panels (Risk,
      Near-Miss, JHA, Incidents) above the new BBS panel
- [ ] AuthGate change (`PUBLIC_PREFIXES`) didn't break the witness
      token flow or permit sign-on tokens — visit one of those
      routes signed-out and confirm the existing behavior

## What this checklist does NOT cover

- Photo uploads (deferred — see `docs/deferred-work.md` D3.2)
- Rate limiting on public intake (deferred — D3.1). Validate
  manually that flooding the endpoint doesn't fall over the DB
  for a small enterprise tenant; otherwise prioritize D3.1.
- ABC analysis quality (the field is captured but no triage UI
  surfaces it yet beyond the detail page)
- Multi-language signage / RTL forms

## If something fails

Capture: device, OS, browser, exact URL, screenshot of the error
card, payload sent. File against the BBS module label.
