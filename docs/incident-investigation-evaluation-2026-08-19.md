# Incident investigation — evaluation — 2026-08-19

**Status:** Audit of the incident module across four lenses — compliance integrity,
correctness/security, performance, maintainability. The code-only fixes in the S2/S3 tiers are
committed on `claude/remote-control-disconnected-xcp2o8`. The S1 tier needs schema changes and
is **designed but not applied** — see `docs/capa-consolidation-plan.md` and
`docs/incident-people-pii-plan.md`.

This document exists so the next person knows what is wrong, how serious each item is, and what
was already done about it. Every claim below was verified against the code, not inferred.

---

## TL;DR

The pure domain layer is the strongest part of this codebase: 13 well-factored modules in
`packages/core`, ~430 assertions of genuinely good unit tests, zero literal `any`, and every one
of the 46 API routes carries an auth guard. Nothing below is a criticism of that work.

The problems are at the edges:

1. **OSHA 301 PII is readable by any tenant member.** Redaction lives in a view; the base table's
   RLS is plain tenant scope. (S1-A — the most serious finding.)
2. **Two corrective-action systems that cannot see each other.** A CAPA logged in the most obvious
   place gets no reminder and never reaches the scorecard. (S1-B.)
3. **An incident can be closed with no investigation, no root cause, and open actions** — and
   reopening destroys the record of the first closure. (S1-C, S1-D.)
4. Triage severity tiles were silently under-reporting above 200 incidents. (S2-E — **fixed**.)

Module size for context: ~17,300 lines over 22 pages, 46 API routes, 13 core modules, 30+
migrations (059→252).

---

## S1 — Compliance integrity (schema changes; not applied)

### A. OSHA 301 PII is readable by any tenant member

`incident_people` stores `date_of_birth`, `gender`, `home_address`, `body_part`, `injury_nature`,
`treatment_facility`. Its policy (`migrations/060_incident_people.sql:88-100`) is plain tenant
scope, `for all to authenticated`, with no column gating.

The redaction everyone relies on lives in the `incident_people_safe` **view**, which the API
routes query by convention. A view is not an access control when the base table is reachable:
Supabase exposes PostgREST to the browser with the user's JWT, and this app already issues direct
`supabase.from(...)` reads client-side (`app/incidents/[id]/page.tsx`,
`app/_components/Prop65IncidentBanner.tsx:32`). Any member can read a coworker's date of birth
and home address.

Migration `201_care_phi_confidentiality.sql` fixed exactly this defect class for care PHI with
`can_view_care_phi()`. The pattern exists in this repo; it was never applied to `incident_people`.

Two related gaps in the same helper:

- `can_view_incident_pii()` checks superadmin, owner/admin, and `incidents.assigned_investigator`
  only. `migrations/062_incident_investigations.sql:47` states the helper honours
  `team_member_ids` — it does not. Documented behaviour that does not exist.
- `can_view_care_phi()` has the same blind spot, so a **lead investigator** who is not the
  incident's `assigned_investigator` is denied care data at the DB layer.

### B. Two corrective-action systems, mutually blind

`incident_actions` (migration 063) and `incident_capas` (migration 152) both mean "CAPA".
Migration `198_incident_actions_completed_by.sql` describes itself as consolidation "phase 1 of
N"; the later phases never landed.

They do not share a vocabulary:

| | `incident_actions` | `incident_capas` |
|---|---|---|
| Hierarchy | `elimination`, `substitution`, … | `eliminate`, `substitute`, … |
| Completion status | `complete` | `completed` |
| Owner column | `owner_user_id` | `assigned_to_user_id` |
| Verified columns | `verified_at` / `verified_by` | `verified_effective_at` / `verified_by_user_id` |

And they have disjoint consumers:

| Consumer | Reads |
|---|---|
| `api/cron/incident-action-reminders/route.ts:94` | actions only |
| `app/_components/OpenActionsPanel.tsx:48` | actions only |
| `packages/core/src/incidentScorecardMetrics.ts:548,586` | actions only |
| `api/cron/incident-trends-weekly`, `api/insights/leading-signals` | actions only |
| `packages/core/src/iso45001.ts:122,127` | **CAPAs only** |
| `app/incidents/[id]/_components/CapaPanel.tsx` (incident detail page) | **CAPAs only** |

So a CAPA created in `CapaPanel` — mounted on the incident detail page, the most obvious place to
record a corrective action — produces **no due-date reminder**, never appears in the home Open
Actions panel, and is **absent from the hierarchy-of-controls mix and on-time-closure metrics**.
Conversely, actions created in the Actions tab never count as ISO 45001 §10.2 evidence.

For a product sold on OSHA and ISO conformance, "we recorded the corrective action, nobody was
reminded, and it never reached our program metrics" is an audit finding, not a papercut.

A third copy of the verify/close rule lives in
`lib/ai/operator/carveOuts/capaHighSeverityClose.ts`, whose own header says it "mirrors the
verify/close half of the PATCH route".

