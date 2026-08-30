// Wilber Integral Model layer (WLS Safety360 adaptation) for the EHS scorecard.
//
// Re-projects already-computed safety signals onto the four integral quadrants
// (Intentional / Behavioral / Cultural / Systems — Individual↔Community ×
// Interior↔Exterior, with culture at the hub) and onto the Safety360 maturity
// spectrum (reactive → transitional → predictive), then folds them into the
// composites the scorecard's integral panel renders: per-quadrant health +
// coverage, an Integral Balance Index, and a Program Maturity Index.
//
// This module deliberately does NOT own how a signal's pressure is computed —
// that stays in incidentRiskModel (the 14 risk drivers) and
// incidentScorecardMetrics (the investigation-quality KPIs). It owns only the
// ontology (which quadrant / maturity band / scope a metric belongs to) and
// the composite math. Pure, no I/O, deterministic — same posture as the risk
// model: auditable formulas, tunable catalog, null-honest (an unmeasured
// quadrant is null, never a fake 0).

import { mean } from './statistics'
import type { IncidentRiskResult, IndicatorKind } from './incidentRiskModel'
import type { IncidentScorecardMetrics } from './incidentScorecardMetrics'

export const INTEGRAL_MODEL_VERSION = '1.0.0'

// ── Ontology ───────────────────────────────────────────────────────────────

/** Wilber's four quadrants, safety-adapted (WLS Safety360 form):
 *  intentional — individual interior: mindset, belief, personal commitment
 *  behavioral  — individual exterior: observable acts, competence in practice
 *  cultural    — collective interior: shared norms, trust, reporting culture
 *  systems     — collective exterior: procedures, permits, controls, workflow */
export type Quadrant = 'intentional' | 'behavioral' | 'cultural' | 'systems'

/** Safety360 maturity spectrum. reactive = after-the-fact outcomes;
 *  transitional = catching and closing known gaps; predictive = leading
 *  signals that anticipate harm before it lands. */
export type MaturityBand = 'reactive' | 'transitional' | 'predictive'

/** Whether a signal measures preventive PROCESS health (feeds quadrant
 *  health) or a harm OUTCOME (reported on its own plane; feeds only the
 *  maturity index). Keeping outcomes out of quadrant health is load-bearing:
 *  a quadrant must never look healthy merely because nobody got hurt in the
 *  window — that would rebuild the old lagging scorecard inside the new
 *  frame and punish honest reporting. */
export type IndicatorScope = 'process' | 'outcome'

export const QUADRANTS: readonly Quadrant[] =
  ['intentional', 'behavioral', 'cultural', 'systems'] as const
export const MATURITY_BANDS: readonly MaturityBand[] =
  ['reactive', 'transitional', 'predictive'] as const

export interface QuadrantMeta {
  label: string
  /** Position on the two WLS axes (rendered as grid placement + rails). */
  axis: {
    vertical:   'individual' | 'community'
    horizontal: 'interior' | 'exterior'
  }
  /** Plant-floor tagline (card subtitle). */
  tagline: string
  /** One-line tooltip. */
  description: string
}

export const QUADRANT_META: Record<Quadrant, QuadrantMeta> = {
  intentional: {
    label: 'Intentional',
    axis: { vertical: 'individual', horizontal: 'interior' },
    tagline: 'Head & heart',
    description: 'The individual, on the inside — mindset, commitment, and attention to risk.',
  },
  behavioral: {
    label: 'Behavioral',
    axis: { vertical: 'individual', horizontal: 'exterior' },
    tagline: 'Seen in the act',
    description: 'The individual, on the outside — the safe and at-risk acts you can watch and coach.',
  },
  cultural: {
    label: 'Cultural',
    axis: { vertical: 'community', horizontal: 'interior' },
    tagline: 'The way we do things',
    description: 'The group, on the inside — shared norms, trust, and whether people feel safe to speak up.',
  },
  systems: {
    label: 'Systems',
    axis: { vertical: 'community', horizontal: 'exterior' },
    tagline: "The way it's built",
    description: 'The operation, on the outside — procedures, permits, training, and the fixes that follow.',
  },
}

export const MATURITY_META: Record<MaturityBand, { label: string; description: string }> = {
  reactive: {
    label: 'Reactive',
    description: 'Learning from harm that already happened — injuries, losses, citations.',
  },
  transitional: {
    label: 'Transitional',
    description: 'Catching smaller signals early — near misses, repeat issues, overdue actions.',
  },
  predictive: {
    label: 'Predictive',
    description: 'Measuring the preventive activity itself — observations, currency, culture signals.',
  },
}

