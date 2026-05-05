# Job Hazard Analysis (JHA) module

The JHA module captures task-level hazard breakdowns: a job is
broken into ordered steps, each step has identified hazards, and
each hazard has applied controls from the Hierarchy of Controls.

The user starts on `/jha` (the register list).

## Regulatory references

A JHA isn't directly mandated by name in most OSHA standards, but
multiple standards require the *practice* a JHA documents.

- **Cal/OSHA — Title 8 §3203(a)(4)** — the IIPP requires "procedures
  for identifying and evaluating work place hazards including
  scheduled periodic inspections to identify unsafe conditions
  AND work practices." The JHA register documents the work-practice
  side of this requirement. State inspectors typically expect to
  see JHAs for any non-routine task that's been performed since the
  last IIPP review.
- **Cal/OSHA — Title 8 §3203(a)(6)** — IIPP requires correction of
  unsafe conditions and work practices in a timely manner. The JHA's
  Hierarchy-of-Controls breakdown is the corrective-action plan;
  required_ppe is the interim measure.
- **Federal OSHA — General Duty Clause, Section 5(a)(1) of the OSH
  Act of 1970** — the catch-all that JHA practice satisfies for
  task-specific hazards not covered by a vertical standard.
- **Federal OSHA — 29 CFR 1910.132(d)** — PPE hazard assessment.
  Each JHA hazard's PPE-level controls + the rolled-up required_ppe
  field together satisfy the §1910.132(d) written certification
  requirement when the JHA is approved.
- **Federal OSHA — 29 CFR 1910 Subparts I, S, Z** — PPE / electrical
  / toxic-substance vertical standards JHA hazards may need to map
  to depending on the task.
- **OSHA Voluntary Protection Programs (VPP)** — VPP star sites are
  expected to maintain JHAs for all routine and non-routine tasks
  with hazard exposure. The JHA module supplies the evidence layer.
