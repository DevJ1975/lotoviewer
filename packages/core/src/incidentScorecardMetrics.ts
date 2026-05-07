// Incident scorecard — leading + lagging + care + investigation-quality
// KPIs that the EHS director reads to gauge program health over time.
//
// Same shape as nearMissMetrics + scorecardMetrics: pure summarizer +
// thin DB orchestrator. The orchestrator (fetchIncidentScorecardMetrics)
// pulls from incidents + incident_classifications + incident_actions +
// incident_care_cases + incident_investigations + osha_300_log_entries
// and feeds the rows into summarizeIncidentScorecard().
//
// Phase 5 ships the pure summarizer + the orchestrator. The
// IncidentKpiPanel + heatmaps render the result.

import { supabase } from './supabaseClient'
import {
  isClosedOnTime,
  type IncidentActionRow,
  type HierarchyOfControls,
} from './incidentAction'
import { OSHA_RATE_CONSTANT } from './oshaForms'
import { type CareCaseStatus } from './incidentCare'
import {
  type IncidentSeverityActual,
  type IncidentType,
  type IncidentStatus,
} from './incident'

// ──────────────────────────────────────────────────────────────────────────
// Result shapes
// ──────────────────────────────────────────────────────────────────────────

export interface MonthBucket {
  /** YYYY-MM in UTC. */
  month: string
  count: number
}

export interface BodyPartBucket {
  body_part: string                 // e.g. 'hand_right'
  count:     number
}

export interface ShiftDayBucket {
  shift:     'day' | 'swing' | 'night' | 'unknown'
  /** 0 = Sunday, 6 = Saturday, in the tenant's local time at intake. */
  weekday:   0 | 1 | 2 | 3 | 4 | 5 | 6
  count:     number
}

export interface HierarchyMixBucket {
  level: HierarchyOfControls | 'unset'
  count: number
}

export interface IncidentScorecardMetrics {
  /** Window the dashboard is showing — typically 365 days. */
  windowDays: number
  /** Annual hours-worked across all establishments — TRIR/DART/LTIR
   *  denominator. Reads from osha_establishments.hours_employees_by_year
   *  for the window's fiscal year. */
  hoursWorked: number

  // ── Lagging indicators ────────────────────────────────────────────────
  /** Per OSHA: cases meeting recording criteria in the window. */
  totalRecordable:        number
  totalDeaths:            number
  totalDaysAwayCases:     number
  totalRestrictedCases:   number
  totalOtherRecordable:   number
  /** Sum of days_away across days_away cases — severity-rate numerator. */
  totalDaysAwayCount:     number
  /** OSHA TRIR (per 100 FTE). Null when hoursWorked = 0. */
  trir: number | null
  /** OSHA DART (per 100 FTE). Null when hoursWorked = 0. */
  dart: number | null
  /** Lost-time incident rate (deaths + days_away cases). */
  ltir: number | null
  /** Severity rate (days away × 200 000 / hours). */
  severityRate: number | null

  // ── Leading indicators ────────────────────────────────────────────────
  /** Near misses filed in the window. Numerator for the ratio. */
  totalNearMiss:          number
  /** "Heinrich-style" near-miss-to-recordable ratio.
   *  Target: HIGH (more reporting = better culture). Null when no
   *  recordables to divide by. */
  nearMissToRecordableRatio: number | null
  /** % of CAPAs closed on or before due_at. 0–100, null with no data. */
  actionClosureOnTimePct: number | null
  /** Days since the most recent recordable. -1 sentinel when no
   *  recordable on file (so the UI can render "—" or a champion
   *  banner). */
  daysSinceLastRecordable: number

  // ── Investigation quality ─────────────────────────────────────────────
  /** Recordables in the window with a completed investigation. */
  recordablesWithCompletedRca: number
  /** % of recordables with a completed RCA. Null when no recordables. */
  rcaCompletionPct: number | null
  /** Mean days from incident.reported_at to incidents.closed_at across
   *  closed incidents in the window. Null when no closed incidents. */
  meanTimeToCloseDays: number | null

  // ── Care management ───────────────────────────────────────────────────
  openCareCases:                   number
  modifiedDutyCases:               number
  meanDaysToRtw:                   number | null
  /** Care cases that have a return_to_work_at within the window —
   *  used as the denominator for "modified-duty compliance" downstream. */
  closedCareCases:                 number

  // ── Trend + breakdown series ──────────────────────────────────────────
  recordablesByMonth:    MonthBucket[]
  severityActualBreakdown: Record<IncidentSeverityActual, number>
  hierarchyOfControlsMix:  HierarchyMixBucket[]
  bodyPartHeatmap:       BodyPartBucket[]
  shiftDayHeatmap:       ShiftDayBucket[]

