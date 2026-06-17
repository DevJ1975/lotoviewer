import type { IncidentRiskDriver } from '@soteria/core/incidentRiskModel'
import type { IncidentScorecardMetrics } from '@soteria/core/incidentScorecardMetrics'

// Descriptor for the Tableau-style drill-down: when a user taps a graphic or KPI
// on the scorecard, MetricDetailSheet renders one of these. It is intentionally
// presentation-shaped (already-formatted strings) so the sheet stays a dumb
// renderer and every call site decides what "detail" means for its metric.

export type MetricTone = 'safe' | 'watch' | 'critical' | 'neutral'

export interface MetricDetailStat {
  label: string
  value: string
}

export interface MetricDetail {
  /** Metric name shown in the sheet header. */
  title: string
  /** Short category chip, e.g. 'Leading indicator', 'OSHA rate'. */
  category?: string
  /** Plain-language definition of what the metric measures. */
  definition: string
  /** Optional derivation/formula, rendered monospaced. */
  formula?: string
  /** Headline current value, already formatted (e.g. '3.21', '82%'). */
  value: string
  /** Optional target/benchmark context (e.g. 'target ≤ 2.0'). */
  target?: string
  /** Supporting numbers rendered as a small grid. */
  stats?: MetricDetailStat[]
  /** "What this means / why it matters / where to act." */
  narrative: string
  /** Deep link to the module where the work happens. */
  href?: string
  hrefLabel?: string
  /** Header accent tone. */
  tone?: MetricTone
}

// Plain-language definitions for the deterministic risk-model drivers. Keyed by
// IncidentRiskDriver.key so the drill-down can explain each one without the pure
// model carrying UI copy.
const DRIVER_DEFINITION: Record<string, string> = {
  recordable_trend:
    'OSHA-recordable injuries in the recent 90-day window, and whether that count is rising versus the prior window. A lagging outcome — it has already happened.',
  near_miss_reporting:
    'How many near-misses are reported for each recordable injury. A leading culture signal: healthy programs surface many near-misses before anyone gets hurt (Heinrich ≥ 10:1).',
  bbs_ratio:
    'The ratio of safe-behavior observations to unsafe acts/conditions logged through Behavior-Based Safety. A leading signal of how actively the workforce is observing and correcting.',
  capa_overdue:
    'Corrective/preventive actions (CAPAs) whose due date has passed while still open. Each overdue CAPA leaves a known hazard in place.',
  risk_reviews_overdue:
    'Active risk assessments past their scheduled review date. Stale assessments hide drift in residual risk.',
  open_high_risks:
    'Open high/extreme risks with no control attached — your largest unmitigated exposures.',
  training_expired:
    'Worker certifications that have lapsed. Untrained workers on hazardous tasks raise incident odds.',
  atmospheric_failures:
    'The share of confined-space atmospheric tests that failed in the recent window. A rising fail rate signals ventilation or monitor problems.',
}

function toneForPressure(pressure: number): MetricTone {
  if (pressure >= 66) return 'critical'
  if (pressure >= 33) return 'watch'
  return 'safe'
}

/** Build a drill-down descriptor from a deterministic risk-model driver. */
export function metricDetailFromDriver(d: IncidentRiskDriver): MetricDetail {
  return {
    title: d.label,
    category: d.kind === 'leading' ? 'Leading indicator' : 'Lagging indicator',
    definition: DRIVER_DEFINITION[d.key] ?? 'Contributing factor in the predicted-incident-risk model.',
    value: d.value,
    target: `target ${d.target}`,
    stats: [
      { label: 'Pressure', value: `${d.pressure} / 100` },
      { label: 'Adds to risk score', value: `+${d.contribution}` },
    ],
    narrative: d.suggestedAction,
    href: d.href,
    hrefLabel: 'Open module',
    tone: toneForPressure(d.pressure),
  }
}

// ── Incident / OSHA KPI drill-downs ─────────────────────────────────────────
// Tapping a TRIR/DART/etc. card opens the metric's definition, its live formula
// (with the actual numerator/denominator), supporting stats, and how to read it.

