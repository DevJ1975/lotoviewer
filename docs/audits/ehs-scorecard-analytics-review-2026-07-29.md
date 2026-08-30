# EHS Scorecard — Analytics Architecture Review
Data-warehouse decision, multi-location correctness, injury cost & MOD, and a prioritised metric plan

**System:** lotoviewer (SoteriaField) — multi-tenant Next.js 16 App Router + Supabase/Postgres EHS SaaS
**Surface audited:** `apps/web/app/admin/insights/scorecard/page.tsx` (1,573 lines, no tests) plus
  `packages/core/src/{scorecardMetrics,incidentScorecardMetrics,incidentRiskModel,statistics,forecast,industryBenchmark,ehsTargets,leadingIndicatorSignals}.ts`,
  `apps/web/components/scorecard/**`, `apps/web/lib/incidentRiskFeatures.ts`, and the OSHA module
**Method:** four adversarial specialist agents — BI Analyst, Data Scientist, Senior SQL Developer, CSP —
  one blind independent round, one cross-critique round, orchestrator verification of every load-bearing
  claim against source, then synthesis. Agent definitions: `.claude/agents/*.md`. Critique graph: Appendix A.
**Scope:** assessment. No migration was written or applied by this review.
**Database:** not queried. Every finding derives from source. Anything needing live data is marked UNVERIFIED.

> **Path shorthand.** After first mention, these are referred to by their short form:
> `page.tsx` = `apps/web/app/admin/insights/scorecard/page.tsx` ·
> `classify/route.ts` = `apps/web/app/api/incidents/[id]/classify/route.ts` ·
> `300a/route.ts`, `ita-export/route.ts` = `apps/web/app/api/osha/…` ·
> `near-miss/route.ts` = `apps/web/app/api/near-miss/route.ts` ·
> `incidentRiskFeatures.ts`, `tenantGate.ts` = `apps/web/lib/…` ·
> `metricDetail.ts` = `apps/web/components/scorecard/metricDetail.ts` ·
> bare `.ts` metric modules = `packages/core/src/…` · bare `NNN_*.sql` = `apps/web/migrations/…`

---

## 1. Verdict

**No data warehouse. Build a conformed location dimension and a certified-definition registry, both
inside Postgres, and fix a regulated write path that is currently producing under-counted OSHA
filings.**

All four agents opened with different answers to the warehouse question — YES, NOT-YET, NO, and
WRONG-QUESTION — and after cross-critique **none of them advocates building one.** The BI analyst, who
argued for it, withdrew the fact tables outright on discovering that per-site annual TRIR is already at
grain in `osha_annual_summaries` and that the binding constraint is a missing foreign key on
`incidents` — upstream of any serving layer. What survives is two OLTP tables and a definition registry.

> **The caveat that reorders everything below.** This review went looking for an analytics problem and
> found a **regulatory-filing defect**. A recordable classified through the normal path is written to
> the OSHA 300 log with **no establishment and no facility**, and every establishment-scoped consumer
> filters it away. Where an establishment's cases are all orphaned, the product will submit an
> affirmative *"no injuries"* declaration. That is finding **F-1**, it is reachable by the happy path,
> and it outranks every performance and architecture item in this document.

Five answers, in the order they should be acted on:

- **Multi-location (§4):** does not work today. Two unreconciled location registries, `facilities` and
  `osha_establishments`, with no key between them. **Zero RLS policies anywhere in 258 migrations
  reference `establishment_id`** — per-establishment isolation is not enforced at all.
- **Warehouse (§5):** no. Every metric on the page is computable from existing tables. The reads should
  be bounded and then aggregated in Postgres under the caller's rights; that is rungs 1–3 of a six-rung
  ladder and nobody needs to climb past it.
- **Injury cost & MOD (§6):** yes to cost, tiered and gated. **Never compute a mod** — store the actual
  one from the rating worksheet. This is where the sharpest genuine disagreement survives (§10).
- **The metric set (§7):** the two highest-value additions need no schema change — **report lag** and a
  **serious-injury-potential** signal are computable from columns already fetched and currently ignored.
- **Biggest single improvement:** attach the audit facility the repo already has to the recordability
  determination. `public.log_audit()` is deployed **87 times** and reaches none of the tables carrying a
  five-year federal retention duty.

---

## 2. Method, and how to read this

Four agents, four deliberately conflicting lenses, each carrying a stated prior it had to hold until
evidence moved it. Each challenged exactly two others on named grounds, and every challenge had to state
what would change its mind.

| Agent | Owns | Prior (R1) | After critique (R2) |
|---|---|---|---|
| `bi-analyst` | Definitions, grain, conformed dimensions, cost/MOD | Warehouse **YES** | **NOT-YET** — fact tables withdrawn |
| `data-scientist` | Sample size, denominators, intervals, model validity | **WRONG-QUESTION** | **NOT-YET** — conceded the location dimension |
| `sql-developer` | Query cost, RLS, grain, migration safety, retention | **NO** | **NO** — held |
| `csp-safety-professional` | 1904 / Title 8, defensibility, behaviour | **WRONG-QUESTION** | **NOT-YET** — moved by its own new finding |

**Corroboration is reported, not averaged.** A finding reached independently by three blind agents is
stronger evidence than one asserted loudly. Where a claim was contradicted by a file citation it was
dropped or corrected regardless of how many agents made it — three such corrections are recorded in §11.

> **What this review could not do.** No database access: no query plans, no row counts, no evidence of
> how many production rows are actually affected. `page.tsx` has no tests, so none of the defects below
> would be caught by CI. Every quantitative claim about *live* data is marked UNVERIFIED in §12.

