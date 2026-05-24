// Transparent, data-driven incident-risk model. No I/O, no LLM.
//
// Turns a tenant's leading + lagging safety indicators into a single 0–100
// risk score, a band, and a ranked list of *drivers* — the specific factors
// pushing the score up, each with where to go and what to do. The driver list
// is the "where do we work to lower the probability" answer.
//
// Design goals: deterministic (same inputs → same score), auditable (every
// indicator normalizes to a documented 0–100 "pressure" via a published
// threshold, then a fixed weight), and tunable (weights + thresholds live in
// INDICATORS). The score is intentionally NOT produced by an LLM.

export type IncidentRiskBand = 'low' | 'moderate' | 'high' | 'extreme'

// Raw, already-aggregated inputs (counts over a recent window). The web/cron
// orchestrator gathers these per tenant from the existing tables; the model
// stays pure so it is unit-testable without a database.
export interface IncidentRiskFeatures {
  /** Recordables in the recent window (e.g. last 90 days). */
  recordablesRecent:   number
  /** Recordables in the window before that (for the trend term). */
  recordablesPrior:    number
  /** Near-miss reports in the recent window. */
  nearMissRecent:      number
  /** BBS safe-behavior observations in the recent window. */
  bbsSafe:             number
  /** BBS unsafe acts + conditions in the recent window. */
  bbsUnsafe:           number
  /** CAPAs whose due date has passed and are still open. */
  capasOverdue:        number
  /** Active risks whose next_review_date has passed. */
  riskReviewsOverdue:  number
  /** Open high/extreme risks with no control attached. */
  highRisksUncontrolled: number
  /** Worker training certifications currently expired. */
  trainingExpired:     number
  /** Failed atmospheric tests in the recent window. */
  atmFailed:           number
  /** Total atmospheric tests in the recent window (denominator). */
  atmTotal:            number
}

export interface IncidentRiskDriver {
  key:             string
  label:           string
  /** 0–100 pressure this indicator contributes before weighting. */
  pressure:        number
  /** Points this indicator adds to the overall score (pressure × weight). */
  contribution:    number
  /** Human-readable current reading, e.g. "3 overdue". */
  value:           string
  /** What "good" looks like, e.g. "0 overdue". */
  target:          string
  /** Deep link to the module where the work happens. */
  href:            string
  suggestedAction: string
}

export interface IncidentRiskResult {
  score:   number          // 0–100, higher = more risk
  band:    IncidentRiskBand
  drivers: IncidentRiskDriver[]   // sorted by contribution desc
  modelVersion: string
}

export const INCIDENT_RISK_MODEL_VERSION = '1.0.0'

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const round1 = (n: number) => Math.round(n * 10) / 10

interface IndicatorSpec {
  key:    string
  label:  string
  weight: number   // relative weight; the set is normalized to sum 1
  href:   string
  suggestedAction: string
  /** value → 0–100 pressure (higher = worse). Documented per indicator. */
  pressure: (f: IncidentRiskFeatures) => number
  describe: (f: IncidentRiskFeatures) => { value: string; target: string }
}