See `docs/capa-consolidation-plan.md` for the proposed unification.

### C. An incident can be closed with no investigation

`api/incidents/[id]/route.ts` accepts any status transition. `reported` → `closed` is one PATCH,
with no root cause identified, no causal factors, and open CAPAs outstanding. There is no
transition state machine.

The gate exists one level down — `canCompleteInvestigation` (`packages/core/src/rcaSchemas.ts`)
correctly refuses to complete an *investigation* without an identified root — but nothing gates
the closure of the *incident*, which is the record a regulator asks about. The repo already has
this pattern elsewhere: `migrations/222_loto_audit_enforce_review_gate.sql`.

### D. Closure history is destroyed on reopen

`api/incidents/[id]/route.ts` clears `closed_at` and `closed_by` on any transition away from
closed. There is no audit trigger on `incidents` — a grep for `CREATE TRIGGER` across the
migrations finds none for this table. `incident_audit_log` (059) captures row snapshots, but
grants `insert` to `authenticated`, so a member can forge entries within their own tenant.

"When was this closed, by whom, and was it reopened" is currently unanswerable.

*Adjacent:* certified 300A rows have no DB-level immutability. `osha_annual_summaries` checks
that `certified_at` and `certified_by` are set together, but nothing stops a member UPDATE-ing
`totals_json` on a certified, publicly posted 300A through PostgREST.

---

## S2 — Correctness & security (code-only) — **fixed**

### E. Triage severity tiles under-reported above 200 incidents — `c466e02`

`app/incidents/page.tsx` requested `limit=200`, discarded the accurate `total` the API already
returned, and computed the six severity tiles from whatever rows fit. Any tenant past 200 saw a
truncated table and under-counted Catastrophic/Fatality/Lost-time tiles, with nothing on screen
saying the numbers were partial. Those tiles decide where a safety lead looks first.

Counts now come from the server across the whole matching set, via count-only queries. The filter
definition is extracted so the page query and the tallies cannot drift.

> **Related defect, not fixed.** The list is ordered `reported_at desc` server-side and then
> re-sorted by `compareForTriage` **client-side, within the page**. So the highest-severity open
> incident can be absent from the triage list entirely if it is not among the 200 most recent.
> Sorting by `severity_actual` server-side would not help: it is a text column, and alphabetical
> order (`catastrophic, fatality, first_aid, lost_time, medical, none`) is not severity order.
> A correct fix needs a rank expression or a persisted severity rank, plus pagination. The page
> now says "most recent" rather than implying priority, but the underlying gap remains.

### F. RCA and ECFA inserts had no field allowlist — `11487d0`

Both POST handlers spread the caller's node into the insert and scoped `tenant_id` /
`investigation_id` afterwards, reasoning that scoping last prevents an override. True for those
two columns; every other column stayed caller-settable — including `id` and `created_at`, so a
caller could choose an investigation node's identity and backdate it. The PATCH handlers in the
same files already enforced an allowlist.

RCA needed the list per method: its four method tables have different columns, and a spread let a
caller write a column belonging to another method's table.

> `ai_origin` / `ai_edited` remain caller-supplied, deliberately. The AI-accept flow runs in the
> browser, so the server cannot currently distinguish a genuine AI-drafted node from a claimed
> one — this is self-reported provenance, not an authorization boundary. Correlating against the
> `incident_{rca,ecfa}_ai_suggestions` tables (which already log what was suggested and whether it
> was accepted) would close it; that is a design change, not a patch.

### G. Authorization ran after schema validation — `c6c3adf`

PATCH rejected unknown field names before running the auth gate, so `400 Unknown field: x` versus
`401` told an unauthenticated caller which fields exist and which are admin-gated. Picking the
guard genuinely needs the field names, so that still runs first — it only reads keys. Everything
that describes the schema now runs after the gate.

### H. Database failures were reported as 404 / 403 — `53824f5`

Roughly 27 sites across the module destructure `const { data } = await …` and discard `error`.
When a query fails, `data` is `null`, and the next line is almost always `if (!x) return 404`.

The worst instance was in the care routes: a failed read of `incident_care_cases` left `isPriv`
false, producing a **403 that named the wrong reason** and denied the case manager their own
case. Both care lookups now surface errors as 500s, and run together rather than in sequence.
The `care/visits` route carried a verbatim copy of the same block under a comment claiming it
resolved "auth in one round-trip" while doing two; both now share `lib/incidents/careAccess.ts`.

The remaining discard sites are listed under "Not fixed" below.

> **Not a bug, do not "fix" it.** `care/route.ts` reads the care case twice — once with the
> service-role client for the authorization decision, then again through the caller's RLS-scoped
> client. That second read looks redundant but is the control that enforces migration 201's
> `can_view_care_phi()` policy. Collapsing the two would serve PHI from a read that bypassed the
> PHI gate.

### I. One transient failure destroyed the detail page — `02b06c8`