  /** Echo of "now" for the chart axes. */
  nowMs: number
}

// ──────────────────────────────────────────────────────────────────────────
// Input row shapes — each is the minimal subset we read from the DB.
// ──────────────────────────────────────────────────────────────────────────

export interface IncidentRowForMetrics {
  id:                string
  incident_type:     IncidentType
  occurred_at:       string
  reported_at:       string
  closed_at:         string | null
  shift:             'day' | 'swing' | 'night' | null
  severity_actual:   IncidentSeverityActual
  status:            IncidentStatus
}

export interface ClassificationRowForMetrics {
  incident_id:              string
  meets_recording_criteria: boolean
  classification:           'death' | 'days_away' | 'restricted' | 'other_recordable' | null
}

export interface CareRowForMetrics {
  incident_id:           string
  case_status:           CareCaseStatus
  days_away_from_work:   number
  days_restricted:       number
  return_to_work_at:     string | null
  created_at:            string
}

export interface InvestigationRowForMetrics {
  incident_id:    string
  completed_at:   string | null
}

export interface PersonRowForMetrics {
  incident_id: string
  body_part:   string[] | null
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

export function isWithinWindow(iso: string | null | undefined, windowDays: number, nowMs: number): boolean {
  if (!iso) return false
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return false
  return ms >= nowMs - windowDays * DAY_MS && ms <= nowMs
}

// "Recordable in window" = the incident's classification is recordable
// AND its occurred_at is inside the window. We check classification by
// joining incidents to classifications via incident_id; the helper
// expects the join to already be done in the orchestrator.
export interface IncidentWithClassification extends IncidentRowForMetrics {
  classification: ClassificationRowForMetrics | null
}

export function selectRecordableInWindow(
  rows: ReadonlyArray<IncidentWithClassification>,
  windowDays: number,
  nowMs: number,
): IncidentWithClassification[] {
  return rows.filter(r =>
    r.classification?.meets_recording_criteria === true
    && isWithinWindow(r.occurred_at, windowDays, nowMs))
}

// ── Rate helpers ──────────────────────────────────────────────────────────
//
// All four rates use the OSHA 200,000-hour constant. Returns null when
// hoursWorked is zero so the UI renders "—" rather than NaN/Infinity.

export function trir(recordableCount: number, hoursWorked: number): number | null {
  if (!hoursWorked) return null
  return (recordableCount * OSHA_RATE_CONSTANT) / hoursWorked
}
export function dart(deaths: number, daysAway: number, restricted: number, hoursWorked: number): number | null {
  if (!hoursWorked) return null
  return ((deaths + daysAway + restricted) * OSHA_RATE_CONSTANT) / hoursWorked
}
export function ltir(deaths: number, daysAway: number, hoursWorked: number): number | null {
  if (!hoursWorked) return null
  return ((deaths + daysAway) * OSHA_RATE_CONSTANT) / hoursWorked
}
export function severityRate(totalDaysAway: number, hoursWorked: number): number | null {
  if (!hoursWorked) return null
  return (totalDaysAway * OSHA_RATE_CONSTANT) / hoursWorked
}

// ── Other leading indicators ──────────────────────────────────────────────

export function nearMissToRecordableRatio(nearMiss: number, recordable: number): number | null {
  if (recordable === 0) return null
  return nearMiss / recordable
}

export function actionsClosedOnTimePct(actions: ReadonlyArray<IncidentActionRow>): number | null {
  // Denominator: actions whose status crossed into 'complete' or
  // 'verified' (we want the percentage of CLOSED actions that were
  // closed on time, not of all actions). When no closed actions
  // exist in the window, return null so the UI shows "—" instead of
  // 0%.
  let closed = 0, onTime = 0
  for (const a of actions) {
    if (a.status === 'complete' || a.status === 'verified') {
      closed += 1
      if (isClosedOnTime(a)) onTime += 1
    }
  }
  if (closed === 0) return null
  return (onTime / closed) * 100
}

export function daysSinceLastRecordable(
  rows: ReadonlyArray<IncidentWithClassification>,
  nowMs: number,
): number {
  let mostRecentMs = -1
  for (const r of rows) {
    if (!r.classification?.meets_recording_criteria) continue
    const ms = new Date(r.occurred_at).getTime()
    if (Number.isNaN(ms)) continue
    if (ms > mostRecentMs) mostRecentMs = ms
  }
  if (mostRecentMs < 0) return -1
  return Math.max(0, Math.floor((nowMs - mostRecentMs) / DAY_MS))
}

// ── Investigation quality ────────────────────────────────────────────────

export function rcaCompletionPct(
  recordables: ReadonlyArray<IncidentWithClassification>,
  investigations: ReadonlyArray<InvestigationRowForMetrics>,
): { withCompletedRca: number; pct: number | null } {
  if (recordables.length === 0) return { withCompletedRca: 0, pct: null }
  const completedSet = new Set(
    investigations.filter(i => i.completed_at).map(i => i.incident_id),
  )
  let n = 0
  for (const r of recordables) {
    if (completedSet.has(r.id)) n += 1
  }
  return { withCompletedRca: n, pct: (n / recordables.length) * 100 }
}

export function meanTimeToCloseDays(
  rows: ReadonlyArray<IncidentRowForMetrics>,
): number | null {
  const closed = rows.filter(r => r.closed_at)
  if (closed.length === 0) return null
  let totalMs = 0
  for (const r of closed) {
    const start = new Date(r.reported_at).getTime()
    const end   = new Date(r.closed_at!).getTime()
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue
    totalMs += (end - start)
  }
  return totalMs / closed.length / DAY_MS
}

// ── Care metrics ──────────────────────────────────────────────────────────

export function meanDaysToRtw(rows: ReadonlyArray<CareRowForMetrics>): number | null {
  const closed = rows.filter(r => r.return_to_work_at)
  if (closed.length === 0) return null
  let totalDays = 0
  for (const r of closed) {
    const start = new Date(r.created_at).getTime()
    const end   = new Date(r.return_to_work_at!).getTime()
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue
    totalDays += (end - start) / DAY_MS
  }
  return totalDays / closed.length
}

// ── Trend buckets ────────────────────────────────────────────────────────

export function bucketByMonth(
  rows: ReadonlyArray<{ occurred_at: string }>,
  windowDays: number,
  nowMs: number,
): MonthBucket[] {
  const buckets = new Map<string, number>()
  // Pre-fill every month in the window so the chart x-axis is dense.
  const startMs = nowMs - windowDays * DAY_MS
  let cursor = new Date(startMs)
  cursor.setUTCDate(1)
  cursor.setUTCHours(0, 0, 0, 0)
  while (cursor.getTime() <= nowMs) {
    const key = cursor.toISOString().slice(0, 7)
    if (!buckets.has(key)) buckets.set(key, 0)
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  }
  for (const r of rows) {
    const ms = new Date(r.occurred_at).getTime()
    if (Number.isNaN(ms)) continue
    if (ms < startMs || ms > nowMs) continue
    const key = new Date(ms).toISOString().slice(0, 7)
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const list = Array.from(buckets.entries()).map(([month, count]) => ({ month, count }))
  list.sort((a, b) => a.month.localeCompare(b.month))
  return list
}

export function severityActualBreakdown(
  rows: ReadonlyArray<IncidentRowForMetrics>,
): Record<IncidentSeverityActual, number> {
  const out: Record<IncidentSeverityActual, number> = {
    none: 0, first_aid: 0, medical: 0, lost_time: 0, fatality: 0, catastrophic: 0,
  }
  for (const r of rows) out[r.severity_actual] += 1
  return out
}

export function hierarchyOfControlsMix(
  actions: ReadonlyArray<IncidentActionRow>,
): HierarchyMixBucket[] {
  const counts = new Map<HierarchyOfControls | 'unset', number>([
    ['elimination', 0], ['substitution', 0], ['engineering', 0],
    ['administrative', 0], ['ppe', 0], ['unset', 0],
  ])
  for (const a of actions) {
    if (a.status !== 'complete' && a.status !== 'verified') continue
    const k = (a.hierarchy_of_controls ?? 'unset') as HierarchyOfControls | 'unset'
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([level, count]) => ({ level, count }))
}

export function bodyPartHeatmap(
  people: ReadonlyArray<PersonRowForMetrics>,
): BodyPartBucket[] {
  const counts = new Map<string, number>()
  for (const p of people) {
    if (!p.body_part) continue
    for (const part of p.body_part) {
      counts.set(part, (counts.get(part) ?? 0) + 1)
    }
  }
  const list = Array.from(counts.entries()).map(([body_part, count]) => ({ body_part, count }))
  list.sort((a, b) => b.count - a.count)
  return list
}

export function shiftDayHeatmap(
  rows: ReadonlyArray<IncidentRowForMetrics>,
): ShiftDayBucket[] {
  // 4 shifts × 7 weekdays = 28 cells. We pre-fill all 28 so the
  // grid renders as a complete heatmap even with sparse data.
  const out = new Map<string, ShiftDayBucket>()
  const shifts: Array<'day' | 'swing' | 'night' | 'unknown'> = ['day', 'swing', 'night', 'unknown']
  const weekdays: Array<0 | 1 | 2 | 3 | 4 | 5 | 6> = [0, 1, 2, 3, 4, 5, 6]
  for (const s of shifts) for (const w of weekdays) {
    out.set(`${s}|${w}`, { shift: s, weekday: w, count: 0 })
  }
  for (const r of rows) {
    const ms = new Date(r.occurred_at).getTime()
    if (Number.isNaN(ms)) continue
    const wd = new Date(ms).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6
    const sh = (r.shift ?? 'unknown') as typeof shifts[number]
    const key = `${sh}|${wd}`
    const cell = out.get(key)!
    cell.count += 1
  }
  return Array.from(out.values())
}

// ──────────────────────────────────────────────────────────────────────────
// Pure summarizer — full result shape from pre-fetched rows.
// ──────────────────────────────────────────────────────────────────────────

export interface SummariseInput {
  windowDays:        number
  nowMs:             number
  hoursWorked:       number
  incidents:         IncidentWithClassification[]
  actions:           IncidentActionRow[]
  careCases:         CareRowForMetrics[]
  investigations:    InvestigationRowForMetrics[]
  injuredPeople:     PersonRowForMetrics[]
}

export function summarizeIncidentScorecard(input: SummariseInput): IncidentScorecardMetrics {
  const { windowDays, nowMs, hoursWorked } = input

  const recordablesAll = input.incidents.filter(r => r.classification?.meets_recording_criteria)
  const recordablesWindow = selectRecordableInWindow(input.incidents, windowDays, nowMs)

  const totalDeaths = recordablesWindow.filter(r => r.classification?.classification === 'death').length
  const totalDaysAwayCases = recordablesWindow.filter(r => r.classification?.classification === 'days_away').length
  const totalRestrictedCases = recordablesWindow.filter(r => r.classification?.classification === 'restricted').length
  const totalOtherRecordable = recordablesWindow.filter(r => r.classification?.classification === 'other_recordable').length
  const totalRecordable = recordablesWindow.length

  // Days-away counter: sum from care_cases joined to recordable
  // incidents in the window. The 300A uses the same number.
  const recordableIds = new Set(recordablesWindow.map(r => r.id))
  let totalDaysAwayCount = 0
  for (const c of input.careCases) {
    if (recordableIds.has(c.incident_id)) totalDaysAwayCount += c.days_away_from_work
  }

  const totalNearMiss = input.incidents.filter(r =>
    r.incident_type === 'near_miss' && isWithinWindow(r.occurred_at, windowDays, nowMs)).length

  // Investigation quality.
  const { withCompletedRca, pct: rcaPct } = rcaCompletionPct(recordablesWindow, input.investigations)

  // Care management.
  const careWindow = input.careCases.filter(c =>
    isWithinWindow(c.created_at, windowDays, nowMs))
  const openCareCases = careWindow.filter(c => c.case_status === 'open' || c.case_status === 'modified_duty').length
  const modifiedDutyCases = careWindow.filter(c => c.case_status === 'modified_duty').length
  const closedCareCases = careWindow.filter(c => c.return_to_work_at).length

  // Build the trend series.
  const recordablesByMonth = bucketByMonth(
    recordablesWindow.map(r => ({ occurred_at: r.occurred_at })),
    windowDays, nowMs,
  )

  const incidentsInWindow = input.incidents.filter(r =>
    isWithinWindow(r.occurred_at, windowDays, nowMs))

  return {
    windowDays, nowMs, hoursWorked,

    // Lagging.
    totalRecordable,
    totalDeaths,
    totalDaysAwayCases,
    totalRestrictedCases,
    totalOtherRecordable,
    totalDaysAwayCount,
    trir:         trir(totalRecordable, hoursWorked),
    dart:         dart(totalDeaths, totalDaysAwayCases, totalRestrictedCases, hoursWorked),
    ltir:         ltir(totalDeaths, totalDaysAwayCases, hoursWorked),
    severityRate: severityRate(totalDaysAwayCount, hoursWorked),

    // Leading.
    totalNearMiss,
    nearMissToRecordableRatio: nearMissToRecordableRatio(totalNearMiss, totalRecordable),
    actionClosureOnTimePct:    actionsClosedOnTimePct(input.actions),
    daysSinceLastRecordable:   daysSinceLastRecordable(recordablesAll, nowMs),

    // Investigation quality.
    recordablesWithCompletedRca: withCompletedRca,
    rcaCompletionPct:            rcaPct,
    meanTimeToCloseDays:         meanTimeToCloseDays(incidentsInWindow),

    // Care.
    openCareCases,
    modifiedDutyCases,
    meanDaysToRtw:    meanDaysToRtw(careWindow),
    closedCareCases,

    // Series.
    recordablesByMonth,
    severityActualBreakdown:  severityActualBreakdown(incidentsInWindow),
    hierarchyOfControlsMix:   hierarchyOfControlsMix(input.actions),
    bodyPartHeatmap:          bodyPartHeatmap(input.injuredPeople),
    shiftDayHeatmap:          shiftDayHeatmap(incidentsInWindow),
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Orchestrator — pulls rows from supabase + feeds the summarizer.
// ──────────────────────────────────────────────────────────────────────────

export async function fetchIncidentScorecardMetrics(
  windowDays: number = 365,
  now: Date = new Date(),
): Promise<IncidentScorecardMetrics | null> {
  const nowMs = now.getTime()
  const startIso = new Date(nowMs - windowDays * DAY_MS).toISOString()

  // Issue every query in parallel — each is RLS-scoped via the
  // supabase client headers, so no tenant id needs to be threaded.
  const [
    incRes,
    classRes,
    actionsRes,
    careRes,
    invRes,
    peopleRes,
    estRes,
  ] = await Promise.all([
    supabase
      .from('incidents')
      .select('id, incident_type, occurred_at, reported_at, closed_at, shift, severity_actual, status'),
    supabase
      .from('incident_classifications')
      .select('incident_id, meets_recording_criteria, classification'),
    supabase
      .from('incident_actions')
      .select('id, tenant_id, incident_id, action_type, hierarchy_of_controls, description, owner_user_id, due_at, status, completed_at, verified_at, verified_by, verification_evidence, source_rca_node_id, cancel_reason, created_at, updated_at, created_by, updated_by'),
    supabase
      .from('incident_care_cases')
      .select('incident_id, case_status, days_away_from_work, days_restricted, return_to_work_at, created_at')
      .gte('created_at', startIso),
    supabase
      .from('incident_investigations')
      .select('incident_id, completed_at'),
    supabase
      .from('incident_people_safe')
      .select('incident_id, body_part')
      .eq('person_role', 'injured'),
    supabase
      .from('osha_establishments')
      .select('hours_employees_by_year'),
  ])

  if (incRes.error)     { console.warn('[scorecard] incidents',       incRes.error);    return null }
  if (classRes.error)   { console.warn('[scorecard] classifications', classRes.error);  return null }
  if (actionsRes.error) { console.warn('[scorecard] actions',         actionsRes.error); return null }
  if (careRes.error)    { console.warn('[scorecard] care',            careRes.error);   return null }
  if (invRes.error)     { console.warn('[scorecard] investigations',  invRes.error);    return null }
  if (peopleRes.error)  { console.warn('[scorecard] people',          peopleRes.error); return null }
  if (estRes.error)     { console.warn('[scorecard] establishments',  estRes.error);    return null }

  const classByIncident = new Map<string, ClassificationRowForMetrics>()
  for (const c of (classRes.data ?? []) as ClassificationRowForMetrics[]) {
    classByIncident.set(c.incident_id, c)
  }
  const incidents: IncidentWithClassification[] = ((incRes.data ?? []) as IncidentRowForMetrics[]).map(r => ({
    ...r,
    classification: classByIncident.get(r.id) ?? null,
  }))

  // Hours worked: sum every establishment's hours for the current
  // year. A more accurate fiscal-year alignment lives in Phase 6;
  // Phase 5 keeps it simple.
  const yearKey = String(new Date(nowMs).getUTCFullYear())
  let hoursWorked = 0
  type EstYears = { hours_employees_by_year: Record<string, { hours?: number }> | null }
  for (const e of ((estRes.data ?? []) as EstYears[])) {
    const h = e.hours_employees_by_year?.[yearKey]?.hours
    if (typeof h === 'number') hoursWorked += h
  }

  return summarizeIncidentScorecard({
    windowDays, nowMs, hoursWorked,
    incidents,
    actions:        (actionsRes.data ?? []) as IncidentActionRow[],
    careCases:      (careRes.data ?? []) as CareRowForMetrics[],
    investigations: (invRes.data ?? []) as InvestigationRowForMetrics[],
    injuredPeople:  (peopleRes.data ?? []) as PersonRowForMetrics[],
  })
}