// ── Indicator catalog ──────────────────────────────────────────────────────
// Each pressure() is a documented, monotonic mapping. Tune here.
const INDICATORS: IndicatorSpec[] = [
  {
    key: 'recordable_trend',
    label: 'Recordable injuries (recent + trend)',
    weight: 22,
    href: '/incidents/scorecard',
    suggestedAction: 'Review recent recordables and verify CAPAs target the root causes, not symptoms.',
    // 25 pressure per recordable in the window (caps at 100), +20 if the
    // count rose vs the prior window.
    pressure: f => clamp(f.recordablesRecent * 25 + (f.recordablesRecent > f.recordablesPrior ? 20 : 0)),
    describe: f => ({ value: `${f.recordablesRecent} this window (was ${f.recordablesPrior})`, target: 'flat or declining' }),
  },
  {
    key: 'near_miss_reporting',
    label: 'Near-miss reporting culture',
    weight: 12,
    href: '/near-miss',
    suggestedAction: 'Drive near-miss reporting — a healthy program reports many near-misses per recordable.',
    // Leading indicator, inverted: a near-miss-to-recordable ratio ≥ 10 is
    // healthy (0 pressure); 0 reports is full pressure. With no recordables,
    // any reporting is healthy.
    pressure: f => {
      if (f.recordablesRecent === 0) return f.nearMissRecent > 0 ? 0 : 40
      const ratio = f.nearMissRecent / f.recordablesRecent
      return clamp((1 - ratio / 10) * 100)
    },
    describe: f => ({ value: `${f.nearMissRecent} near-misses / ${f.recordablesRecent} recordable`, target: '≥ 10 near-misses per recordable' }),
  },
  {
    key: 'bbs_ratio',
    label: 'BBS safe-to-unsafe ratio',
    weight: 10,
    href: '/bbs/scorecard',
    suggestedAction: 'Increase safe-behavior observations and close out unsafe findings.',
    // Leading: ratio ≥ 4 safe per unsafe is healthy (0 pressure). No
    // observations at all is moderate pressure (blind spot).
    pressure: f => {
      const total = f.bbsSafe + f.bbsUnsafe
      if (total === 0) return 50
      if (f.bbsUnsafe === 0) return 0
      const ratio = f.bbsSafe / f.bbsUnsafe
      return clamp((1 - ratio / 4) * 100)
    },
    describe: f => ({ value: `${f.bbsSafe} safe / ${f.bbsUnsafe} unsafe`, target: '≥ 4 safe per unsafe' }),
  },
  {
    key: 'capa_overdue',
    label: 'Overdue corrective actions (CAPAs)',
    weight: 16,
    href: '/incidents',
    suggestedAction: 'Close overdue CAPAs — unresolved corrective actions leave known hazards in place.',
    // 20 pressure per overdue CAPA, caps at 100.
    pressure: f => clamp(f.capasOverdue * 20),
    describe: f => ({ value: `${f.capasOverdue} overdue`, target: '0 overdue' }),
  },
  {
    key: 'risk_reviews_overdue',
    label: 'Overdue risk reviews',
    weight: 12,
    href: '/risk/list',
    suggestedAction: 'Re-review overdue risks; stale assessments hide drift in residual risk.',
    pressure: f => clamp(f.riskReviewsOverdue * 15),
    describe: f => ({ value: `${f.riskReviewsOverdue} overdue`, target: '0 overdue' }),
  },
  {
    key: 'open_high_risks',
    label: 'Open high/extreme risks',
    weight: 14,
    href: '/risk',
    suggestedAction: 'Drive high/extreme risks down with controls — these are your largest open exposures.',
    // 34 pressure each — three open high risks is already saturating.
    pressure: f => clamp(f.highRisksUncontrolled * 34),
    describe: f => ({ value: `${f.highRisksUncontrolled} open`, target: '0 open high/extreme' }),
  },
  {
    key: 'training_expired',
    label: 'Expired worker training',
    weight: 8,
    href: '/admin/loto/training-records',
    suggestedAction: 'Renew expired certifications; untrained workers on hazardous tasks raise incident odds.',
    pressure: f => clamp(f.trainingExpired * 20),
    describe: f => ({ value: `${f.trainingExpired} expired`, target: '0 expired' }),
  },
  {
    key: 'atmospheric_failures',
    label: 'Atmospheric test failures',
    weight: 6,
    href: '/confined-spaces/status',
    suggestedAction: 'Investigate failed atmospheric tests; a rising fail rate signals ventilation/monitor issues.',
    // Fail rate over the window. No tests → 0 (no signal).
    pressure: f => (f.atmTotal === 0 ? 0 : clamp((f.atmFailed / f.atmTotal) * 100)),
    describe: f => ({ value: `${f.atmFailed}/${f.atmTotal} failed`, target: '0% fail rate' }),
  },
]

const TOTAL_WEIGHT = INDICATORS.reduce((s, i) => s + i.weight, 0)

export function bandForRiskScore(score: number): IncidentRiskBand {
  if (score < 25) return 'low'
  if (score < 50) return 'moderate'
  if (score < 75) return 'high'
  return 'extreme'
}

export function summarizeIncidentRisk(features: IncidentRiskFeatures): IncidentRiskResult {
  const drivers: IncidentRiskDriver[] = INDICATORS.map(ind => {
    const pressure = clamp(ind.pressure(features))
    const contribution = round1((pressure * ind.weight) / TOTAL_WEIGHT)
    const { value, target } = ind.describe(features)
    return { key: ind.key, label: ind.label, pressure: round1(pressure), contribution, value, target, href: ind.href, suggestedAction: ind.suggestedAction }
  })

  const score = round1(drivers.reduce((s, d) => s + d.contribution, 0))
  drivers.sort((a, b) => b.contribution - a.contribution)

  return { score, band: bandForRiskScore(score), drivers, modelVersion: INCIDENT_RISK_MODEL_VERSION }
}