`app/incidents/[id]/page.tsx` early-returned an error-only screen whenever `error` was set, and
`load()` never cleared it. One rejected status change replaced the whole record — header, people,
notifications, all four panels — with a bare error box, no retry, no way back but a browser
reload. The takeover is now limited to the case where nothing has loaded (and offers a retry);
later failures ride above the record as a dismissible banner.

---

## S3 — Performance

**Fixed**

- Incident alert emails were sent one `await` at a time inside the request that returns the
  reporter's 201 (`e28703e`). A ten-recipient rule put ten SMTP round trips between filing an
  incident and the confirmation.
- Care authorization did two sequential lookups; now parallel (`53824f5`).
- The detail page's notifications read waited on two unrelated fetches; now joins them
  (`02b06c8`).

**Not fixed — each deserves its own change**

- **The module is entirely client-rendered.** 19 of 22 files are `'use client'`; the only server
  components are a layout and two redirect stubs. `/incidents/[id]` issues 8+ round trips after
  hydration, each preceded by its own `getSession()`. Moving the list and detail pages to server
  components is the largest single win available and the prerequisite for collapsing that fan-out.
- **ECFA mutations are N+1.** `EcfaBoard.tsx` calls `load()` (two fetches) after every node
  mutation — 3 round trips per edit. Accepting one AI-drafted event with five conditions is
  ~18 serial round trips. The correct pattern already exists in the same file (`commitPatches`:
  optimistic update, one batched PATCH, reconcile-or-rollback) and the API already accepts a
  batch PATCH; `addNode`/`patchNode`/`removeNode` never adopted it, and there is no batch POST.
- **`repeats/route.ts`** selects every injured-person row in the tenant with no tenant filter, no
  date bound and no `.limit()`, to build a body-part map for one incident. Correct today only
  because the client is RLS-scoped.
- **`select('*')`** in the ECFA and RCA routes where an explicit column list already exists in the
  same file. `ChemicalExposuresPanel` pulls 500 chemical products to fill a dropdown.
- **~16 tables have unindexed FK columns.** `incident_rca_ai_suggestions` and
  `incident_ecfa_ai_suggestions` have no `tenant_id` index despite RLS filtering on it — 244
  landed after the 241 index sweep and was never picked up.

---

## S4 — Maintainability

- **The authed-fetch preamble is hand-rolled 27× in this module and 108× repo-wide** — build
  headers from `getSession()`, attach `x-active-tenant`, then unwrap `res.json()` and throw on
  `!res.ok`. Five files have already extracted a *local* helper for it independently. There is no
  shared one. This is the highest-leverage extraction available in the codebase.
- **Oversized components.** `EcfaBoard.tsx` (963 lines: data loading, drag-and-drop, AI co-pilot,
  causal-factor coding, plus four inline sub-components), `qr/page.tsx` (902), `RcaSection.tsx`
  (619, still inlining the Fishbone/TapRooT/ICAM editors that were never extracted the way 5 Whys
  was).
- **Layout no longer matches routing.** `/incidents/[id]/rca` and `/ecfa` are redirect stubs, but
  `EcfaBoard`/`EcfaChart` still live under `ecfa/` and are imported upward into `investigate/`.
- **`investigate/page.tsx` reads `window.location.search` by hand** to dodge a Suspense boundary
  — fragile across client navigation.
- **Guard asymmetry:** RCA/ECFA node CRUD is member-gated, but the AI assist routes are
  admin-gated, so a member can edit the analysis but not ask for a suggestion.
- **Test coverage is the real risk.** 45 of 46 incident/OSHA route files and **all 7 crons** have
  zero tests. Only `api/incidents/[id]/ecfa/route.ts` is exercised. The pure logic is well covered
  (~430 assertions); the I/O layer, where every finding above lives, is not.
- **`docs/incident-uat.md:84-86` is wrong.** It asserts a single-root RCA invariant that migration
  236 deliberately removed.

---

## Corrections to existing docs

- **`docs/deferred-work.md` D4.2 says `main` carries ~127 test failures across 22 files. That is
  stale.** Measured on `bb2e795`: **4069 passed, 0 failed** (one file errors at import because the
  `sharp` native binary is missing from a fresh install — an environment artifact, not a test
  failure). Anyone using D4.2 to justify a red suite should re-measure first.
- `docs/incident-uat.md` predates the ECFA phase (migration 244) and has no coverage for it.

---

## What I checked and what is still unverified

| | Status |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run` before changes (`bb2e795`) | 4069 / 4069 |
| `vitest run` after changes | 4072 / 4072, 328 / 328 files |
| PII reachability via PostgREST | **reasoned from the policy text, not exploited** — the policy is plainly tenant-scope, but I did not run a live query against Supabase to demonstrate it |
| Triage counts above 200 incidents | **not exercised** — needs a tenant seeded past the cap |
| Alert fan-out under a multi-recipient rule | **not exercised** — no live SMTP in this environment |
| CAPA/action split | verified by reading every consumer; **no migration written or applied** |
