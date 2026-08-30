// The semantic catalog — one certified definition per metric. No I/O.
//
// WHY THIS EXISTS
//
// The scorecard currently carries two definitions of "recordable" (the
// year-over-year chart sums stored 300A totals; the live year reads the
// classification flag) and two registries for "location" (facilities and
// osha_establishments, with no key between them). Every downstream ambition —
// per-site rates, a conversational analytics layer, any rollup — needs those
// collapsed to one definition and one dimension first. A faster query over an
// incoherent definition just ships the incoherence to more people.
//
// So this file is the registry, and it is deliberately data rather than code:
// the wiki renders from it, drill-downs render from it, and a query planner
// resolves against it. One definition, several consumers, no drift.
//
// HOW IT IS MEANT TO BE USED BY AN AI ANALYTICS LAYER
//
// The model never writes SQL. It picks a `metricId`, some `dimensions` and a
// `grain` from this catalog — all enum-bounded — and `planQuery` below turns
// that selection into a deterministic, validated plan. Free-form text-to-SQL
// over 254 tables and 387 row-level-security policies is a correctness and
// security hazard; a closed vocabulary is not.
//
// The plan is then executed by the caller under the *user's* credentials, so
// tenant and facility isolation is enforced by the database rather than by the
// prompt. That is the whole security argument for this shape.

export type MetricKind = 'leading' | 'lagging' | 'context'
export type MetricUnit = 'count' | 'rate_200k' | 'percent' | 'days'
export type TimeGrain = 'month' | 'quarter' | 'year'

/** Which scope a metric can honestly be reported at, today. */
export type MetricScope =
  /** Safe at tenant or facility grain. */
  | 'facility'
  /** Only honest tenant-wide — its denominator or source cannot be scoped. */
  | 'tenant_only'

export type DimensionId = 'facility' | 'time' | 'incident_type' | 'severity_actual'

export interface Dimension {
  id:          DimensionId
  label:       string
  /** Column that carries this dimension on the metric's base table. */
  column:      string
  /** False when the column exists but nothing enforces or populates it well. */
  trustworthy: boolean
  caveat?:     string
}

export interface Metric {
  id:            string
  label:         string
  kind:          MetricKind
  unit:          MetricUnit
  /** Symbolic formula — no tenant values substituted. The wiki renders this. */
  formula:       string
  /** What one row of the base table represents. */
  grain:         string
  baseTable:     string
  /** Timestamp column that places an event in a period. */
  timeColumn:    string
  denominator:   string | null
  scope:         MetricScope
  dimensions:    readonly DimensionId[]
  /** Anything a reader must know before quoting the number. */
  caveats:       readonly string[]
  /** Set when the metric is NOT safe to expose yet, with the blocker. */
  blockedReason?: string
}

export const DIMENSIONS: readonly Dimension[] = [
  {
    id: 'facility', label: 'Facility', column: 'facility_id', trustworthy: false,
    caveat:
      'Rows created before the facility backfill were all attributed to the ' +
      'primary facility, and rows written by service-role paths carry NULL. ' +
      'Cross-site comparisons spanning those are not reliable.',
  },
  { id: 'time', label: 'Period', column: 'occurred_at', trustworthy: true },
  { id: 'incident_type', label: 'Incident type', column: 'incident_type', trustworthy: true },
  {
    id: 'severity_actual', label: 'Actual severity', column: 'severity_actual', trustworthy: true,
  },
]

