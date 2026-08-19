// The proactive safety briefing: a ranked, evidenced answer to "what should we
// work on this week, and why that". Pure — no I/O, no LLM.
//
// WHY THIS EXISTS
// The platform can already answer every safety question a user thinks to ask.
// What it cannot do is tell someone what to ask. This turns the risk drivers,
// the precursor patterns, and the recordable forecast into a small ordered list
// of moves, each carrying the evidence that put it there and a link to the
// screen where the work happens.
//
// WHAT "SCORE REDUCTION" MEANS — AND WHAT IT DOES NOT
// Each move reports the points it would remove from the incident-risk score.
// That number is ARITHMETIC ON A FIXED WEIGHT VECTOR, not a prediction: the
// score is a weighted sum, so clearing a driver's pressure removes exactly its
// contribution. It is deliberately NOT called an expected reduction in
// incidents, because nothing here estimates that. Naming it honestly is the
// difference between a useful prioritizer and a fabricated causal claim.
//
// An LLM may narrate this list. It never computes it and never reorders it.

import type { IncidentRiskDriver, IncidentRiskResult } from './incidentRiskModel'
import type { PrecursorPattern } from './precursorRules'
import type { CountForecast } from './forecast'

export type BriefingMoveSource = 'precursor' | 'risk_driver'

export type BriefingUrgency = 'urgent' | 'elevated' | 'routine'

export interface BriefingMove {
  key:      string
  /** What to do, in the imperative. */
  title:    string
  /** Why this is on the list — the evidence, not a restatement of the title. */
  rationale: string
  source:   BriefingMoveSource
  urgency:  BriefingUrgency
  href:     string
  /**
   * Points this would remove from the incident-risk score if the underlying
   * pressure went to zero. Arithmetic on the model's weights — see the header.
   * Null for moves that do not map to a scored indicator.
   */
  scoreReductionIfCleared: number | null
  /** Short evidence lines a reader can check. */
  evidence: string[]
}

export interface SafetyBriefing {
  /** One-line factual statement of where the program stands. No adjectives. */
  headline: string
  moves:    BriefingMove[]
  /** Present only when there is enough history to forecast honestly. */
  outlook:  string | null
  /** Set when nothing warranted a move, so callers can say so explicitly. */
  allClear: boolean
  modelVersion: string
}

export const SAFETY_BRIEFING_VERSION = '1.0.0'

export interface BuildBriefingArgs {
  risk:      IncidentRiskResult
  patterns:  readonly PrecursorPattern[]
  /** Recordable forecast for the next period; null when history is too short. */
  forecast?: CountForecast | null
  /** How many moves to return. Defaults to 5. */
  limit?:    number
}

// A driver contributing less than this is noise next to the others — listing it
// dilutes the list, which is the failure mode of every "insights" panel.
const MIN_DRIVER_CONTRIBUTION = 2

/**
 * Builds the briefing.
 *
 * Ordering is fixed and stated: precursor patterns first (a conjunction of
 * conditions is a stronger signal than any single indicator), then risk drivers
 * by the points they carry. Within precursors the rules' own ranking is
 * preserved — severity, then validated ahead of unvalidated — so an unmeasured
 * pattern never displaces a measured one.
 */
export function buildSafetyBriefing(args: BuildBriefingArgs): SafetyBriefing {
  const limit = Math.max(1, args.limit ?? 5)

  const precursorMoves: BriefingMove[] = args.patterns.map(pattern => ({
    key:       `precursor:${pattern.key}`,
    title:     pattern.action,
    rationale: pattern.validation === 'validated' && pattern.leadMonths !== null
      ? `${pattern.label}. In this program's own history this pattern has led recordables by ${pattern.leadMonths} month${pattern.leadMonths === 1 ? '' : 's'} over ${pattern.historyMonths} months of data.`
      : pattern.validation === 'contradicted'
        ? `${pattern.label}. Flagged for review: this program's history does not support the pattern, so treat it as a condition to check rather than a prediction.`
        : `${pattern.label}. Not yet measured against this program's history — treat as a condition to check, not a prediction.`,
    source:    'precursor',
    urgency:   pattern.severity === 'urgent' ? 'urgent'
             : pattern.severity === 'elevated' ? 'elevated' : 'routine',
    href:      pattern.href,
    scoreReductionIfCleared: null,
    evidence:  pattern.evidence.map(e => `${e.label}: ${e.value}`),
  }))

  const driverMoves: BriefingMove[] = args.risk.drivers
    .filter(d => d.contribution >= MIN_DRIVER_CONTRIBUTION)
    .map(driver => ({
      key:       `driver:${driver.key}`,
      title:     driver.suggestedAction,
      rationale: `${driver.label} is carrying ${driver.contribution} of the ${args.risk.score}-point risk score.`,
      source:    'risk_driver' as const,
      urgency:   urgencyForDriver(driver),
      href:      driver.href,
      scoreReductionIfCleared: driver.contribution,
      evidence:  [`Now: ${driver.value}`, `Target: ${driver.target}`],
    }))

  // Precursors already arrive ranked by the rule engine; drivers arrive ranked
  // by contribution from the risk model. Concatenating preserves both.
  const moves = [...precursorMoves, ...driverMoves].slice(0, limit)

  return {
    headline: headlineFor(args.risk, args.patterns.length),
    moves,
    outlook:  outlookFor(args.forecast ?? null),
    allClear: moves.length === 0,
    modelVersion: SAFETY_BRIEFING_VERSION,
  }
}

function urgencyForDriver(driver: IncidentRiskDriver): BriefingUrgency {
  // Pressure, not contribution: a saturated indicator is urgent even when its
  // weight keeps its contribution modest.
  if (driver.pressure >= 75) return 'urgent'
  if (driver.pressure >= 40) return 'elevated'
  return 'routine'
}

function headlineFor(risk: IncidentRiskResult, patternCount: number): string {
  const band = `Incident risk is ${risk.band} (${risk.score}/100)`
  if (patternCount === 0) return `${band}. No precursor patterns are firing.`
  return `${band}. ${patternCount} precursor pattern${patternCount === 1 ? '' : 's'} firing.`
}

// The forecast module returns null below its minimum history rather than
// projecting from too few points; the briefing says so rather than staying
// silent, because "no outlook" and "flat outlook" are different facts.
function outlookFor(forecast: CountForecast | null): string | null {
  if (forecast === null) return null
  const expected = Math.round(forecast.expected * 10) / 10
  const upper    = Math.round(forecast.upper * 10) / 10
  if (!forecast.hasTrend) {
    return `Next period projects ${expected} recordables (up to ${upper} at the top of the 95% interval), based on a flat run-rate over ${forecast.basis} periods — the trend fit was too weak to apply.`
  }
  const direction = forecast.trendSlope > 0 ? 'rising' : 'falling'
  return `Next period projects ${expected} recordables (up to ${upper} at the top of the 95% interval), on a ${direction} trend over ${forecast.basis} periods.`
}