export type IncidentKpiId =
  | 'trir' | 'dart' | 'ltir' | 'severity'
  | 'capa' | 'rca' | 'time_to_close' | 'days_since'

const fmtRate = (v: number | null): string => (v === null ? '—' : v.toFixed(2))
const fmtPct = (v: number | null): string => (v === null ? '—' : `${Math.round(v)}%`)
const fmtInt = (n: number): string => n.toLocaleString()

// The 200,000-hour OSHA base (100 FTE × 2,000 hrs/yr) used by every rate.
const RATE_NOTE = 'Rates are unavailable until annual hours worked are entered for the establishment.'

export function buildIncidentKpiDetails(m: IncidentScorecardMetrics): Record<IncidentKpiId, MetricDetail> {
  const hours = m.hoursWorked
  const hoursStr = hours > 0 ? fmtInt(hours) : '—'
  const dartCases = m.totalDeaths + m.totalDaysAwayCases + m.totalRestrictedCases
  const ltCases = m.totalDeaths + m.totalDaysAwayCases

  return {
    trir: {
      title: 'TRIR — Total Recordable Incident Rate',
      category: 'Lagging · OSHA rate',
      definition: 'Recordable injuries and illnesses per 100 full-time-equivalent workers per year. The headline OSHA safety rate, comparable across employers.',
      formula: `(${m.totalRecordable} recordable × 200,000) ÷ ${hoursStr} hrs = ${fmtRate(m.trir)}`,
      value: fmtRate(m.trir),
      stats: [
        { label: 'Recordables (12 mo)', value: fmtInt(m.totalRecordable) },
        { label: 'Hours worked', value: hoursStr },
      ],
      narrative: m.trir === null
        ? RATE_NOTE
        : 'Lower is better. Compare against your industry BLS average and your annual goal in the Goals panel; the year-over-year chart shows the trend.',
      href: '/osha', hrefLabel: 'OSHA records', tone: 'neutral',
    },
    dart: {
      title: 'DART — Days Away, Restricted, or Transferred',
      category: 'Lagging · OSHA rate',
      definition: 'Rate of the more serious recordables: cases involving days away from work, restricted duty, or job transfer, per 100 FTE per year.',
      formula: `((${m.totalDeaths} + ${m.totalDaysAwayCases} + ${m.totalRestrictedCases}) × 200,000) ÷ ${hoursStr} hrs = ${fmtRate(m.dart)}`,
      value: fmtRate(m.dart),
      stats: [
        { label: 'DART cases', value: fmtInt(dartCases) },
        { label: 'Hours worked', value: hoursStr },
      ],
      narrative: m.dart === null ? RATE_NOTE : 'A leaner severity signal than TRIR — it isolates the cases that actually kept someone off the job.',
      href: '/osha', hrefLabel: 'OSHA records', tone: 'neutral',
    },
    ltir: {
      title: 'LTIR — Lost-Time Incident Rate',
      category: 'Lagging · OSHA rate',
      definition: 'Rate of fatalities plus days-away cases per 100 FTE per year — the most severe outcomes only.',
      formula: `((${m.totalDeaths} + ${m.totalDaysAwayCases}) × 200,000) ÷ ${hoursStr} hrs = ${fmtRate(m.ltir)}`,
      value: fmtRate(m.ltir),
      stats: [
        { label: 'Lost-time cases', value: fmtInt(ltCases) },
        { label: 'Hours worked', value: hoursStr },
      ],
      narrative: m.ltir === null ? RATE_NOTE : 'The narrowest, most severe rate. Track alongside TRIR/DART to see whether outcomes are getting worse even if frequency is flat.',
      href: '/osha', hrefLabel: 'OSHA records', tone: 'neutral',
    },
    severity: {
      title: 'Severity rate',
      category: 'Lagging',
      definition: 'How many days are lost per 100 FTE per year — a measure of how serious injuries are, not just how often they happen.',
      formula: `(${fmtInt(m.totalDaysAwayCount)} days away × 200,000) ÷ ${hoursStr} hrs = ${fmtRate(m.severityRate)}`,
      value: fmtRate(m.severityRate),
      stats: [
        { label: 'Total days away', value: fmtInt(m.totalDaysAwayCount) },
        { label: 'Hours worked', value: hoursStr },
      ],
      narrative: m.severityRate === null ? RATE_NOTE : 'A high severity rate with a low TRIR means few injuries, but the ones you have are serious — focus on high-energy hazard controls.',
      href: '/osha', hrefLabel: 'OSHA records', tone: 'neutral',
    },
    capa: {
      title: 'CAPA on-time closure',
      category: 'Leading',
      definition: 'The share of corrective/preventive actions closed on or before their due date. A leading discipline signal — overdue actions leave known hazards in place.',
      formula: 'actions closed on time ÷ total closed actions',
      value: fmtPct(m.actionClosureOnTimePct),
      stats: [{ label: 'On-time %', value: fmtPct(m.actionClosureOnTimePct) }],
      narrative: 'Aim for 90%+. A falling rate is an early warning that the program is generating actions faster than it closes them.',
      href: '/incidents', hrefLabel: 'Incidents', tone: pctTone(m.actionClosureOnTimePct),
    },
    rca: {
      title: 'RCA completion',
      category: 'Investigation quality',
      definition: 'The share of recordable incidents that have a completed root-cause analysis. Incomplete RCAs mean corrective actions may be treating symptoms, not causes.',
      formula: `${fmtInt(m.recordablesWithCompletedRca)} with RCA ÷ ${fmtInt(m.totalRecordable)} recordable = ${fmtPct(m.rcaCompletionPct)}`,
      value: fmtPct(m.rcaCompletionPct),
      stats: [
        { label: 'RCAs complete', value: fmtInt(m.recordablesWithCompletedRca) },
        { label: 'Recordables', value: fmtInt(m.totalRecordable) },
      ],
      narrative: 'Every recordable should have a finished investigation. Gaps here undermine the credibility of your corrective actions.',
      href: '/incidents', hrefLabel: 'Incidents', tone: pctTone(m.rcaCompletionPct),
    },
    time_to_close: {
      title: 'Mean time to close',
      category: 'Investigation quality',
      definition: 'Average days from when an incident is reported to when it is closed, across closed incidents in the window.',
      formula: 'mean(closed_at − reported_at) over closed incidents',
      value: m.meanTimeToCloseDays === null ? '—' : `${m.meanTimeToCloseDays.toFixed(1)} d`,
      stats: [{ label: 'Avg days', value: m.meanTimeToCloseDays === null ? '—' : m.meanTimeToCloseDays.toFixed(1) }],
      narrative: 'Long close times can indicate stuck investigations or stalled corrective actions. Pair with CAPA on-time % to see where the delay is.',
      href: '/incidents', hrefLabel: 'Incidents', tone: 'neutral',
    },
    days_since: {
      title: 'Days since last recordable',
      category: 'Leading · streak',
      definition: 'The recordable-free streak: days since the most recent OSHA-recordable injury. A visible, motivating culture metric.',
      formula: 'floor((now − most recent recordable occurred_at) / 1 day)',
      value: m.daysSinceLastRecordable < 0 ? '—' : String(m.daysSinceLastRecordable),
      stats: [{ label: 'Streak (days)', value: m.daysSinceLastRecordable < 0 ? 'none on file' : String(m.daysSinceLastRecordable) }],
      narrative: m.daysSinceLastRecordable < 0
        ? 'No recordable on file in the window — keep reporting discipline high so the streak is real, not a reporting gap.'
        : 'A long streak is worth celebrating, but watch near-miss reporting alongside it: a quiet streak with no near-misses can mask under-reporting.',
      href: '/incidents', hrefLabel: 'Incidents', tone: m.daysSinceLastRecordable < 0 || m.daysSinceLastRecordable >= 30 ? 'safe' : 'neutral',
    },
  }
}

// Percentage indicators where higher is better (CAPA on-time, RCA completion).
function pctTone(v: number | null): MetricTone {
  if (v === null) return 'neutral'
  if (v >= 90) return 'safe'
  if (v >= 70) return 'watch'
  return 'critical'
}