export const METRICS: readonly Metric[] = [
  {
    id: 'recordable_cases',
    label: 'Recordable cases',
    kind: 'lagging',
    unit: 'count',
    formula: 'count(incidents where classification.meets_recording_criteria)',
    grain: 'one incident',
    baseTable: 'incidents',
    timeColumn: 'occurred_at',
    denominator: null,
    // A count needs no hours denominator, so unlike the OSHA rates it is
    // honest at facility grain today. That is why it is the first metric
    // wired end to end.
    scope: 'facility',
    dimensions: ['facility', 'time', 'severity_actual'],
    caveats: [
      'Recordability is a stored classification that can be revised. Revising ' +
      'it restates history, and there is currently no audit trail of the change.',
    ],
  },
  {
    id: 'all_incidents',
    label: 'All reported incidents',
    kind: 'lagging',
    unit: 'count',
    formula: 'count(incidents)',
    grain: 'one incident',
    baseTable: 'incidents',
    timeColumn: 'occurred_at',
    denominator: null,
    scope: 'facility',
    dimensions: ['facility', 'time', 'incident_type', 'severity_actual'],
    caveats: [],
  },
  {
    id: 'trir',
    label: 'Total recordable incident rate',
    kind: 'lagging',
    unit: 'rate_200k',
    formula: '(recordable cases × 200000) / hours worked',
    grain: 'one incident over an exposure period',
    baseTable: 'incidents',
    timeColumn: 'occurred_at',
    denominator: 'osha_establishments.hours_employees_by_year',
    scope: 'tenant_only',
    dimensions: ['time'],
    caveats: [
      'The 200000 constant is 100 full-time-equivalent workers × 2000 hours.',
      'The numerator counts a rolling trailing-365-day window while the ' +
      'denominator is a calendar-year entry, so the two do not cover the same period.',
    ],
    blockedReason:
      'Hours worked are stored per establishment with no link to facilities, and ' +
      'are summed tenant-wide. Reporting this per facility would divide one ' +
      "site's cases by every site's hours. Blocked until the location " +
      'dimension is conformed.',
  },
  {
    id: 'near_miss_reports',
    label: 'Near-miss reports',
    kind: 'leading',
    unit: 'count',
    formula: "count(incidents where incident_type = 'near_miss')",
    grain: 'one incident',
    baseTable: 'incidents',
    timeColumn: 'occurred_at',
    denominator: null,
    scope: 'facility',
    dimensions: ['facility', 'time'],
    caveats: ['Higher is better — a rising reporting rate is a healthy signal, not a warning.'],
    blockedReason:
      'The near-miss write path is split: one intake writes near_misses and ' +
      'another writes incidents, with no sync between them. Any figure here ' +
      'would undercount by a channel-dependent amount.',
  },
]

export interface CatalogQuery {
  metricId:   string
  dimensions: readonly DimensionId[]
  grain:      TimeGrain
  /** Inclusive ISO date bounds. */
  from:       string
  to:         string
  facilityId?: string | null
}

export interface QueryPlan {
  metric:      Metric
  table:       string
  timeColumn:  string
  grain:       TimeGrain
  from:        string
  to:          string
  groupBy:     readonly string[]
  /** Caveats that must be rendered alongside any answer built from this plan. */
  disclosures: readonly string[]
}

export type PlanResult =
  | { ok: true;  plan: QueryPlan }
  | { ok: false; error: string }

export function getMetric(id: string): Metric | undefined {
  return METRICS.find(m => m.id === id)
}

/** Metrics an analytics layer may currently expose. */
export function availableMetrics(): readonly Metric[] {
  return METRICS.filter(m => !m.blockedReason)
}

/**
 * Turn a bounded selection into a validated plan, or an explanation of why it
 * cannot be answered honestly.
 *
 * Refusing is a feature. A layer that answers every question is more dangerous
 * than one that says "this metric cannot be reported per facility yet, and
 * here is why" — the first kind gets quoted, the second gets fixed.
 */
export function planQuery(q: CatalogQuery): PlanResult {
  const metric = getMetric(q.metricId)
  if (!metric) return { ok: false, error: `Unknown metric "${q.metricId}".` }
  if (metric.blockedReason) {
    return { ok: false, error: `${metric.label} cannot be reported yet. ${metric.blockedReason}` }
  }

  const fromMs = Date.parse(q.from)
  const toMs = Date.parse(q.to)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return { ok: false, error: 'Both from and to must be valid ISO dates.' }
  }
  if (fromMs > toMs) return { ok: false, error: '"from" must not be after "to".' }

  for (const d of q.dimensions) {
    if (!metric.dimensions.includes(d)) {
      return { ok: false, error: `${metric.label} cannot be broken down by "${d}".` }
    }
  }

  const wantsFacility = q.dimensions.includes('facility') || Boolean(q.facilityId)
  if (wantsFacility && metric.scope === 'tenant_only') {
    return {
      ok: false,
      error:
        `${metric.label} is only honest client-wide — its denominator cannot ` +
        'follow a facility filter.',
    }
  }

  const disclosures = [...metric.caveats]
  for (const id of q.dimensions) {
    const dim = DIMENSIONS.find(d => d.id === id)
    if (dim && !dim.trustworthy && dim.caveat) disclosures.push(dim.caveat)
  }

  const groupBy = q.dimensions
    .map(id => DIMENSIONS.find(d => d.id === id)?.column)
    .filter((c): c is string => Boolean(c))

  return {
    ok: true,
    plan: {
      metric,
      table: metric.baseTable,
      timeColumn: metric.timeColumn,
      grain: q.grain,
      from: q.from,
      to: q.to,
      groupBy,
      disclosures,
    },
  }
}
