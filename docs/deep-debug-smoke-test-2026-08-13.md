# Deep-debug smoke test — 2026-08-13 (v1.17.0 + v1.17.1)

Manual checks a browser + a real database can drive that the sandbox can't.
Grouped as **(A)** regressions from the audit's fixes — verify these first —
and **(B)** the v1.17 feature surface the audit covered.

The audit already verified statically: `tsc` clean, full vitest green, repo
guards green, deploy build clean once `@types/react` is deduped (a sandbox-only
install artifact — see the audit report). These checks cover what only a
running app + Postgres with triggers can show.

---

## A. Verify the audit's bug fixes

### A1. grant-login no longer collides with the members-sync trigger  ⟵ highest priority
The critical fix. Needs a real database (the trigger `trg_sync_membership_to_members`
from migration 180 must be live).
1. As a tenant **admin**, open **Admin → People → Members**.
2. Find (or create) a **roster-only** member — one with no login (`profile_id`
   null): e.g. a LOTO worker or a manually-added member with an email on file.
3. Click **Grant app access**.
4. **Expect**: success (200) — a temp password / invite link is shown, an email
   is sent, and the member now shows as having a login.
   **Before the fix this returned 409 "PROFILE_ALREADY_LINKED" on the first
   click and stayed stuck.**
5. In the DB, confirm there is **exactly one** `members` row for
   `(tenant_id, profile_id)` — not a duplicate left by the trigger.
6. Retry once more on the same (now-linked) member → should return the
   `ALREADY_HAS_LOGIN` 409 (correct), not a server error.

### A2. Severe-injury reporting deadline is frozen, not re-derived
The frozen-jurisdiction fix. Needs a facility whose state you can change.
1. Open an incident whose facility is **unset or non-CA**. In **Regulatory
   reporting**, **Flag a reportable event** (e.g. in-patient hospitalization).
   Note the window shown — federal **24h**.
2. Now **re-point the incident's facility to a California establishment**
   (state `CA`).
3. Back on the incident, click **Record OSHA filing** on that same trigger and
   confirm.
4. **Expect**: the trigger's window stays **24h / federal** — the deadline it was
   created under. **Before the fix, recording the filing silently re-resolved it
   to CA / 8h.** Also confirm the row's original author (`created_by`) is
   unchanged.
5. Add a *new* trigger now (facility = CA) → it should correctly show **8h / CA**.
   (Freeze applies per-row at creation, not globally.)

### A3. Regulatory reporting panel surfaces load failures (no infinite spinner)
1. Open an incident's **Regulatory reporting** panel with the network throttled
   to fail the GET (DevTools → offline, or block the request), then reload.
2. **Expect**: an error message + a **Try again** button — not an endless
   "Loading reporting status…" spinner. Clicking **Try again** (with the network
   restored) loads the panel.

### A4. "Coming up" panel hides on error rather than lying
1. On the dashboard (tenant with the OSHA reg-watch module), block the
   `osha_regulation_updates` query, then reload.
2. **Expect**: the **Coming up** panel is **absent** — not showing "No upcoming
   regulatory changes on the horizon" (which would disguise a failure as a clean
   bill of health). With the query healthy and genuinely no upcoming items, the
   empty-state text is correct.

### A5. Countdown never renders "Xh 60m"
On an incident with an open severe-injury trigger, watch the live countdown near
the top of an hour (or set a basis time so `hoursRemaining` ≈ 7.99). It should
read **8h**, never **7h 60m**.

---

## B. v1.17 feature surface

### B1. ⌘K / search (single owner)
- Press **⌘K** (or click the header search control) → the command palette opens.
  Press ⌘K again → it **toggles closed**.
- Type a page name ("confined space permit") → the page appears and Enter
  navigates to it.
- Type an equipment id / description / department (≥2 chars) → equipment rows
  appear under **Equipment**; Enter on a highlighted equipment row navigates to
  **that** equipment (not an unrelated nav item). Confirm no "No matches." shows
  above visible results.
- ⌘K while focused in a text field you're typing in should **not** hijack it
  (except inside the palette's own input, where it toggles closed).

### B2. Drawer child pages + per-tenant expansion memory
- In the drawer, click a module's **chevron** → its child pages
  (SDS Library, Tier II Report, MAQ Caps, Approval Queue, …) disclose without
  navigating into the module first.
- Collapse the module you're currently inside → it stays collapsed (explicit
  close survives). Reload → the open/closed choice is remembered.
- Switch tenants → expansion memory is per-tenant (a second tenant's drawer does
  not inherit the first's open modules).

### B3. Recents survives odd URLs
- Visit an incident, a chemical, and a piece of equipment → each appears in
  **Recents** (detail pages resolve against the module that owns them; equipment
  borrows LOTO).
- Visit a deliberately malformed path like `/equipment/MIX-100%25` (or one with a
  stray `%`) → the app must **not** white-screen; the Recents row shows the id
  raw/truncated rather than crashing.

### B4. Breadcrumbs on deep pages
- Open a deep Fleet page (e.g. `…/contractors/<id>/prequalification`) → a
  breadcrumb trail renders (root-first), skips the raw UUID segment, shows an
  admin *section* as text (not a link), and does **not** repeat the current
  page's title.
- A module home (e.g. `/incidents`) renders **no** trail.

### B5. Administration split + shared panels
- The drawer's **Administration** is three groups: **People & Training**,
  **Platform & Integrations**, **Records & Support** — each module reachable.
- Dashboard panels share one anatomy (eyebrow = standard, title = thing);
  Incidents / Risk use the shared `PageHeader`, `EmptyState`, `OpsSpinner`.
- LOTO's failure state reads **"Offline"** (fetch failed) vs a tenant that simply
  has no equipment (empty state) — the two are distinct.

### B6. Cal/OSHA jurisdiction-aware reporting
- For a **California** establishment: incident severe-injury deadlines show
  **8h** for all four triggers; the **Coming up** panel shows Federal + Cal/OSHA
  items with a per-row jurisdiction badge.
- For a **non-CA** tenant: federal windows (8h fatality / 24h others), federal
  badge only.
- ⚠️ Known gap (deferred **D4.7**): confirm each establishment's `state` is stored
  as an upper-case 2-letter code (`CA`, not `ca`/`California`) — the reg-watch
  jurisdiction reader is currently case-sensitive.

---

## Admin-only vs member-only (spot check)
- `grant-login`, `reset-access`, `admin/users` POST/DELETE → **admin** only
  (a plain member gets 401/403).
- `severe-injury-report` GET/POST/DELETE → tenant **member** is sufficient
  (it's incident bookkeeping, not tenant administration).
- superadmin members routes → **superadmin** only.
- `/api/invites/{validate,accept,refresh}` → no login required (the 256-bit token
  is the credential); rate-limited per IP.