/** Program Maturity Index band weights: predictive evidence counts triple.
 *  Encodes the Safety360 teaching that maturity is where measurement
 *  attention lives, not how low one lagging number happens to be. */
export const MATURITY_WEIGHT: Record<MaturityBand, number> = {
  reactive: 1, transitional: 2, predictive: 3,
}

// ── Classification catalog ─────────────────────────────────────────────────

/** Every metric the integral layer classifies. App-layer only — never
 *  persisted, so it does not interact with the ehs_scorecard_targets CHECK.
 *  The first 14 ids are verbatim IncidentRiskDriver.key values; the last two
 *  are investigation-quality KPIs from IncidentScorecardMetrics that no risk
 *  driver already represents (chosen to avoid double-counting: recordables,
 *  near-miss rate, and CAPA lateness reach this module only through their
 *  risk drivers). */
export type IntegralMetricId =
  | 'recordable_trend' | 'near_miss_reporting' | 'bbs_ratio' | 'capa_overdue'
  | 'risk_reviews_overdue' | 'open_high_risks' | 'training_expired'
  | 'atmospheric_failures' | 'inspection_failing' | 'bbs_followup_overdue'
  | 'jha_reviews_overdue' | 'permit_noncompliance' | 'training_gaps'
  | 'ecfa_weak_controls'
  | 'rca_completion' | 'time_to_close'

export interface IndicatorClass {
  quadrant: Quadrant
  maturity: MaturityBand
  /** Retained leading/lagging label. For the 14 risk-driver ids this MUST
   *  match the driver's kind — asserted in integralModel.test.ts. */
  kind: IndicatorKind
  scope: IndicatorScope
  label: string
}

/** The canonical classification. Exhaustive Record ⇒ adding an id without
 *  its class is a compile error. Assignments are judgment calls made with
 *  the CSP + integral-model experts; tune here (data edit, not logic).
 *  NOTE: `intentional` has NO members yet — the interior of the individual
 *  is structurally unmeasured until the pledge/perception modules land.
 *  That blind spot is the point: it is what the Balance Index surfaces. */
export const INTEGRAL_CLASS: Record<IntegralMetricId, IndicatorClass> = {
  // Harm outcomes — individual-exterior by ontology, but scope 'outcome':
  // they render on the outcome plane and never feed quadrant health.
  recordable_trend:     { quadrant: 'behavioral', maturity: 'reactive',     kind: 'lagging', scope: 'outcome', label: 'Recordable injuries (recent + trend)' },

  // Reporting culture — the near-miss rate reads collective trust that
  // speaking up is safe and worthwhile, not any one worker's act.
  near_miss_reporting:  { quadrant: 'cultural',   maturity: 'transitional', kind: 'leading', scope: 'process', label: 'Near-miss reporting culture' },

  // Individual observable acts and competence currency.
  bbs_ratio:            { quadrant: 'behavioral', maturity: 'predictive',   kind: 'leading', scope: 'process', label: 'BBS safe-to-unsafe ratio' },
  training_expired:     { quadrant: 'behavioral', maturity: 'transitional', kind: 'leading', scope: 'process', label: 'Expired worker training' },
  training_gaps:        { quadrant: 'behavioral', maturity: 'predictive',   kind: 'leading', scope: 'process', label: 'Training gaps (competency matrix)' },

  // Management-system discipline: workflows, reviews, permits, controls.
  capa_overdue:         { quadrant: 'systems',    maturity: 'transitional', kind: 'leading', scope: 'process', label: 'Overdue corrective actions' },
  risk_reviews_overdue: { quadrant: 'systems',    maturity: 'transitional', kind: 'leading', scope: 'process', label: 'Overdue risk reviews' },
  open_high_risks:      { quadrant: 'systems',    maturity: 'predictive',   kind: 'leading', scope: 'process', label: 'Open high/extreme risks' },
  atmospheric_failures: { quadrant: 'systems',    maturity: 'transitional', kind: 'leading', scope: 'process', label: 'Atmospheric test failures' },
  inspection_failing:   { quadrant: 'systems',    maturity: 'transitional', kind: 'leading', scope: 'process', label: 'Failing inspections' },
  bbs_followup_overdue: { quadrant: 'systems',    maturity: 'transitional', kind: 'leading', scope: 'process', label: 'Open BBS follow-ups' },
  jha_reviews_overdue:  { quadrant: 'systems',    maturity: 'transitional', kind: 'leading', scope: 'process', label: 'Overdue JHA reviews' },
  permit_noncompliance: { quadrant: 'systems',    maturity: 'transitional', kind: 'leading', scope: 'process', label: 'Permits expired without close-out' },
  ecfa_weak_controls:   { quadrant: 'systems',    maturity: 'predictive',   kind: 'leading', scope: 'process', label: 'Causal factors on weak controls' },
  rca_completion:       { quadrant: 'systems',    maturity: 'transitional', kind: 'leading', scope: 'process', label: 'RCA completion' },
  time_to_close:        { quadrant: 'systems',    maturity: 'transitional', kind: 'leading', scope: 'process', label: 'Mean time to close' },
}