---

## 3. How the scorecard computes today

Every metric is produced by downloading raw rows into the browser and reducing them in JavaScript. The
architecture is deliberate and consistent — a pure summariser plus a thin orchestrator — and it is the
reason the defects below are invisible: nothing is wrong with the *arithmetic*, only with which rows
reach it.

| Property | Reality |
|---|---|
| Where computation happens | Browser, for all but the risk score, exports, and lead/lag correlation |
| Round trips per cold load | **15 client requests → ~38 database/auth round trips**; five tables read redundantly |
| Unbounded reads | **15**, of which 9 grow with the tenant's entire incident history |
| In-database aggregation | **None.** 17 views, **zero materialized views**, no metric RPCs, no rollup tables |
| Caching | One 60-second in-process `Map`, keyed by tenant only (`incidentRiskFeatures.ts:141`) |
| Error handling | Any of seven query failures → `null` → the entire OSHA section silently disappears |

The last row is why this went unnoticed. `fetchIncidentScorecardMetrics` returns `null` on error
(`incidentScorecardMetrics.ts:603-609`) and the caller's handler is `.catch(() => {})`
(`page.tsx:198`). **A failed query renders as good news.** An RLS regression on any of seven tables
presents identically to a tenant with no recordables.

---

## 4. Multi-location — the gap analysis

### 4.1 What is built, and built well

The facility plumbing is sound and deserves credit before the criticism. `active_facility_id()`
(`209_facilities.sql:83-97`) faithfully mirrors the proven tenant helper; header injection
(`packages/core/src/supabase.ts:111-119`) is clean; migration 210's two **explicit reviewed allow-lists**
with child tables deliberately excluded is rare discipline; and `FacilityProvider` hard-reloads on switch
so a slow in-flight query cannot render stale data under a new label — a bug class most teams ship.

### 4.2 The root cause: two registries for one real-world thing

`facilities` (migration 209, "one tenant → many facilities") and `osha_establishments`
(`065_osha_compliance.sql:24-32`, *"Per OSHA 1904, an 'establishment' is a single physical location"*)
both model *site*. **There is no foreign key, no mapping table, and no shared key in either direction.**

The consequences cascade:

- `incidents` carries `facility_id` and **no `establishment_id`** — verified, zero occurrences in
  `059_incidents_core.sql`. Its only location fields are free-text `location_text` and a `point`.
- `osha_establishments` carries neither `facility_id` nor any facility scoping — it is in neither
  allow-list of migration 210, so migration 211's loop (which selects only tables *having* the column)
  never considered it.
- **Zero RLS policies across all 258 migrations reference `establishment_id`** (verified). Per-establishment
  isolation does not exist. A site manager can read another site's 300 log today.

### 4.3 Findings

