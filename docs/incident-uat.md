# Incident module — manual UAT checklist

Companion to the automated tests (1876 passing as of merge). This is
the path a junior tester drives against a real browser + iPad after
migrations 059–068 are applied to the target environment.

Run order matters within a phase but the phases are independent.

---

## Pre-flight

- [ ] Migrations 059–068 applied (`select max(version) from
      schema_migrations` reads `068`).
- [ ] Vercel cron schedules deployed (5 incident crons in
      `apps/web/vercel.json`).
- [ ] Test tenant has at least one OSHA establishment configured
      (`/osha/establishments` → "New establishment").
- [ ] Test tenant has at least one admin + one member user.
- [ ] `RESEND_API_KEY` is set in the environment (otherwise emails
      will be `skipped` in `email_log` — visible in superadmin).

---

## Phase 1 — Intake + notifications + witness

### 1.1 File a near-miss as a member

- [ ] `/incidents/new` → pick **Near miss** → fill description + when
      → submit.
- [ ] Lands on `/incidents/[id]` with status **Reported**.
- [ ] An entry exists in `incident_notifications` for at least one
      tenant admin (channel=`email`, status=`sent` if Resend is
      configured).
- [ ] The admin's inbox has a subject like `[INC-2026-0001] Near
      miss reported`.

### 1.2 GPS capture on intake

- [ ] On a mobile browser, tap **Tag GPS** on `/incidents/new` →
      browser prompts for location → captured `(lon,lat)` shows
      below the input.
- [ ] Submit → DB row carries `location_geo` as `point` not null.

### 1.3 Witness statement (tokenized)

- [ ] Open the incident detail → Investigate tab not yet started,
      no people attached.
- [ ] As an admin, POST to `/api/incidents/[id]/witness-statement`
      via curl with `{ "email": "tester+witness@example.com" }`.
      Response carries a `link`.
- [ ] Open the link in an **incognito** window (no JWT) → the
      `/witness/[token]` page renders with tenant + report number.
- [ ] Submit a statement → success. Reload the link → "already
      submitted" 410.
- [ ] Tamper with the URL (change one hex char) → 400.

### 1.4 Privacy / PII gate

- [ ] As a plain member, GET `/api/incidents/[id]/care` for an
      incident the member is not the investigator on → 403 with the
      "restricted" message.

---

## Phase 2 — Investigation + four RCA editors

### 2.1 Begin investigation

- [ ] On the incident detail, click **Investigate** tab → "Begin
      investigation" with method picker visible.
- [ ] Pick **5 Whys** → page transitions to the investigation
      dossier; the parent incident's status flips to **Investigating**
      (visible on overview).

### 2.2 Walk all four RCA editors on separate test incidents

For each of: 5 Whys, Fishbone, TapRooT, ICAM:

- [ ] Open the RCA tab → method-appropriate editor renders (chain
      / category buckets / factor list / four layers).
- [ ] Add 3 nodes. Mark one as **Root** → only that node carries the
      ROOT badge (single-root invariant).
- [ ] Switch the method on the same investigation → previous
      method's nodes still in the DB; the active editor reflects
      the new method.

### 2.3 Investigation completion gate

- [ ] On Investigate tab with NO root marked → click "Complete
      investigation" → 400 "Mark one RCA node as the identified
      root before completing".
- [ ] Mark a root → completion succeeds; parent incident transitions
      to **Pending review**.
- [ ] Try to PATCH `completed_at` to a future date via curl → 400
      "completed_at cannot be in the future".

### 2.4 SLA escalation cron

- [ ] Insert a notification rule with `escalation_minutes=1`,
      `match_severity_actual=['lost_time']`.
- [ ] File a lost-time incident, leave status as **Reported**.
- [ ] Wait 2 minutes; manually trigger
      `/api/cron/incident-investigation-sla` (POST with
      `Bearer $CRON_SECRET`).
- [ ] An `incident_notifications` row with `trigger_type='escalation'`
      appears; admin gets the rose-tinted "Investigation overdue"
      email.
- [ ] Re-trigger the cron immediately → row count unchanged
      (idempotent).

---

## Phase 3 — CAPA actions + care management

### 3.1 Assign a CAPA + email fires

- [ ] On Actions tab, create a corrective action with
      `hierarchy_of_controls=engineering`, owner = a different
      tenant member, due in 7 days.
- [ ] Owner's inbox gets the navy "Action assigned" email with the
      hierarchy + due date.

### 3.2 CAPA verification (separation-of-duty)

- [ ] As the owner, mark the action **Complete** → succeeds.
- [ ] As the SAME user, try to mark it **Verified** → 403
      "Verifier must be a different user".
- [ ] As a different admin, mark it **Verified** → succeeds.

### 3.3 Action reminder cron

- [ ] Backdate an open action's `due_at` to yesterday.
- [ ] Trigger `/api/cron/incident-action-reminders` → owner gets
      the rose "OVERDUE 1d" email.

### 3.4 Care case + RTW + drug test

- [ ] On an injury_illness incident, open Care tab → create case.
- [ ] Add restrictions ("No lifting > 20 lb"), set
      `modified_duty_start` + `modified_duty_end`, set
      `next_followup_at` to yesterday, `drug_test_status=negative`.
- [ ] Save → counters preserved on reload.
- [ ] Trigger `/api/cron/incident-care-followup` → case manager
      (or admins as fallback) get the teal "Care follow-up due"
      email.

### 3.5 Care PII gate

- [ ] As a plain member (not investigator, not case manager), open
      the Care tab → "Restricted" message renders.

---

## Phase 4 — OSHA 300/300A/301 + 1904.7 + ITA

### 4.1 1904.7 wizard

- [ ] On Classify tab for an injury, walk the gates:
      - Work-related YES → New case YES → Days-away NO → Restricted
        YES → preview shows **RECORDABLE — restricted**.
      - Toggle Death YES → preview switches to **RECORDABLE — death**
        (most-serious-wins).
      - Toggle Work-related NO → preview switches to **Not
        recordable**.

### 4.2 AI suggest (Claude Haiku)

- [ ] Click **Get AI suggestion** on the Classify wizard → spinner →
      result block shows classification + confidence + reasoning +
      missing-info list.
- [ ] If Claude's suggestion differs from the human's final
      classification → after save, the row in
      `incident_classifications` has `human_overrode_ai = true`.
- [ ] Hammer the button 31 times in an hour → 30th call returns
      429 "AI rate limit reached".

### 4.3 300 log refresh

- [ ] Save a recordable classification → row appears in
      `osha_300_log_entries` with the right
      classification + days_away/days_restricted (capped at 180 if
      the care case is higher).
- [ ] Toggle the classification to NOT recordable → row drops out
      of `osha_300_log_entries`.

### 4.4 Privacy case

- [ ] On the Classify wizard, check the **Privacy case** box.
- [ ] Save → 300 log row's `employee_name = "Privacy Case"`,
      `job_title` and `location_text` are null.
- [ ] Download the 300 PDF (`/osha?year=2026`) → privacy row
      renders "Privacy Case", no name, no location.

### 4.5 300A certification + lock

- [ ] On `/osha`, certify a 300A by typing your name → green
      "Certified" banner; subsequent toggles to the underlying 300
      log don't change the locked totals.
- [ ] Try to certify again → 409 "already certified and locked".

### 4.6 301 PDF (PII gate)

- [ ] As an admin, GET `/api/osha/301/[id]?format=pdf` → PDF
      downloads with DOB + home address from the injured-person row.
- [ ] As a plain member, same URL → 403.

### 4.7 ITA CSV

- [ ] As an admin, GET `/api/osha/ita-export?year=2026` →
      `ita-2026.csv` downloads.
- [ ] Open in Numbers / Excel — no malformed cells, header row has
      23 columns matching `ITA_CSV_COLUMNS`, the `no_injuries`
      column reads `1` for an establishment with zero recordables
      and `0` otherwise.

---

## Phase 5 — Scorecard + heatmaps + repeat detector + weekly digest

### 5.1 Home KPI panel

- [ ] On the Control Center home page (multi-module dashboard),
      the **Incident scorecard** panel renders with non-null
      TRIR/DART once the establishment has hours_worked configured.
- [ ] **Days since last recordable** champion strip turns green at
      ≥30 and rose at <30.

### 5.2 Open actions panel

- [ ] As a user with assigned CAPAs, the **Your open CAPAs** panel
      renders with overdue badges on overdue rows.
- [ ] As a user with no open CAPAs, the panel is hidden entirely.

### 5.3 Full scorecard page

- [ ] `/incidents/scorecard` renders all KPI tiles + monthly
      recordables bar + severity distribution + hierarchy mix +
      body-part heatmap + shift × weekday heatmap.
- [ ] Toggle window 30/90/365 → values + bars update.

### 5.4 Repeat-incident banner

- [ ] File a near-miss at "Loading dock B".
- [ ] File another at "Loading dock B" with overlap in description
      keywords (e.g. "slipped on oil").
- [ ] Open the second incident's detail page → amber "Similar
      incidents" banner shows the first one with reasons listed.

### 5.5 Weekly digest cron

- [ ] Trigger `/api/cron/incident-trends-weekly` manually → tenant
      admins get the Monday digest with 7-day counts + snapshot
      TRIR/DART.

---

## Phase 6 — Anonymous QR + AI assist + lessons + EPA RQ

### 6.1 Anonymous reporting via QR

- [ ] As an admin, open `/incidents/qr` → create a token labelled
      "Loading Dock B".
- [ ] Click **Print poster** → popup opens; the QR code image
      renders; auto-print fires.
- [ ] On a phone, scan the QR → `/report/[token]` loads in the
      mobile browser.
- [ ] Pick a type, fill description, submit → success page shows
      report number.
- [ ] Back in the desktop UI, the new incident appears at
      `/incidents/[id]` with `is_anonymous=true`, `reported_by=null`,
      and `description` does **NOT** include the
      `[anon-token:<uuid>]` prefix (post-migration-068 fix).

### 6.2 Rate limit

- [ ] Set `rate_limit_per_hour=2` on the token.
- [ ] Submit 3 anonymous reports rapidly → the 3rd returns 429.

### 6.3 Token disable

- [ ] Disable the token in `/incidents/qr` → reload `/report/[token]`
      → 410 "invalid or no longer active".
- [ ] Re-enable → form renders again.

### 6.4 Lessons-learned library

- [ ] On a completed investigation, type a lesson summary + tick
      **Publish to library** → save.
- [ ] `/incidents/lessons` shows the entry with the published date
      and the description / root_causes.
- [ ] Search the library by a keyword from the lesson → entry
      filters correctly.
- [ ] On a privacy-case incident, publish a lesson → library entry
      shows "Privacy case — description redacted" and no
      location_text.

### 6.5 EPA RQ banner

- [ ] File an environmental incident with substance="Chlorine",
      quantity=20, unit=lb → detail page shows the rose
      **CERCLA Reportable Quantity met — notify NRC** banner.
- [ ] Same with quantity=5 → emerald "Below CERCLA RQ" banner.
- [ ] Substance="Diesel", quantity=1 gal → amber petroleum banner.
- [ ] Substance="Aqua regia" → slate "consult SDS" prompt.

### 6.6 OSHA 300A posting reminder

- [ ] Trigger `/api/cron/osha-300a-posting-prompt?year=2025` →
      tenant admins get the "Post your 2025 300A by Feb 1" email
      listing establishments awaiting certification.

---

## Cross-module wiring

- [ ] On a hot-work incident, link `related_hot_work_permit_id`
      → the permit detail page shows the linked incident in its
      "Related" section (when wired in a future phase).
- [ ] Tenant switcher: switch to a different tenant → incident
      list, scorecard, and lessons library all show only that
      tenant's data (RLS).

---

## Cleanup / regression

- [ ] After all the above: re-run `npm test` → 1876 passing,
      no new failures.
- [ ] `npm run lint` → 0 new errors.
- [ ] Production build (`npm run build` with
      `ALLOW_DEEPLINK_PLACEHOLDERS=1` if the deeplink check still
      flags pre-existing placeholders) → clean.