export function isIntegralMetricId(key: string): key is IntegralMetricId {
  return Object.prototype.hasOwnProperty.call(INTEGRAL_CLASS, key)
}

// ── Inputs / outputs ───────────────────────────────────────────────────────

/** One classified reading. `pressure` is the same 0–100 scale as
 *  IncidentRiskDriver.pressure (higher = worse); null means unmeasured —
 *  no data or an empty denominator (e.g. RCA completion with zero
 *  recordables). Unmeasured signals are excluded from every mean. */
export interface IntegralSignal {
  id:       IntegralMetricId
  pressure: number | null
}

export interface QuadrantHealth {
  quadrant: Quadrant
  /** 0–100 (higher = better) = 100 − mean(measured process pressures).
   *  Null when the quadrant has no measured process signal. */
  health: number | null
  /** measuredCount / totalCount over process signals, 0–1. 0 when the
   *  quadrant has no process members in the input (structurally blind). */
  coverage:      number
  measuredCount: number
  totalCount:    number
}

export type BalanceBand = 'blind' | 'emerging' | 'balanced' | 'integrated'

export interface IntegralScorecardResult {
  quadrants: Record<Quadrant, QuadrantHealth>
  /** 0–100. geometricMean(health over measured quadrants) × (measured / 4).
   *  The geometric mean makes any weak quadrant drag hard; the coverage
   *  factor is the explicit penalty for unmeasured quadrants — a program
   *  can never look balanced around a corner it has never looked at. */
  balanceIndex: number
  /** The measured quadrant with the lowest health — the Liebig "weakest
   *  corner" the director should invest in next. Null when none measured. */
  limitingQuadrant: Quadrant | null
  /** 0–100. Maturity-weighted mean of per-signal health (predictive ×3),
   *  over all measured signals including outcomes — instrumenting and
   *  performing on further-upstream evidence moves it most. */
  maturityIndex: number
  /** 0–1. Share of measured, band-weighted evidence in the predictive band. */
  predictiveEvidenceShare: number
  /** Plain mean of measured quadrant healths. Null when none measured. */
  overallHealth: number | null
  modelVersion: string
}

// ── Composite math ─────────────────────────────────────────────────────────

const clamp  = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

/** Cutoffs chosen so 'integrated' (≥ 80) is unreachable while any quadrant
 *  is unmeasured: with 3 of 4 measured the coverage factor caps the index
 *  at 75 even if every measured quadrant scores 100. */
export function bandForBalanceIndex(index: number): BalanceBand {
  if (index < 30) return 'blind'
  if (index < 55) return 'emerging'
  if (index < 80) return 'balanced'
  return 'integrated'
}

/** Fold classified signals into quadrant healths + the composites.
 *  Degenerate inputs never produce NaN/Infinity: no signals → all healths
 *  null, balanceIndex 0, maturityIndex 0, overallHealth null. */