| ID | Sev | Finding | Evidence | Corrob. |
|---|---|---|---|---|
| **F-1** | **Critical** | **Recordables are written to the OSHA 300 log with no location, and disappear from every regulated view.** `classify/route.ts` never selects `facility_id` (`:131`) and writes `establishment_id: body.establishment_id ?? null` (`:182`). It uses the service-role client, so the `default active_facility_id()` from migration 210 also evaluates NULL — **both** location columns are NULL on every row it writes. Consumers filter on establishment (`300a/route.ts:71`, `ita-export/route.ts:78`), and `oshaForms.ts` sets `no_injuries` when the filtered count is zero. | verified in source | 3/4 |
| **F-2** | **Critical** | **The recordability determination is mutable and unaudited, silently restating published figures.** `incident_classifications` carries only `trg_classifications_touch` (`065:147`). `classify/route.ts:141` **upserts on `incident_id`**, overwriting `decision_path` — the field `065:96-100` says exists *"if a regulator questions a 'not recordable' call years later."* `:209-216` then **hard-deletes** the 300-log row. Every published rate reads the live value, and the weekly cron has already emailed the old one. | verified in source | 3/4 |
| **F-3** | **Critical** | **TRIR/DART/LTIR/severity mix scopes *and* periods.** `osha_establishments` is read with no filter whatsoever (`incidentScorecardMetrics.ts:598-600`) and summed across every establishment (`:620-629`), while the numerator is facility-scoped by RLS. Independently, the numerator is a **trailing-365-day** window and the denominator is keyed to the **current calendar year** — wrong for single-site tenants too. The code concedes it: *"A more accurate fiscal-year alignment lives in Phase 6."* | verified in source | 4/4 |
| **F-4** | **Critical** | **Near-misses are split across two tables and the scorecard reads the wrong one.** `POST /api/near-miss` writes `near_misses` (`route.ts:145`); the scorecard counts `incidents.incident_type='near_miss'` (`incidentScorecardMetrics.ts:466,487,500`). Migration 059b was a one-time copy whose follow-up never landed; triggers on `near_misses` are number/touch/audit/risk-mirror only — **no sync**. The undercount is **differential**: the web form files into `incidents`, the API and all three mobile screens into `near_misses`, so the channel mix moves month to month. | verified in source | 2/4 |
| **F-5** | **High** | **Migration 211 failed in both directions.** It rewrites only policies named exactly `<table>_tenant_scope` (`211:49-57`). `osha_300_log_entries`' policy is `osha_300_log_tenant_scope` (`065:226`) — it lands in the `custom` array and gets **no facility scoping** while carrying a defaulting `facility_id`. Roughly 28 tables are affected. It also **clobbered** `risks_tenant_scope`, a hand-written policy from migration 040 that happened to match the name. | verified for the 300 log | 4/4 |
| **F-6** | **High** | **The risk gauge is tenant-wide by construction, beside facility-scoped cards.** `incidentRiskFeatures.ts` uses the service-role client with `.eq('tenant_id', …)` only; `page.tsx:292` omits `x-active-facility` even though `tenantGate.ts:129` already builds a facility-carrying client. Also affects the exported PDF/XLSX and the weekly email — documents that leave the building with no scope label. **And `riskCache` is keyed by tenant alone (`:141`), so fixing the scoping without re-keying converts a wrong-scope bug into a cross-facility leak.** | verified | 4/4 |
| **F-7** | **High** | **The audit facility exists, is proven, and skips the regulated family.** `public.log_audit()` is attached **87 times** (verified). It reaches `incident_capas`, `incident_predictions` and `incident_severe_injury_reports` — and **not** `incident_classifications`, `osha_300_log_entries`, or `osha_annual_summaries`, the three tables under a five-year retention duty. Cost to fix: one line per table. | verified | 2/4 |
| **F-8** | **High** | **The `audit_log` 12-month prune has no retention exemption and no legal-hold predicate.** `242_retention_jobs.sql:20-24` deletes unconditionally. Verified: **zero** references to `legal_holds` or any table exemption in that migration. `151_tenant_retention_and_legal_holds.sql` declares an open hold prevents purge *"regardless of the tenant retention policy."* The job runs as the pg_cron owner, bypassing RLS. `audit_log` is commented *"immutable CRUD trail"* (`003:43`) but has **no** immutability trigger — unlike `risk_audit_log` and `near_miss_audit_log`, which do. | verified | 1/4 |
| **F-9** | **High** | **The 1904.32 posting attestation is a dead column.** `osha_annual_summaries.posted_at` is selected in three places and **written nowhere in the repo.** The POST upsert writes certification but not posting — the product tracks the easier half of 1904.32 and drops the half that gets cited. | verified | 1/4 |
| **F-10** | **Med** | **The streak badge renders green on no data.** `accent={streak < 0 || streak >= 30 ? 'safe' : …}` (`page.tsx:1023-1024`), where `streak < 0` means "none on file". **A tenant that has never classified an incident gets the green card.** Absence of data displays as safety, worst at the sites with the weakest recordkeeping. Compounding it: P(streak ≥ 30d) ≈ 92% at 1 recordable/yr, 72% at 4/yr — for most sites the green badge is the default state, not an achievement. | verified | 2/4 |
| **F-11** | **Med** | **Location attribution before migration 210 is fabricated.** `210:102-110` backfills every bucket-A row to `is_primary`. Any cross-site trend spanning the migration date compares invented attribution against real attribution, and nothing on screen says so. | verified | 2/4 |
| **F-12** | **Med** | **Four of the five LOTO tiles are facility-scoped and exactly one is not.** `loto_atmospheric_tests` is an excluded child table, so `failingTestRate` is tenant-wide beside a facility-scoped `cancelRate` — and the two feed one combined verdict tile (`page.tsx:600`). Same defect on the incident side: `incident_people` is excluded, so both injury heatmaps are tenant-wide. **One anomalous cell among five is more dangerous than five wrong ones.** | verified | 4/4 |

### 4.4 What "one company, many locations" actually requires

In dependency order. None of it is a warehouse.

1. **Pick one location dimension and make the write path resolve it.** `facilities.osha_establishment_id`
   many-to-one, cardinality declared and enforced. Backfill only where a tenant has exactly one of each;
   leave multi-site tenants NULL and drive an admin mapping screen. **Never guess** — a wrong mapping
   silently corrupts a regulated rate.
2. **Make `establishment_id` required and derived** on every 300-log write, never taken from an optional
   client field. Refuse to write a recordable that cannot be assigned, and surface an *unassigned
   recordables* queue that should read zero.
3. **Fix additivity before adding any per-site view.** Migration 211's `or facility_id is null` branch
   means "shared across all facilities" — correct for a chemical catalogue, catastrophic for an event.
   Per-facility counts must provably sum to the tenant total, with an explicit unassigned bucket.
4. **Repair the 211 skip list with an explicit reviewed allow-list**, not another `information_schema`
   loop — and ship the verification query with it, because there is no migration runner to enforce it.
5. **Label scope on every tile, and make the label travel** into the PDF, the XLSX and the weekly email.
   A tile that cannot honour the active filter must say so rather than silently widening.
6. **Then** build cross-site comparison — see §7 on why it must not be a ranked league table.

---

## 5. Do we need a data warehouse?

### 5.1 The question, restated properly

"Warehouse?" conflates three separable questions. Separating them is what let four agents disagree
productively and then converge.

| Question | Real answer here |
|---|---|
| **Serving** — is it too slow? | A *fetch-layer* problem: 38 round trips and 15 unbounded reads. Fixed by bounding reads and aggregating in Postgres. |
| **Semantics** — do the numbers mean one thing? | **No** — and this is the real defect. Two "recordable" definitions on one axis, two location registries, no owner. |
| **History** — can we see the past? | Mostly yes, and *better* than assumed. The lossy half is the one nobody suspected. |

### 5.2 Where each agent landed, after critique

- **`sql-developer` (NO).** Every RLS predicate is policy text; rows that leave Postgres leave their
  policies behind, and you would maintain tenant *and* facility isolation twice, the second copy untested
  — in a repo that just demonstrated it cannot keep isolation correct *inside* one database with a string
  match (F-5). Two `SECURITY INVOKER` RPCs cut ~38 round trips to ~6 with **no RLS change at all**,
  because the policies already do the work.