- **ISO 45001:2018 §6.1.2.2** ("Assessment of OH&S risks and
  other risks to the OH&S management system") — task-level hazard
  ID is one of the documented methods §6.1.2.2 expects.
- **ISO 45001:2018 §8.1.2** — the Hierarchy of Controls (elimination
  → substitution → engineering → administrative → PPE) the JHA
  editor enforces visually + in the PPE-alone warning logic.
- **ANSI/ASSP Z490.1** ("Criteria for Accepted Practices in Safety,
  Health, and Environmental Training") — the source of the
  annual-review-cadence convention for approved JHAs. The platform's
  `next_review_date` column drives the Control Center "Overdue
  review" KPI accordingly.
- **OSHA Publication 3071 ("Job Hazard Analysis")** — federal
  guidance document that describes the canonical JHA structure
  (job → steps → hazards → controls). The platform's data model
  mirrors this structure exactly.

The PPE-alone warning in the editor is informational rather than
blocking — JHAs legitimately capture transitional states ("PPE
today, engineering control coming Q3"). The Risk module's PPE-alone
check is harder (DB constraint) because risks are durable; JHA is a
planning surface. The hazard's notes field is where the "why isn't
there a higher-tier control?" justification lives, which is what an
auditor will look for under §1910.132(d) or §3203 evidence reviews.

## Key pages

- `/jha` — Register list. Defaults to non-superseded JHAs. Status
  pill on each row; toggle "Show superseded" to see retired ones.
- `/jha/new` — Header-only create form (admin). Title + frequency
  required.
- `/jha/[id]` — Read-only detail. Header / meta grid / required
  PPE chips / steps + hazards + controls tree / audit timeline.
- `/jha/[id]/edit` — Full breakdown editor (admin). Add /
  reorder / delete steps; tag hazards under each step; pick
  controls per hazard.

## Conceptual model

```
JHA  ──┬── Step 1 ──┬── Hazard A ──┬── Control 1
       │            │              ├── Control 2
       │            └── Hazard B ──┴── Control 3
       │
       ├── Step 2 ──── (hazards…)
       │
       └── General ─── job-wide hazards (no specific step)
```

- A **JHA** is the header row: the task being analyzed (frequency,
  who performs it, location, status).
- **Steps** are ordered (sequence 1..N, no gaps) and edited as a
  list. The editor renumbers automatically when you remove or
  reorder.
- **Hazards** sit under steps OR in a job-wide "General" bucket
  (`step_id = null`) for things like housekeeping or lighting that
  span the whole job.
- **Controls** sit under hazards, ordered by Hierarchy
  (elimination > substitution > engineering > administrative >
  PPE).

## Creating a JHA

Two-stage workflow:

1. **`/jha/new`** — Header-only create. Required fields: title,
   frequency. Optional: description, location, performed-by.
   Submit → redirects to the detail page with an empty breakdown.
2. **`/jha/[id]/edit`** — Add steps + hazards + controls. Save →
   server replaces the whole breakdown atomically(-ish; see
   "Known limitation" below) and aggregates `required_ppe` from
   PPE-level controls.

## Status lifecycle

- **Draft** — initial state, work in progress
- **In review** — submitted for approval; admins see the queue
- **Approved** — signed off; `approved_at` + `approved_by` are
  stamped
- **Superseded** — retired in favor of a newer version. Editing
  is blocked on superseded JHAs.

Status transitions are admin-only. Transitioning to **approved**
auto-stamps the approval columns; reverting to **draft** or
**in_review** clears them.

## The breakdown editor

`/jha/[id]/edit` is the meat of the module. It hydrates from the
existing breakdown, holds three parallel arrays in memory keyed by
local IDs, and PUTs the whole tree to
`/api/jha/[id]/breakdown` on Save.

- **Steps** — type the step description in the inline input.
  Up/down arrows reorder (sequence renumbers automatically).
  X removes the step (its hazards become "General").
- **Hazards** — "+ Add hazard" under a step. Pick the hazard
  category (chip selector) and the **potential severity** (4-band:
  low / moderate / high / extreme). Severity here means "what's
  the worst-case outcome if this hazard isn't controlled?"
- **Controls** — "+ Add control" under a hazard. Pick the
  hierarchy level (elimination → PPE), then either pick from the
  Controls Library (filtered by hazard category) or type a
  custom name. Either control_id OR custom_name is required;
  selecting a library entry clears the custom name and vice
  versa.
- **General hazards** — for hazards that span the whole job,
  click "+ Add general (job-wide) hazard" below the last step.
  These render as a separate amber-bordered card on the detail
  page.

The editor surfaces a **PPE-alone warning** at the top when one
or more high-or-extreme hazards are covered *only* by PPE-level
controls. This is a soft warning, not a save block, per ISO 45001
§8.1.2 — JHAs legitimately capture transitional states ("PPE
today, engineering control coming Q3"). The Risk module's PPE-
alone check is harder (DB constraint) because risks are durable;
JHA is a planning surface.

## Required PPE roll-up

When you save the breakdown, the server aggregates every
PPE-level control's name across the whole JHA into the
`jha.required_ppe` column. The detail page renders these as
amber chips at the top — the at-a-glance "what should the worker
have on" answer.

## Cross-module: escalating a hazard to the Risk Register

On the detail page, each hazard row shows either:

- A green **→ RSK-NNNN** pill if the hazard has been escalated
  (one-to-one link), OR
- An amber **Escalate** button (admin-only) that promotes the
  hazard into a `risks` register entry.

Escalation creates a risk with `source='jsa'` and
`source_ref_id = hazard.id`, mapping potential_severity →
inherent severity (low→2, moderate→3, high→4, extreme→5) with
likelihood=3 as a starting point. The escalate modal asks for
**activity type** + **exposure frequency** that the JHA hazard
doesn't capture.

Re-escalating the same hazard returns 409 with the existing
risk id — the link is one-to-one.

## Detail page sections

- **Header** — job number, title, status pill
- **Meta grid** — frequency, location, performed by, step count,
  hazard count, worst-case severity, next review date, approved
  date
- **Description** (optional)
- **Required PPE** chips (when PPE-level controls exist)
- **Steps & hazards** — the tree, hazards grouped under steps in
  sequence order, "General" bucket appended for orphan hazards
- **Audit timeline** (last 50 events)

## KPI panel on the home dashboard

The Control Center surfaces a JHA intelligence panel (visible to
tenants with the module enabled):

- **Active JHAs** — count of non-superseded
- **Awaiting approval** — count in `in_review`
- **Overdue review** — approved JHAs whose `next_review_date` has
  passed (annual cadence per ANSI/ASSP Z490.1)
- **High/Extreme hazards** — total across active JHAs; subtitle
  shows PPE-alone warning count when present
- **Top by worst-case severity** — top 5 JHAs by their highest-
  severity hazard

## Mobile (iPad)

The full JHA editor is available on mobile. iPad screen real
estate makes the breakdown editor practical — same feature parity
as web. Save POSTs to the web origin
(`EXPO_PUBLIC_WEB_ORIGIN/api/jha/[id]/breakdown`) since the bulk-
replace transaction logic is server-side.

## Known limitation

The breakdown PUT is **"atomic-ish"** — Supabase JS doesn't
expose a transaction API. The server deletes the existing steps
+ hazards + controls, then re-inserts the new tree. If a
re-insert step fails after the delete, the JHA is left empty.
Realistic risk surface (single user editing their own draft)
makes this acceptable for v1; a future migration may wrap the
flow in a SECURITY DEFINER stored procedure for true atomicity.

## Common questions

**"What's the difference between a JHA and a Risk?"** A risk is
a durable, ongoing hazard tracked in a register with controls,
reviews, and a residual-score lifecycle. A JHA is a *task-level*
analysis — the breakdown for a specific job ("change the
conveyor belt", "clean the spray booth"). A JHA hazard can
escalate to a Risk if it reveals an ongoing concern; a Risk
typically *doesn't* roll back into a JHA.

**"What goes under General hazards vs. under a step?"** General
is for things that span the whole job: lighting, ergonomics from
PPE itself, ambient noise, housekeeping. Step-specific is for
hazards that only exist during one operation: pinch point during
disassembly, chemical exposure during cleaning.

**"Why is my PPE-alone warning showing?"** A high or extreme
hazard has only PPE-level controls. ISO 45001 §8.1.2 requires
considering higher-level controls (elimination, substitution,
engineering, administrative) first. The warning is informational
— you can save anyway. The expectation is that the JHA documents
why higher-tier controls aren't feasible yet, in the hazard's
notes.

**"Can I delete a step that has hazards?"** Yes. The hazards
become "General" (step-less) automatically. They aren't
destroyed — re-attach them by editing each hazard. If you
actually want to delete a hazard, use the X button on the
hazard row in the editor.

**"What's the review cadence?"** JHAs are typically reviewed
annually per ANSI/ASSP Z490.1, plus on every significant process
change. The `next_review_date` column drives the Control Center
"Overdue review" KPI; admins set it on the detail page.

**"How do I retire a JHA without losing the audit history?"**
Set the status to **superseded**. Editing is blocked but the row,
its breakdown, and its audit log all stay queryable. The Register
list hides superseded by default; toggle to see them.

**"Can I copy a JHA to make a similar one?"** Not yet — there's
no clone button. Workaround: open both JHAs side-by-side and
re-enter the steps. Worth a feature request if you're doing this
often.

## When to escalate to human support

- **A hazard your team can't agree on a severity for** — bot
  can explain the bands but can't adjudicate. Get a qualified
  safety pro to drive consensus.
- **Required-PPE conflicts with regulatory minima** (e.g. you
  have FR clothing as a custom control but a state regulation
  specifies a higher arc rating) — bot doesn't track regulatory
  minima; consult your safety officer.
- **Cross-site JHA standardization** — if multiple sites need the
  same JHA, that's an admin / change-control conversation, not a
  bot one.
- **Anything around approval workflow disputes** (a JHA blocked
  in review for political reasons rather than safety reasons) —
  HR/management territory.
- **A breakdown editor save that fails partway** (per the
  "atomic-ish" limitation) — capture the JHA id and the error
  message; engineering can recover by re-applying the previous
  breakdown from the audit log.
