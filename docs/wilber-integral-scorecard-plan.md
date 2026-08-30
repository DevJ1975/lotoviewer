# Wilber Integral Model × EHS Scorecard — Integration Plan

Bringing the four-quadrant integral model from Workplace Learning System's
**Safety360** course into the Soteria Field EHS Scorecard, so the scorecard
answers not just *"how risky are we?"* but *"is our safety effort whole,
balanced, and maturing?"*

Authored with four specialist agents (now in `.claude/agents/` for reuse):
`csp-safety-expert` (metric taxonomy, scoring, integrity),
`wilber-integral-model-expert` (quadrant ontology, balance math, copy),
`saas-developer` (architecture, phasing), `ui-ux-designer` (dashboard design).

---

## 1. The source model (Safety360 course reference guide)

Section 2 of the WLS handout presents **Wilber's Integral Model** as a
four-blade pinwheel swirling clockwise around the word **Culture**:

- Axes: **Individual** (top) ↔ **Community** (bottom); **Interior** (left,
  can't be seen directly) ↔ **Exterior** (right, observable).
- Quadrants: **Intentional** (red blade, individual interior — mindset,
  belief, commitment), **Behavioral** (white blade, individual exterior —
  observable acts), **Cultural** (black blade, community interior — shared
  norms and trust), **Systems** (gray blade, community exterior — procedures,
  structures, controls).
- Culture sits at the hub because all four quadrants produce it together.

Section 5 ("Metrics as Indicators — what gets measured gets done") gives the
maturity spectrum this plan adopts as a primary axis:

| Band | Safety360 examples |
|---|---|
| **Reactive** | Injury & illness data · Litigation · Regulatory intervention · Loss data |
| **Transitional** | First aid · Near miss corrected · Repeat incidents |
| **Predictive** | SAT activity · Training hours · Perception surveys |

Sections 6–12 (Heinrich's triangle, hierarchy of controls, coaching
conversations, kind/necessary/true feedback, safety pledge) supply the
practices that become countable events for the interior quadrants in Phase 3.

## 2. The value framework — better than bare leading/lagging

Leading-vs-lagging is a **timing** question (did we measure before or after
harm). It stays as a label on every metric, but it cannot be the spine: a
scorecard full of leading indicators can still be blind, because every one of
them can live in the two easy-to-count exterior quadrants. The integral
question is **completeness** — are we looking at all four sources of the
outcome?

The scorecard therefore tracks against:

| Value | Range | Meaning |
|---|---|---|
| **Quadrant Health ×4** | 0–100 or null | `100 − mean(pressure)` over the quadrant's *measured process* signals. Null when unmeasured — never a fake 0. |
| **Quadrant Coverage ×4** | 0–1 | Share of the quadrant's defined metrics with fresh data. Distinguishes "weak corner" from "un-instrumented corner" — different problems, different fixes. |
| **Integral Balance Index** | 0–100 | `geometricMean(measured quadrant healths) × (measuredQuadrants / 4)`. The geometric mean makes any weak quadrant drag hard; the coverage factor guarantees an unmeasured quadrant lowers balance — you cannot be "balanced" around a corner you've never looked at. Bands: blind < 30 ≤ emerging < 55 ≤ balanced < 80 ≤ integrated. "Integrated" is unreachable while any quadrant is unmeasured (3 of 4 caps the index at 75). |
| **Limiting Quadrant** | name | The measured quadrant with the lowest health — the Liebig "weakest corner" to invest in next. |
| **Program Maturity Index** | 0–100 | Band-weighted mean of per-signal health, weights reactive 1 / transitional 2 / predictive 3. Being instrumented **and** performing on upstream evidence moves it most; a flawless lagging record alone cannot. |
| **Predictive Evidence Share** | 0–1 | Fraction of band-weighted evidence in the predictive band — "how forward-looking is our measurement." |
| **Outcome plane** (existing) | — | TRIR, DART, LTIR, severity, recordables stay on their own plane (the existing incident scorecard section). Harm outcomes are what the quadrants jointly *produce*, not a corner's health. |

**Load-bearing rule — the outcome plane.** Lagging harm metrics are
classified (`scope: 'outcome'`) but excluded from quadrant health. A quadrant
must never look healthy merely because nobody got hurt this month; that would
rebuild the old lagging scorecard inside the new frame and quietly punish
honest reporting. Outcomes still count toward the Maturity Index (measuring
your injuries *is* reactive-band evidence) and stay fully visible in the
existing OSHA section.

**Empirical, per-tenant validation.** The existing
`leadingIndicatorSignals.ts` correlation engine is the honesty layer: it
learns which quadrant movements actually precede *this tenant's* outcome
movements (reporting r, lag, n, reliability), instead of borrowing another
site's assumptions.

## 3. Metric catalog — quadrant × maturity matrix

Classification of the full metric surface. **Phase 1 (✓ shipped in this PR)**
covers the 16 ids computable today from `incidentRiskModel` drivers +
incident-scorecard KPIs; the rest are catalog entries for later phases.
Class: L = leading, G = lagging. Band: R/T/P = reactive / transitional /
predictive.

### Systems — "The way it's built" (community exterior)

| metric_id | Band | Class | Source | Phase |
|---|---|---|---|---|
| `capa_overdue` | T | L | incident_actions | 1 ✓ |
| `risk_reviews_overdue` | T | L | risks | 1 ✓ |
| `open_high_risks` | P | L | risks | 1 ✓ |
| `atmospheric_failures` | T | L | loto_atmospheric_tests | 1 ✓ |
| `inspection_failing` | T | L | inspections | 1 ✓ |
| `bbs_followup_overdue` | T | L | bbs_observations_v2 | 1 ✓ |
| `jha_reviews_overdue` | T | L | jhas | 1 ✓ |
| `permit_noncompliance` | T | L | cs/hot-work permits | 1 ✓ |
| `ecfa_weak_controls` | P | L | incident_ecfa_nodes | 1 ✓ |
| `rca_completion` | T | L | incident_investigations | 1 ✓ |
| `time_to_close` | T | L | incidents | 1 ✓ |
| `hierarchy_of_controls_mix` | P | L | incident_actions | 2 |
| `capa_reopen_rate` | T | L | incident_actions | 2 |
| `inspection_completion_pct` | T | L | inspections | 2 |
| `loto_procedure_coverage_pct` | P | L | loto_equipment | 2 |
| `loto_review_currency_pct` | P | L | loto reviews | 2 |
| `sds_currency_pct` | T | L | chemicals/SDS | 2 |
| `mean_days_to_rtw` | T | G | incident_care_cases | 2 (outcome) |

### Behavioral — "Seen in the act" (individual exterior)

| metric_id | Band | Class | Source | Phase |
|---|---|---|---|---|
| `bbs_ratio` | P | L | bbs_observations_v2 | 1 ✓ |
| `training_expired` | T | L | loto_training_records | 1 ✓ |
| `training_gaps` | P | L | v_training_matrix | 1 ✓ |
| `recordable_trend` | R | G | incidents (**outcome plane**) | 1 ✓ |
| `bbs_observation_rate` | P | L | bbs_observations_v2 | 2 |
| `bbs_at_risk_pct` | P | L | bbs_observations_v2 (≥30 obs) | 2 |
| `bbs_action_linkage_pct` | P | L | bbs_observations_v2 | 2 |
| `good_work_conversations_rate` | P | L | coaching log (new) | 3 |
| `concern_conversations_rate` | P | L | coaching log (new) | 3 |
| first aid / repeat incidents | T | G | incidents (**outcome plane**) | 2 |

### Cultural — "The way we do things" (community interior)

| metric_id | Band | Class | Source | Phase |
|---|---|---|---|---|
| `near_miss_reporting` | T | L | incidents (near_miss) | 1 ✓ |
| `near_miss_corrected_pct` | T | L | near-miss CAPAs | 2 |
| `toolbox_talk_participation` | T | L | toolbox_talks | 2 |
| `perception_survey_participation` | P | L | surveys (new) | 3 |
| `perception_survey_favorability` | P | L | surveys (new) | 3 |
| `sat_activity_rate` | P | L | committee module (new) | 3 |
| `toolbox_discussion_quality` | P | L | toolbox ratings (new) | 3 |
| `recognition_events` | P | L | recognition log (new) | 3 |

### Intentional — "Head & heart" (individual interior) — *structurally unmeasured until Phase 3*

| metric_id | Band | Class | Source | Phase |
|---|---|---|---|---|
| `safety_commitment_participation` | P | L | pledges (new) | 3 |
| `commitment_followthrough_pct` | P | L | pledges (new) | 3 |
| `perceived_risk_self_assessment` | P | L | check-ins (new) | 3 |
| `perception_items_i` ("I believe injury-free is possible") | P | L | surveys (new) | 3 |
| `training_hours_per_worker` / `training_effectiveness_pct` | P | L | training | 2–3 |

The Systems-heavy tilt is expected and honest — management systems are the
most-instrumented surface today. The Balance Index exists to keep that tilt
visible instead of letting it masquerade as a complete program. Interior
metrics are **proxies** (a survey is not a mindset) and must always render as
such.

## 4. What shipped in this PR (Phase 1 core)

**`packages/core/src/integralModel.ts`** — pure, no I/O, colocated tests
(19, all passing; suite total 176):

- Ontology: `Quadrant`, `MaturityBand`, `IndicatorScope` ('process' |
  'outcome'), `QUADRANT_META` (labels, axes, taglines, tooltips),
  `MATURITY_META`, `MATURITY_WEIGHT` (1/2/3).
- `INTEGRAL_CLASS: Record<IntegralMetricId, IndicatorClass>` — exhaustive,
  tunable classification of the 16 Phase-1 ids (14 risk-driver keys verbatim
  + `rca_completion` + `time_to_close`). A test asserts every risk-model
  driver key is classified and its leading/lagging kind cannot drift.
- `summarizeIntegralScorecard(signals)` → quadrant healths + coverage,
  `balanceIndex`, `limitingQuadrant`, `maturityIndex`,
  `predictiveEvidenceShare`, `overallHealth`, `modelVersion`. Null-honest
  end to end; degenerate inputs produce nulls and zeros, never NaN.
- Adapters: `integralSignalsFromRisk(IncidentRiskResult)` and
  `integralSignalsFromIncidentMetrics({rcaCompletionPct,
  meanTimeToCloseDays})` — the latter deliberately emits only the two ids no
  risk driver covers (double-count guard, test-asserted).
- Import via subpath: `@soteria/core/integralModel` (matches the
  risk-model/targets convention; barrel untouched).

**Architecture decisions** (per the SaaS agent's review of the real seams):

1. Classification lives in the new module, not in `incidentRiskModel.ts` —
   the risk model is a versioned scored contract; the integral layer composes
   over its public `drivers` output by key. `INTEGRAL_CLASS` covers metrics
   the risk model doesn't.
2. `IntegralMetricId` is app-layer only — it never touches SQL, so the 5-key
   `ehs_scorecard_targets` CHECK is unaffected.
3. Phase 1 UI needs **zero new fetches, zero tables, zero nav changes**: the
   scorecard page already holds `risk` and `incidentMetrics` in state; a
   `useMemo` builds the signals and calls the summarizer.
4. Persistence is compute-on-read until trends are wanted (Phase 2 snapshot
   table below).

## 5. UI plan (Phase 1 build, next PR)

Full spec from the UI/UX agent; the decisive points:

- **Placement**: new `IntegralSafetySection` between `PredictedRiskCard` and
  `FocusCard` in `apps/web/app/admin/insights/scorecard/page.tsx`. Reading
  order: risk gauge answers "how risky?", integral section answers "is our
  effort whole and maturing?", AI focus answers "what do I do first?".
- **`LeadingLaggingPanel` is demoted, not deleted**: the section carries a
  two-lens `Tabs` — "Four quadrants" (default, new `IntegralQuadrantGrid`)
  and "Leading vs lagging" (the existing panel unchanged). One section, two
  projections of the same driver set; the standalone panel render is removed.
- **Quadrant grid**: 3×3 CSS grid — four corner `QuadrantCell`s, center
  `CultureHub` (original SVG pinwheel, slow-spin only in Present mode,
  reduced-motion safe), the empty cross forming the axis lines; axis rails as
  real text (INDIVIDUAL / COMMUNITY / INTERIOR / EXTERIOR). Mobile: hub
  banner + single-column stack (Intentional → Behavioral → Cultural →
  Systems) with axis breadcrumb chips.
- **Color resolution** (the WLS palette conflict, settled): dashboard status
  colors (red = harm/overdue) are reserved for *scores*; quadrant *identity*
  uses a non-status arc — violet (Intentional), cyan (Behavioral), fuchsia
  (Cultural), steel (Systems) as `--color-integral-*` tokens, appearing only
  on rails/icons/hub blades, never on the score itself. The literal WLS
  red/white/black/gray appears only as a heritage legend in print/PDF.
- **Score strip**: `BalanceDial` (RiskGauge vocabulary, inverted goodness) +
  `MaturitySpectrumBar` (Reactive→Predictive track, graphite ramp — a
  journey, not a grade). Composite renders in the hub, deliberately smaller
  than the four cell scores.
- **Empty states are first-class**: Intentional launches as a recessed,
  dashed "Not yet measured here" cell with CTAs (Start Perception Surveys /
  Enable Toolbox Talks); low coverage (<40%) renders hatched + "read as
  directional"; suppressed small-n shows "hidden to avoid identifying
  someone"; a no-data tenant gets an educational hero instead of dials.
- **Drill-down**: cell → `QuadrantDetailSheet` (members grouped by maturity
  band, reusing the panel row markup) → existing `MetricDetailSheet` (gains
  an optional `chips` prop + `classification` field) → module href. Four
  clicks from score to the owning queue.
- **New components**: `IntegralSafetySection`, `IntegralScoreStrip`,
  `BalanceDial`, `MaturitySpectrumBar`, `IntegralQuadrantGrid`,
  `QuadrantCell`, `CultureHub`, `QuadrantDetailSheet`,
  `ClassificationChips`, plus `integralQuadrants.ts` presentation
  descriptors. A11y: real buttons, composed aria-labels naming axis
  position, focus-reachable tooltips, color never the sole channel.

## 6. Scoring integrity rules (enforced, not aspirational)

Condensed from the CSP's 16 rules + the integral expert's 8 anti-patterns;
the Phase-1 code already enforces 1–4:

1. **Null over fake zero** — empty denominators render "—" (never 0/NaN);
   unmeasured quadrants are null and *lower* the Balance Index via its
   coverage factor.
2. **Outcome plane** — lagging harm never feeds quadrant health (scope
   guard, test-asserted).
3. **No double counting** — each underlying series enters the composite once
   (adapter emits only non-driver ids, test-asserted).
4. **Direction of goodness is metadata** — pressures are pre-normalized
   "higher = worse"; rising near-miss reporting must never render red.
5. **Small denominators lie** — suppress percentages under 5 events
   (BBS at-risk % under 30 observations); flag 5–19 as provisional; rates
   need ≥ 10,000 hours, TTM windows.
6. **Anti-gaming pairings** — any quantity target ships with its quality
   companion (observations ↔ at-risk % + action linkage; CAPA on-time ↔
   hierarchy-of-controls mix + reopen rate; pledge participation ↔
   perception favorability; days-since ↔ reporting rate).
7. **Heinrich honesty** — the triangle teaches reporting culture; never
   fixed ratios, never fatality prediction. SIF-potential tracks separately,
   never with a hard-zero target (it chills precursor reporting).
8. **Proxies labeled** — interior metrics render as instruments, not facts.
9. **Balance is a diagnostic, not a KPI** — improve it only by strengthening
   the limiting quadrant; never by dragging a strong one down. Composite
   over-trust is mitigated in the UI (hub number subordinate, tooltip points
   at the quadrants).
10. **Correlation honesty** — leading→lagging relationships are per-tenant
    empirical (r, lag, n, reliability gate ≥ 12 months) — never causal
    claims, never transplanted between tenants.
11. **Fatality override** — any death in window forces the program display
    to Critical regardless of computed scores (Phase 2, with targets).
12. **Composite transparency** — SPHS/PMI expose ingredients, weights,
    windows, and suppressions on demand.

## 7. Roadmap

| Phase | Scope | Size |
|---|---|---|
| **1 (this PR)** | Core `integralModel.ts` + tests; agent definitions; this plan. | done |
| **1b (next PR)** | `IntegralSafetySection` + components per §5; page wiring; `metricDetail` chips; `--color-integral-*` tokens. | M |
| **2** | `integral_scorecard_snapshots` migration (append-only, cron-written weekly, admin-scoped RLS) for trend charts; integral block in weekly email + PDF/XLSX exports; optional `integral_balance`/`program_maturity` target rows (widen CHECK + `ehsTargets.ts`); Phase-2 catalog metrics (hierarchy mix, LOTO coverage, toolbox participation, BBS rate/at-risk). | M |
| **3** | Interior data sources: perception surveys (anonymized, insert-only RLS + aggregate view), safety commitments/pledges, coaching conversation log, committee/SAT activity — each adds catalog ids and finally lights up Intentional; optional standalone `reports-integral` module (FeatureDef + nav + admin tile + route, all four or `check:nav` fails). | L |
| **4** | Tenant-tunable weights/mapping, cross-tenant benchmarking, mobile parity (same core module), AI focus narrative over the largest quadrant gap. | M–L |

## 8. Targets & benchmarks (defaults for a food-production tenant)

Externally benchmarkable: TRIR/DART/LTIR vs BLS SOII NAICS 311 (existing
`industryBenchmark.ts`; food manufacturing runs ≈ TRC 4.0–4.5 / DART 2.4–2.9
vs all-private 2.7/1.7). Defaults: TRIR ≤ 3.5, DART ≤ 2.0. Everything else is
internal-trend + good-practice anchored: near-miss ≥ 5/100 workers/mo (ratio
≥ 10:1), BBS ≥ 1 observation/worker/mo with at-risk < 15% (flag < 2% as
rubber-stamping), CAPA on-time ≥ 90%, RCA 100% on recordables, training
completion ≥ 95%, perception participation ≥ 70% / favorability ≥ 75%, LOTO
coverage 100% (1910.147 — a gap is a compliance red, not a yellow).

**Standards line**: normalization + direction metadata per ANSI/ASSP Z16.1;
reactive + proactive evaluation per ISO 45001 §9.1 (compliance obligations
via permit/SDS/LOTO currency); leading-indicator families and
maturity progression per NSC/Campbell Institute guidance; recordability per
29 CFR 1904.

## 9. IP note

The four-quadrant framework (Wilber's AQAL — axes, quadrants, culture at the
hub) is a published intellectual framework and fair to implement. The WLS
Safety360 **pinwheel artwork** is Workplace Learning System's creative asset:
the product uses an original SVG pinwheel and its own accessible palette, and
references the WLS adaptation by name only with attribution (the WLS demo
tenant walkthrough is the natural home for that credit). Do not reproduce or
trace the handout graphic in the product.
