# Near-Miss Reporting module

The Near-Miss module captures events that *almost* caused harm but
didn't — the leading-indicator signal that drives multiple OSHA,
Cal/OSHA, and ISO 45001 requirements. Reporting is intentionally
low-friction: anyone in the tenant can file, not just admins.

The user starts on `/near-miss` (the triage list).

## Regulatory references

Near-miss reporting isn't covered by a single regulation — it's the
investigation artifact that satisfies multiple overlapping
requirements + provides the leading-indicator data the OSHA recordable
metric can't capture.

- **ISO 45001:2018 §9.1** ("Monitoring, measurement, analysis and
  performance evaluation") — requires the org to monitor and measure
  OH&S performance. Near-miss volume + severity_potential + age
  metrics are the input data.
- **ISO 45001:2018 §10.2** ("Incident, nonconformity and corrective
  action") — requires investigation of incidents AND near-misses to
  determine root causes and prevent recurrence. The triage workflow
  + escalation-to-risk path implement this directly.
- **Cal/OSHA — Title 8 §3203(a)(7)** — the IIPP requires investigating
  occupational injuries / illnesses AND, by reasonable extension under
  §3203(a)(4) hazard evaluation, near-misses that reveal new or
  ongoing hazards.
- **Federal OSHA — 29 CFR 1904** ("Recording and Reporting
  Occupational Injuries and Illnesses") — defines what counts as an
  OSHA-recordable. Most near-misses are NOT recordable by definition
  (no injury), but a near-miss that's later determined to involve
  loss of consciousness, days-away time, or medical-treatment
  exposure WILL flip to recordable. The platform doesn't make that
  determination — qualified safety personnel do.
- **Cal/OSHA — Title 8 §14300** — California's parallel to 29 CFR
  1904 for recordkeeping.
- **OSHA Recommended Practices for Safety and Health Programs
  (2016) — Hazard Identification and Assessment** — federal
  guidance that explicitly recommends near-miss reporting as a
  hazard-identification method.

The 4-band severity_potential scheme (low / moderate / high / extreme)
is shared with the Risk module so a near-miss that escalates carries
its severity assessment forward into the risk register as inherent
severity (low → 2, moderate → 3, high → 4, extreme → 5 on the 1–5
axis the risk module uses).

## Key pages

- `/near-miss` — Triage list. Default view shows active reports
  (new, triaged, investigating), severity desc → oldest first.
  Toggle "Show closed + escalated" to see resolved + risk-promoted
  rows. Four count tiles at the top break down by severity band.
- `/near-miss/new` — Mobile-first capture form. Anyone in the
  tenant can file.
- `/near-miss/[id]` — Single-report detail. Description, severity
  pill, status pill, audit timeline, admin triage actions, and the
  Escalate-to-Risk-Register button.

## Filing a near-miss

The form at `/near-miss/new` asks for five things:

1. **When did it happen?** Defaults to "now" — adjust if filing
   later. Future timestamps are rejected (5-minute clock-skew
   tolerance).
2. **What happened?** Plain-language description of the event.
   Required.
3. **Hazard category** — same taxonomy as the Risk module:
   physical, chemical, biological, mechanical, electrical,
   ergonomic, psychosocial, environmental, radiological.
4. **Severity potential** — what *could* have happened, on the
   4-band scheme:
   - **Low**: no injury possible
   - **Moderate**: first-aid level injury possible
   - **High**: lost-time injury possible
   - **Extreme**: life-threatening or fatal outcome possible
   This is the field that drives triage priority — a slip on a wet
   floor that *almost* sent someone over a railing into machinery
   is **extreme** regardless of the lack of actual injury.
5. **Immediate action taken** (optional) — what was done in the
   moment to prevent harm. "Stopped the line", "taped off the
   spill", "called supervisor".

The form auto-fills `reported_by` from the signed-in user and
stamps `reported_at` server-side.

## Status lifecycle

A report moves through five statuses:

- **New** — just filed, awaiting triage
- **Triaged** — reviewed, classified, possibly assigned
- **Investigating** — root-cause work in flight
- **Closed** — resolution recorded, no further action
- **Escalated to risk** — promoted to a risks register entry
  (terminal state; the report is now read-only and links to the
  associated risk)

Status changes are admin-only and stamped to the audit timeline.
Transitioning to **closed** or **escalated_to_risk** auto-stamps
`resolved_at`; reverting to an active state clears it.

## Triage list defaults

The list defaults to active reports sorted by severity descending
then `reported_at` ascending — i.e. the highest-severity oldest-
unresolved reports surface at the top. That's the order safety
leads typically work the queue.

## Detail page

The `/near-miss/[id]` page shows:

- Report number, severity pill, status pill
- Meta grid: occurred / reported / age in days / hazard / location /
  linked risk (if escalated)
- Description, immediate action taken, resolution notes
- Triage section (admin-only): status select, escalate button
- Audit timeline (last 50 events)

If the report has been escalated, the **linked risk** meta cell
becomes a clickable link to the corresponding `/risk/[id]` page.

## Escalating to the Risk Register

When a near-miss reveals a durable hazard that needs ongoing
management, an admin promotes it via the **Escalate to Risk
Register** button on the detail page. This:

1. Creates a new risk register entry with the near-miss data
   carried forward (hazard category, location, description).
2. Maps `severity_potential` → inherent severity (low→2,
   moderate→3, high→4, extreme→5) with a conservative
   likelihood=3 (re-score on the risk page).
3. Sets the near-miss `status` to **escalated_to_risk** and
   `linked_risk_id` to the new risk's id.
4. Redirects to the new `/risk/[id]` page.

The escalate modal asks for two fields the near-miss can't
supply: **activity type** (routine / non-routine / emergency)
and **exposure frequency** (continuous / daily / weekly /
monthly / rare). After escalation, the near-miss becomes
read-only and the risk inherits ongoing management.

Re-escalating an already-escalated near-miss returns 409 with the
existing `linked_risk_id` — the link is one-to-one.

## KPI panel on the home dashboard

The Control Center dashboard surfaces a Near-Miss intelligence
panel (visible to tenants with the module enabled):

- **Active reports** — count of new + triaged + investigating
- **High + Extreme** — severity-weighted concern count
- **New (30 d)** — trend signal; spike here is the leading
  indicator
- **Stuck in triage** — active reports older than 30 days; the
  "needs attention" cohort
- **Top unresolved** — top 5 by severity desc → oldest first

## Common questions

**"Who can file a near-miss?"** Anyone in the tenant. Reporting is
deliberately low-friction — the whole point is to capture events
the worker noticed, even if no admin is around. Status changes
(triaging, closing, escalating) are admin-only.

**"What if I'm not sure how serious it could have been?"** Lean
toward a *higher* severity band when in doubt. Triage admins can
re-band during review; under-bading hides the report from the
"high + extreme" filter that safety leads watch.

**"How is severity_potential different from a risk's residual
score?"** A risk's residual score reflects the level *after*
controls are applied. A near-miss's severity_potential reflects
the worst-case outcome *if* the event had played out. Different
analytic frames; both use the same 4-band visual language for
consistency.

**"Why can't I delete a near-miss?"** The audit log is
append-only by design (REVOKE on UPDATE/DELETE + an immutable
trigger). Even superusers can't delete an audit row. If you filed
a duplicate, ask an admin to close it with a note in
`resolution_notes`; the trail stays intact.

**"What does 'Stuck in triage' mean on the dashboard?"** Active
reports (status: new / triaged / investigating) that were filed
more than 30 days ago. Reports stuck this long should either be
closed (with notes) or escalated.

**"How do I see who filed a report?"** The detail page header
shows `reported_by`. Auditors typically care about response time
(reported_at → first status change), not who filed it.

## When to escalate to human support

- **Real-time emergencies** — the bot is asynchronous, not a 911
  line. Use the proper site emergency response.
- **Investigation outcomes that imply a regulatory report** —
  OSHA recordable, SDS-relevant exposure, etc. Loop a qualified
  safety professional in early; the bot can describe the workflow
  but can't make the regulatory call.
- **Disagreements about severity_potential** — bot can explain the
  bands but can't adjudicate between two competing severity reads.
- **Cross-tenant concerns** — if a near-miss reveals a hazard that
  should be communicated to other sites in the same org, an admin
  needs to drive that propagation.
- **Privacy / HR overlap** — a near-miss involving named workers
  and behavior issues is often a layered conversation; the bot
  doesn't have HR context.