export function summarizeIntegralScorecard(
  signals: readonly IntegralSignal[],
): IntegralScorecardResult {
  const quadrants = {} as Record<Quadrant, QuadrantHealth>
  for (const q of QUADRANTS) {
    const members  = signals.filter(s =>
      INTEGRAL_CLASS[s.id].quadrant === q && INTEGRAL_CLASS[s.id].scope === 'process')
    const measured = members.filter(s => s.pressure !== null)
    const health = measured.length === 0
      ? null
      : round1(clamp(100 - mean(measured.map(s => clamp(s.pressure!)))!))
    quadrants[q] = {
      quadrant:      q,
      health,
      coverage:      members.length === 0 ? 0 : measured.length / members.length,
      measuredCount: measured.length,
      totalCount:    members.length,
    }
  }

  const measuredQuadrants = QUADRANTS.filter(q => quadrants[q].health !== null)

  // Geometric mean rewards evenness: {70,70,70,70} beats {100,50,50,50}.
  // A collapsed quadrant (health 0) zeroes it — harsh but honest.
  const geo = measuredQuadrants.length === 0
    ? 0
    : Math.pow(
        measuredQuadrants.reduce((p, q) => p * quadrants[q].health!, 1),
        1 / measuredQuadrants.length,
      )
  const balanceIndex = round1(geo * (measuredQuadrants.length / QUADRANTS.length))

  let limitingQuadrant: Quadrant | null = null
  for (const q of measuredQuadrants) {
    if (limitingQuadrant === null || quadrants[q].health! < quadrants[limitingQuadrant].health!) {
      limitingQuadrant = q
    }
  }

  // Maturity: band-weighted mean of per-signal health over ALL measured
  // signals (outcomes included — measuring injuries IS reactive-band
  // evidence; the 1/2/3 weights keep it from dominating).
  let weightSum = 0, weightedHealthSum = 0, predictiveWeightSum = 0
  for (const s of signals) {
    if (s.pressure === null) continue
    const cls = INTEGRAL_CLASS[s.id]
    const w = MATURITY_WEIGHT[cls.maturity]
    weightSum += w
    weightedHealthSum += w * (100 - clamp(s.pressure))
    if (cls.maturity === 'predictive') predictiveWeightSum += w
  }
  const maturityIndex           = weightSum === 0 ? 0 : round1(weightedHealthSum / weightSum)
  const predictiveEvidenceShare = weightSum === 0 ? 0 : round2(predictiveWeightSum / weightSum)

  const overallHealth = measuredQuadrants.length === 0
    ? null
    : round1(mean(measuredQuadrants.map(q => quadrants[q].health!))!)

  return {
    quadrants,
    balanceIndex,
    limitingQuadrant,
    maturityIndex,
    predictiveEvidenceShare,
    overallHealth,
    modelVersion: INTEGRAL_MODEL_VERSION,
  }
}

// ── Adapters over already-computed scorecard outputs ───────────────────────

/** Project the deterministic risk drivers onto integral signals. Each
 *  driver's 0–100 pressure carries over unchanged; classification comes
 *  from INTEGRAL_CLASS. Unknown keys are skipped so a future risk-model
 *  driver can ship before its classification without breaking the panel. */
export function integralSignalsFromRisk(risk: IncidentRiskResult): IntegralSignal[] {
  return risk.drivers
    .filter(d => isIntegralMetricId(d.key))
    .map(d => ({ id: d.key as IntegralMetricId, pressure: d.pressure }))
}

/** Investigation-quality anchors for time_to_close pressure: at or under
 *  the target is zero pressure; at or past the floor saturates at 100. */
export const TIME_TO_CLOSE_TARGET_DAYS = 30
export const TIME_TO_CLOSE_FLOOR_DAYS  = 90

/** Derive the two investigation-quality signals the risk model does not
 *  carry. Deliberately emits ONLY {rca_completion, time_to_close} —
 *  re-deriving TRIR/near-miss/CAPA here would double-count the drivers
 *  integralSignalsFromRisk already contributes. */
export function integralSignalsFromIncidentMetrics(
  m: Pick<IncidentScorecardMetrics, 'rcaCompletionPct' | 'meanTimeToCloseDays'>,
): IntegralSignal[] {
  const rcaPressure = m.rcaCompletionPct === null
    ? null
    : round1(clamp(100 - m.rcaCompletionPct))
  const closePressure = m.meanTimeToCloseDays === null
    ? null
    : round1(clamp(
        ((m.meanTimeToCloseDays - TIME_TO_CLOSE_TARGET_DAYS) * 100)
        / (TIME_TO_CLOSE_FLOOR_DAYS - TIME_TO_CLOSE_TARGET_DAYS),
      ))
  return [
    { id: 'rca_completion', pressure: rcaPressure },
    { id: 'time_to_close',  pressure: closePressure },
  ]
}