- **`bi-analyst` (YES → NOT-YET).** Withdrew the fact tables on evidence. Holds that the remedy for a
  metric meaning two things is a **certified definition with a named owner** — not better statistics and
  not a faster query.
- **`data-scientist` (WRONG-QUESTION → NOT-YET).** Conceded the conformed location dimension, still
  rejects fact tables: every surfaced metric is computable from existing tables. Notes the deeper gap is
  that the 19-indicator risk model has **never been validated against outcomes** — and now *cannot* be,
  because its outcome label (F-2) is mutable and unaudited.
- **`csp-safety-professional` (WRONG-QUESTION → NOT-YET).** Moved by its own finding: the number is wrong
  *because* of an architecture decision — no as-of pinning on the lagging side.

### 5.3 The history question, and the correction that matters

The review's opening hypothesis was that *leading* indicators are state-based and their history is
destroyed by updates, making period-over-period impossible without a snapshot table. **Three of four
agents rejected this independently, and they were right.**

`incident_actions` carries `created_at`, `due_at`, `completed_at`, `verified_at` under **DB-enforced
CHECK constraints** (`063_incident_actions.sql:67-73`): `complete`/`verified` must have `completed_at`;
open states must not. So *"overdue as of date D"* is exactly
`created_at <= D AND due_at < D AND (completed_at IS NULL OR completed_at > D)` — computable for any past
date from current state. Training expiry, permit expiry and BBS follow-ups resolve the same way. As the
CSP put it on conceding: a CHECK constraint is a *stronger* guarantee than a snapshot, because a snapshot
can be missed.

Genuinely lossy: `risks.next_review_date`, `jhas.next_review_date`, `risks.residual_band`,
`v_training_matrix.status`. Four fields, none of them regulated.

**And the inversion is the finding.** The *lagging* indicators carry the restatement risk (F-2). The
scorecard's OSHA rates depend on a mutable, unaudited field; one reclassification silently restates every
historical rate and disagrees with every digest already in an executive's inbox.

> One claim in this review was corrected mid-flight and is worth recording. The SQL developer argued the
> as-of pin *already exists* in `osha_300_log_entries`, citing its header. The data scientist refuted it
> and the refutation was verified: `classify/route.ts:209-216` **deletes** that row on down-classification
> and the recordable branch upserts. It is an overwrite cache with a delete path. The pin was *intended* —
> `065:6-14` says so — but the write path defeats it. Sourcing history from it does **not** buy
> reproducibility; append-only history on `incident_classifications` does.

### 5.4 The decision, and what to build instead

**Do not build a warehouse.** Climb the ladder only as far as the evidence pushes:

1. **Bound the reads.** Date floors on the four unbounded incident reads — all four are *already* window
   filtered in memory, so a server-side floor changes zero rendered numbers. Pure cost, no semantics.
   One exception: `recordablesAll` feeds `daysSinceLastRecordable` and `weekOverWeek`, which deliberately
   read all-time, so that floor must be the max of the window and the last-recordable lookback.
2. **Certify the definitions.** One row per metric: name, definition, grain, period, scope, owner,
   source tables, version. This is the artifact the product most lacks, and it is also §8's prerequisite.
3. **Aggregate in Postgres under invoker rights.** Two `SECURITY INVOKER` RPCs. No new storage, no
   refresh, no staleness budget, nobody paged, failure mode unchanged.
4. **Only then** consider one narrow daily fact table for the four genuinely-lossy fields. One table, one
   cron job, 24-hour staleness — and still not a warehouse.

**Decision triggers that would flip this to yes:** cross-tenant benchmarking; retention beyond the
five-year 1904.33 horizon; non-Postgres sources; or a measured p95 that survives steps 1–3.

---

## 6. Injury cost and operating-expense impact (EMR / MOD)

### 6.1 Why an EHS scorecard must speak in dollars

A plant manager who will not fund a machine guard for a safety reason will fund it for a $180,000 claim.
And here EMR is not only an expense — it is a **revenue gate**. Many general contractors and owners bar
bidders above 1.00, and USACE EM 385-1-1 solicitations carry EMR requirements. This repo already has a
`vendor_prequalifications` module in which customers collect their *subcontractors'* experience mods as
free text, and an `em385` module. **The product gates other companies on a number it will not compute
for its own customer.**

### 6.2 How the mod actually works — the parts that should reshape the scorecard

- **The lag.** The experience period is roughly three years ending about a year before the rating
  effective date. Today's injury reaches the mod in about twelve months and stays for three years. *That
  lag is itself the argument for leading indicators* — by the time the mod moves, the decision that caused
  it is four years old.
- **The split point** (NCCI ≈ $18,500, indexed) weights the primary portion of each claim heavily and
  discounts the excess. **Frequency damages the mod far more than severity.** Five $18,500 claims hurt
  substantially more than one $92,500 claim — and this scorecard's entire severity apparatus (severity
  rate, LTIR, total days away) aims at the half that hurts *less*.
- **The medical-only discount (ERA)** enters medical-only claims at roughly 30% of value, so **keeping a
  claim medical-only is worth about 70% of its mod impact.** `incident_care_cases.days_away_from_work`,
  `days_restricted` and `return_to_work_at` are already collected and already summarised — and carry no
  financial framing anywhere.
- **Incurred, not paid.** The mod uses paid plus outstanding reserves at a valuation date. An
  over-reserved open claim inflates it for three years even if it settles for less.
- **Bureau matters.** NCCI in ~38 states; **California is WCIRB** — material for a Cal/OSHA-leaning product.

### 6.3 The hard constraint

**This product cannot compute a real mod.** `059_incidents_core.sql:101` holds
`workers_comp_claim_number` — a bare identifier. There are **no** incurred, paid, reserve, class-code or
payroll-by-class columns anywhere in 258 migrations, and **no as-of or bitemporal modelling of any kind**.
A mod is an as-of quantity over a restated three-year period; stored as a scalar it is unauditable the
first time anyone asks "as of when?"

### 6.4 The tiers

| Tier | What | Ships when |
|---|---|---|
| **0** | Modeled cost of injury from the existing classification mix, using OSHA **$afety Pays** (direct cost by injury type × an indirect multiplier scaling inversely with direct cost, ≈×4.5 under $5k falling toward ×1.1 above $100k). Free, public, citable. Permanently badged modeled. | After F-1/F-3 — a cost model inherits TRIR's denominator, and costing a mis-scoped rate produces a dollar figure wrong by an unknown factor and far more citable than the rate |
| **1** | `wc_claim_valuations(claim_id, valuation_date, incurred, paid, reserve, status, source)`, append-only, natural key `(claim_id, valuation_date)` | With the first real loss-run import |
| **2** | **Actual** mod, entered/imported from the rating worksheet: value, effective date, bureau, state, expected losses, manual premium. Authoritative; drives all dollar math | Any time — it is data entry, not computation |
| **3** | **Projected** mod | **Contested — see §10** |

OSHA penalty amounts (~$16,550 serious, ~$165,514 willful/repeat) are **CPI-indexed annually** and belong
in configuration, never hardcoded. The repo already has `osha_regulation_updates` and a
`check-regulation-updates` cron that could carry them. This matters more than it sounds: `BLS_DATA_YEAR = 2022`
is hardcoded in `industryBenchmark.ts:26` with a comment instructing a refresh that never happened across
three publication cycles, so every industry-comparison badge on this page is four years stale and renders
perfectly.

### 6.5 The ship gate

Adopted by all four agents. Non-negotiable, and the CSP's reversal on cost was conditional on it.

1. **Cost is expressed per *recorded* case, never as a total to be minimised.** No view in which
   recording one more case makes the number look better.
2. **Reporting-health ships in the same view** — near-miss reporting rate, median report lag,
   anonymous-report volume, and a reporting-down-while-activity-flat flag. Same screen, same export.
3. **Near-miss volume is never coloured as a negative.** Rising is good news; red on that series is a defect.
4. **No cost or rate figure feeds a bonus, ranking, or site-vs-site league table.**
5. **F-2 closed** — recordability changes versioned and attributable; no `DELETE` on the 300 log.
6. **F-1 closed** — `establishment_id` cannot be nulled by omission; every rate carries its establishment
   scope on its face.
7. **Every published rate names its as-of date and links to the case list behind it.** A number an EHS
   manager cannot drill to the case file is not defensible to a compliance officer, an insurer, or a
   plaintiff's attorney — and those three are who these numbers eventually meet.

---

## 7. What the scorecard should measure

Organised by the three outcomes: keep people safe, stay compliant, reduce cost.

### 7.1 Computable today, from columns already fetched — the highest value per unit of work

- **Report lag** — median and p90 from `occurred_at` to `reported_at`. **Both columns are already in the
  same result set** (`incidentScorecardMetrics.ts:580`) and `reported_at` is used only for time-to-close.
  It is simultaneously a well-documented claim-cost driver and the cleanest read on whether people feel
  safe speaking up. A rising lag moves *before* the incident count does.
- **Serious-injury-and-fatality potential** — `incidents.severity_potential` exists on every incident
  (`incident.ts:75`) and appears **zero times** in the scorecard. Fatalities are largely not drawn from
  the same causal population as minor injuries, so a recordable rate poorly predicts fatality risk;
  organisations reach their lowest-ever TRIR in the year they kill someone.
- **Hierarchy-of-controls mix** — already computed (`incidentScorecardMetrics.ts:360-373`) and never
  rendered as a headline. A programme whose closed CAPAs cluster at PPE and administrative controls
  carries high inherent risk regardless of its incident count. **This single ratio predicts more about
  next year than TRIR does** (see §9).
- **Unassigned recordables** — cases on no establishment's log. Should be zero; should be loud when it
  is not. The direct read on F-1.

### 7.2 Compliance clocks — each one is a place software can quietly fail an employer

**1904.39** reportability countdown (fatality ≤8 h; in-patient hospitalisation, amputation or loss of an
eye ≤24 h) — the data already sits in `incident_severe_injury_reports` and appears nowhere on the
scorecard. **Cal/OSHA requires reporting of any serious injury within 8 hours and defines "serious" more
broadly than the federal trigger list, so a California employer following a 24-hour clock is late.**
Also: **1904.32** posting Feb 1 – Apr 30 (blocked on F-9), **1904.41** ITA submission by March 2,
**1904.33** five-year retention, **1904.30** per-establishment logs.

**A live Cal/OSHA gap:** T8 **§3342 / SB 553 Workplace Violence Prevention Plan** has applied to nearly
all California employers since July 2024 and carries **its own violent-incident log, kept separately from
the OSHA 300**. In this repo workplace violence exists only as a *toolbox talk* citing OSHA 3148 — a
federal guidance document for healthcare, not the Cal/OSHA regulation. There is nowhere to put the log.
The compliance calendar seeds are federal-only: no §3203 IIPP, no §3395 heat illness.

### 7.3 On the small-denominator problem — and why not to ship a leaderboard

TRIR's 200,000-hour base is 100 full-time-equivalent years. At site grain the denominator is small and the
rate is dominated by chance — the migration's own example establishment is 47–49 employees. **A ranked
site table mostly ranks luck:** the smallest site has the widest interval and will appear at both the top
and the bottom over time, and someone will write an improvement narrative for each. Regression to the mean
then manufactures an intervention success story out of nothing.

Use a **funnel plot** — rate against exposure with control limits that widen as exposure shrinks — or
**empirical-Bayes shrinkage** toward the tenant mean. `cChartLimits` and `pChartLimits`
(`forecast.ts:77,89`) are the same family, so this is reuse, not new machinery. The BI analyst withdrew
its ranked-leaderboard position on this evidence.

**But the executive need is real**, and the CSP's framing resolves it: if a single number is required,
make it the **worst establishment** or the **count of establishments above their own benchmark** — both
point at a place a person can drive to, neither pretends to rank.

### 7.4 What to demote

`daysSinceLastRecordable` as a headline card is the metric most likely to produce concealment on this
page — a visible streak counter creates direct pressure on the person deciding whether the next case is
recordable. Its own drill-down copy already concedes it (*"a quiet streak with no near-misses can mask
under-reporting"*). Pair it with reporting health or move it to the drill-down. See also F-10.

---

## 8. An AI-driven OLAP layer

The requested capability — ask a question, get roll-up / drill-down / slice-and-dice — **converges on the
same root fix as everything else in this document.** An AI analytical layer needs a semantic layer *more*
urgently than a warehouse does, because the model must know what "recordable" means, at what grain, and
which location dimension is authoritative. Today there are two definitions of recordable (F-2, and the
YoY split) and two location registries (§4.2). **A conversational layer over ambiguous semantics will
return different answers to the same question and be believed.**

Design, in dependency order:

1. **The semantic catalog first**, in `packages/core/` — typed, declarative metrics (name, symbolic
   formula, grain, denominator, source tables, caveats, scope) and dimensions. This is §5.4's definition
   registry, and it pays for itself immediately as the shared source of truth for the scorecard wiki and
   `metricDetail.ts`.
2. **The model never emits SQL.** It selects a metric, dimensions, filters and a time grain from an
   **enum-bounded tool schema**; deterministic code builds the query. Free-form text-to-SQL over 254
   tables and 387 policies is a security and correctness hazard. Note `exec_readonly_sql` exists but is
   superadmin + service-role; it must not become the tenant-user path.
3. **Execute under RLS as the user** — so tenant and facility scoping are enforced by the database rather
   than by the prompt. PostgREST populates `request.headers` for RPC calls, which is exactly why the
   invoker-rights RPC in §5.4 is the right substrate.
4. **Statistical guardrails in code, not prompt.** Every aggregate returns `n` and an interval; the layer
   **refuses to rank or declare a trend** below threshold. This is the `applyHardGate()` pattern from the
   LOTO audit applied to analytics.
5. **Provenance on every answer** — definition, window, denominator, row count, and a link to the case
   list. A chat answer about injury rates will eventually be quoted somewhere that matters.
6. **Reuse the Operator Console plumbing** — an `analytics` agent id and surface in `OPERATOR_AGENTS`,
   `MODEL_BY_SURFACE` and `AI_LIMITS` (a unit test already enforces those three stay in sync).

**Do not ship rate metrics through this layer until F-1 and F-3 are closed.** A conversational interface
makes a mis-scoped rate *more* quotable, not less.

---

## 9. Inherent organizational risk and data mining

**"Inherent" is the load-bearing word.** Inherent risk is risk *before* controls; residual is what remains
after. An organisation with low incident counts but a control stack dominated by PPE and administrative
rules carries **high inherent risk masked by luck** — and a scorecard of lagging outcomes cannot see it.
This is the same truth as the SIF point: driving a recordable rate down does not reliably reduce the risk
anyone loses sleep over.

**The strongest signal is already computable.** `risk_controls_hierarchy`, `controls_library`, and ECFA
causal factors coded by ICAM taxonomy, failed/missing barrier and hierarchy-of-controls level all exist.
Mining the *distribution of control levels* across the risk register and across ECFA causal factors is a
direct measure of inherent-versus-residual posture, needs no new data, and belongs on the scorecard as a
headline rather than a buried chart.

**Techniques worth building**, in rough order of value per unit of effort:

- **Repeat-barrier-failure mining** across ECFA causal factors — the same weak barrier failing across
  unrelated incidents *is* systemic organizational risk, and the coding already exists.
- **Narrative text mining** — `incidents.description`, `immediate_action_taken`, witness statements, ECFA
  nodes and BBS observations are free text that structured codes miss. The entire pipeline already
  exists: `lib/ai/embeddings.ts`, `chunker.ts`, pgvector, `match_knowledge_chunks`. Clustering incident
  narratives by embedding is reuse, not new machinery.
- **Association mining** across shift, task, equipment family, permit type and time of day — reporting
  **lift**, not bare confidence.
- **Sequence mining** — extending `laggedCorrelation` from single-indicator lag to event sequences.

**The guardrails are not optional, and this repo's existing lead/lag panel is the cautionary tale.** That
panel takes `max |r|` over five lags against a fixed `rFloor = 0.3` with no multiple-comparisons
correction. Under an independent-Poisson null the false-positive rate is **~78% per indicator**, and with
four indicators the panel shows at least one false signal **99.8%** of the time — the null 95th percentile
of `max |r|` is 0.63, not 0.30. Worse, one of its series, `capa_opened`, is sourced from
`incident_actions`, which has `incident_id NOT NULL` — **it is a mechanical child of the outcome it
claims to precede.** The panel is a spurious-correlation generator advertising itself as the opposite.

So any mining programme must require: minimum support; **lift over confidence**; a multiple-comparisons
correction (Benjamini–Hochberg FDR); temporal holdout validation; and output labelled **hypotheses to
investigate** in the artifact itself, not in a caption.

**And one guardrail that is not statistical.** Mined patterns encode bias. *"Contractors have more
incidents"* may reflect who reports, not who is exposed. Any analysis segmenting by people — shift, crew,
supervisor, employment type — must route to systemic factors, or it becomes an instrument of blame and
reporting dries up. This repo already takes that stance: the rebuilt 5 Whys editor flags person-blaming
answers with an anti-blame guardrail. Hold that line.

---

## 10. Unresolved disagreements

Recorded rather than averaged. Each is a genuine trade-off, not a fact the repo can settle.

**10.1 — Should a *projected* mod ever ship?**

- **`bi-analyst`:** yes, as Tier 3, permanently badged and interval-bearing. Leadership needs what-if, and
  the alternative is that the conversation happens in a spreadsheet nobody reviews.
- **`data-scientist`: no, firmer after critique.** A projected mod is a point estimate over a claim count
  that F-1 mis-scopes and a classification target that is mutable and unaudited. Shipping it would
  violate the product's own precedent — the same screen renders 95% intervals on TRIR, DART, LTIR and RCA.
- **`csp-safety-professional`:** conditional yes, only behind the full §6.5 gate.
- **Decisive test:** whether a real loss run, once imported, yields a projected mod whose interval is
  narrow enough to support a decision. Until Tier 1 exists this is unanswerable. **Owner: whoever signs
  the first customer's insurance conversation.**

**10.2 — Which defect class owns remediation?**

`bi-analyst` holds that the remedy for a metric meaning two things is a **certified definition with a
named owner** — not better statistics, not a faster query, not a corrected recordability rule. The other
three would each start elsewhere. As the BI analyst put it: this is not a dispute about the code, which
all four agree on line for line; it is a dispute about *who gets paged when the number is wrong*. Today
nobody does, and that is itself the finding.

**10.3 — The gate for a serious-injury-potential rate.**

- **`data-scientist`:** `severity_potential` is subjectively coded with no inter-rater check anywhere.
  Require double-coding of 50–100 historical incidents at Cohen's/Krippendorff's κ ≥ 0.7 before publishing
  a rate.
- **`csp-safety-professional`:** right instrument, wrong scope. That is the correct bar for a *rate*, too
  high for a *triage flag* — and holding the flag hostage to a study means the only fatality-facing signal
  ships never. Counter-proposal: ship a binary life-critical screen now, run the study, gate the *rate* on κ.
- **Both agree** potential severity is the right thing to track. **Decisive test:** run the double-coding.

---

## 11. Where the agents changed their minds

This section is the evidence the critique was real rather than theatre. If it were empty, the review would
have failed and should have been re-run.

- **The review's own opening hypothesis was wrong.** "Leading-indicator history is destroyed by updates,
  so period-over-period needs a snapshot table" was rejected by three of four agents independently, on the
  same evidence (§5.3). It would have misdirected the month-over-month work from *write the query* to
  *build history capture* — weeks of unnecessary migration work.
- **`csp-safety-professional` conceded it without hedging**, having been the one agent to confirm it:
  *"I withdraw H-G as stated and I do not want it re-scoped into something smaller to save face — it was
  the wrong finding."* It then found F-2, in its own lane, which it had missed in Round 1.
- **`csp-safety-professional` reversed on cost**, NO → conditional yes, moved by the BI analyst's
  medical-only/return-to-work argument: in a domain where every financial signal pushes toward
  suppression, that one pushes the other way, and refusing to say it out of squeamishness forfeits it.
- **`bi-analyst` withdrew the warehouse fact tables** — *"I drop the fact tables, not defer them, drop
  them"* — and withdrew its ranked leaderboard to the data scientist.
- **`sql-developer` split its own recommendation** rather than defend it whole, conceding that bounding
  `incident_actions` would silently redefine a metric it does not own.
- **Three claims were corrected against source and are recorded here rather than in the findings:**
  (a) the alleged third hardcoded OSHA constant in `metricDetail.ts` does not exist — those are display
  strings, not arithmetic; (b) `log_audit` *is* attached to three peripheral incident tables, not zero as
  claimed — the material finding survives and is sharper, since it skips exactly the regulated three
  (F-7); (c) `osha_300_log_entries` is **not** an as-of pin, refuting the agent who proposed sourcing
  history from it (§5.3).

---

## 12. What this review could not verify

Every item needs a live database. None is blocking for the recommendations, all are blocking for
knowing the blast radius.

- **How many production 300-log rows carry a NULL establishment**, and whether any certified 300A or ITA
  submission was produced while orphans existed. This is F-1's blast radius and it should be run before
  the next certification cycle:
  `select count(*) from osha_300_log_entries where establishment_id is null group by tenant_id, year`.
- **The volume in `near_misses` versus `incidents where incident_type='near_miss'` since migration 059b** —
  the exact magnitude of F-4, and the first query worth running.
- **Whether any tenant currently operates more than one facility or establishment**, which determines
  whether F-1, F-3, F-6 and F-12 are live or latent. All are silent by construction, so absence of
  complaints is not evidence of absence.
- **Whether `hours_employees_by_year` is populated at all**, for which years and establishments. If it is
  sparse, the OSHA rates are already rendering blank in production.
- **Which migrations are actually applied.** There is no migration runner and no `schema_migrations`
  ledger. If 211 was never run, the facility findings change character entirely.
- **Whether `current_setting('request.headers')` is populated inside a function invoked via `POST /rpc/…`**
  on this PostgREST version. §5.4's entire correctness argument rests on it, and it is trivially testable.
  **Do this before writing any RPC.**
- **Inter-rater agreement on `severity_potential`** (§10.3), and **query plans** for every index-fitness
  judgment in this document.

---

## 13. Prioritised recommendations

**P0 — regulated correctness. These produce wrong or missing filings.**

| # | Action | Refs |
|---|---|---|
| 1 | Derive `establishment_id` from the incident on every 300-log write; refuse to write an unassignable recordable; surface an unassigned-recordables queue; backfill existing orphans before the next certification cycle | F-1 |
| 2 | Attach `log_audit()` to `incident_classifications`, `osha_300_log_entries`, `osha_annual_summaries`. Replace the 300-log `DELETE` with a soft-remove carrying reason and prior classification. Block or force-acknowledge reclassification against a certified year. Note the classify route uses the service-role client, so the actor must come from `gate.userId` or the audit records nobody | F-2, F-7 |
| 3 | Fix the TRIR denominator: match numerator and denominator on both **scope** and **period**. The period half is wrong for single-site tenants too | F-3 |
| 4 | Exempt 1904-derived rows from the 12-month `audit_log` prune and add a `legal_holds` predicate; add the immutability trigger the comment already claims | F-8 |
| 5 | Make `posted_at` writable and required to close the 1904.32 obligation | F-9 |

**P1 — silent data corruption and scope confusion.**

| # | Action | Refs |
|---|---|---|
| 6 | Unify the near-miss write path, or read across both with de-duplication on `legacy_near_miss_id`. Until then, caveat every near-miss figure — including the risk driver, where the undercount is worth up to 8.3 points on a 0–100 score whose bands cut at 25/50/75 | F-4 |
| 7 | Repair migration 211's skip list with an explicit reviewed allow-list; restore whatever migration 040 encoded in `risks_tenant_scope`; ship the verification query with it | F-5 |
| 8 | Send `x-active-facility` from the three insight call sites; switch `computeIncidentRisk` to `gate.authedClient`; **re-key `riskCache` to `${tenantId}:${facilityId ?? 'rollup'}` in the same commit** | F-6 |
| 9 | Label scope and period on every tile, and carry the label into the PDF, XLSX and weekly email | F-3, F-6, F-12 |
| 10 | Render an error state for the OSHA section instead of hiding it — absence currently reads as "no recordables" | §3 |

**P2 — measurement quality.**

| # | Action | Refs |
|---|---|---|
| 11 | Ship **report lag** and a **SIF-potential** signal — the two highest-value additions, both from columns already fetched | §7.1 |
| 12 | Normalise the risk model by exposure; rename "Predicted incident risk" to what the evidence supports until an evaluation exists, and bump the model version so exported PDFs are not stranded | §5.2 |
| 13 | Fix or retire the lead/lag panel: drop `capa_opened` (leakage), replace the fixed `rFloor` with a permutation-calibrated threshold, report BH-adjusted q, and label it "hypotheses to investigate" in the heading | §9 |
| 14 | Window `actionClosureOnTimePct` and `hierarchyOfControlsMix`; treat undated actions as a visible third bucket rather than silent on-time credit | §7 |
| 15 | Move BLS benchmark data and penalty amounts into configuration; make the NAICS pick deterministic and per-establishment | §6.4 |
| 16 | Publish the certified-definition registry (§5.4 step 2) — the prerequisite for §8 | §5, §8 |

**P3 — hygiene.** Consolidate the duplicated OSHA rate constant; unify the two window definitions in
`summarizeScorecardFromRows` so the KPI strip and the chart beneath it cover the same days; generate
`database.types.ts`; add tests for `page.tsx`, which today has none.

---

## Appendix A — the agent roster and critique graph

Definitions live in `.claude/agents/`. Each agent's `tools` omits `Write` and `Edit` — a structural
guarantee they cannot mutate the repo or recurse into each other, following the same instinct as
`applyHardGate()` in `apps/web/lib/loto/audit/agents/ehs.ts`.

Eight directed edges; each agent challenges exactly two and is challenged by two. Every challenge had to
state **what would change its mind** — a challenge with no falsifier is a complaint.

| Challenger → Target | Grounds |
|---|---|
| BI → SQL | A fast wrong number is worse than a slow one, because it gets trusted |
| BI → CSP | A KPI with no owner and no decision is dashboard debt; and a programme that cannot speak in dollars loses its budget |
| DS → BI | Name one analytical question today's schema cannot answer; leaderboards rank luck |
| DS → CSP | Small-denominator lagging indicators cannot support the verdicts attached to them |
| SQL → BI | Who owns the pipeline, what is the freshness budget, how does isolation survive leaving Postgres, what happens on restatement |
| SQL → DS | You cannot model on data the schema never durably records |
| CSP → DS | A compliance officer does not accept a confidence interval on a posted 300A |
| CSP → SQL | A rollup must never become the system of record for a retained record |

To re-run this review, invoke the four agents blind on the same brief, then circulate their reports for a
critique round. **If the critique round produces no concessions and no rebuttals, the run failed** — four
agreeable models produce a confident report that hides its own trade-offs, which is the outcome this
design exists to prevent.
