// Environmental monitoring: discharge limits, sample results, and what the two say together.
//
// Everything here is a pure function over rows the caller already fetched. A result is stored
// without a verdict and judged at read time against the limits that apply to it, so correcting
// a limit corrects every past judgement. Nothing here reads the clock: windows start from a
// `nowMs` the caller passes.
//
// Two rules shape the types.
//
// 1. A limit has a BASIS, and the basis decides what an exceedance means. Exceeding a permit
//    limit (or a local limit) breaks a limit that binds the discharger. Exceeding a benchmark
//    or a numeric action level triggers an investigation and a response; it is not, by
//    itself, a violation. The roll-ups keep the three classes in separate fields so that no
//    caller can add them into one number.
// 2. A judgement the data cannot support is `not_evaluable`, with the reason, never a guess.
//    A non-detect never shows an exceedance, units are converted only where the table below
//    is certain, and a limit that is judged on a day or a month is not judged one sample at
//    a time.

import { isRealDate, UUID_PATTERN } from './validation'

export const LIMIT_KINDS = ['instantaneous_max', 'instantaneous_min', 'daily_max', 'monthly_average', 'annual_average'] as const
export type LimitKind = typeof LIMIT_KINDS[number]

export const LIMIT_BASES = ['permit_limit', 'benchmark', 'numeric_action_level', 'local_limit', 'self_imposed'] as const
export type LimitBasis = typeof LIMIT_BASES[number]

export type LimitSource = 'library' | 'tenant'

export type ExceedanceClass = 'limit' | 'action' | 'internal'

type Direction = 'max' | 'min'
type JudgedOn = 'sample' | 'day' | 'month' | 'reporting_year'

export const LIMIT_KIND_META: Readonly<Record<LimitKind, { label: string; direction: Direction; judgedOn: JudgedOn }>> = {
  instantaneous_max: { label: 'Instantaneous maximum', direction: 'max', judgedOn: 'sample' },
  instantaneous_min: { label: 'Instantaneous minimum', direction: 'min', judgedOn: 'sample' },
  daily_max:         { label: 'Daily maximum',         direction: 'max', judgedOn: 'day' },
  monthly_average:   { label: 'Monthly average',       direction: 'max', judgedOn: 'month' },
  annual_average:    { label: 'Annual average',        direction: 'max', judgedOn: 'reporting_year' },
}

// A local limit binds the discharger like a permit limit does, so it counts in the same class.
export const LIMIT_BASIS_META: Readonly<Record<LimitBasis, { label: string; exceedanceLabel: string; exceedanceClass: ExceedanceClass }>> = {
  permit_limit:         { label: 'Permit limit',         exceedanceLabel: 'Exceeds permit limit',         exceedanceClass: 'limit' },
  local_limit:          { label: 'Local limit',          exceedanceLabel: 'Exceeds local limit',          exceedanceClass: 'limit' },
  benchmark:            { label: 'Benchmark',            exceedanceLabel: 'Exceeds benchmark',            exceedanceClass: 'action' },
  numeric_action_level: { label: 'Numeric action level', exceedanceLabel: 'Exceeds numeric action level', exceedanceClass: 'action' },
  self_imposed:         { label: 'Internal target',      exceedanceLabel: 'Outside internal target',      exceedanceClass: 'internal' },
}

export const EXCEEDANCE_CLASS_LABELS: Readonly<Record<ExceedanceClass, string>> = {
  limit:    'Permit and local limit exceedances',
  action:   'Benchmark and action level exceedances',
  internal: 'Internal target exceedances',
}

/** A value larger than this is a typo, and past it floating point stops being exact about the digits. */
export const MAX_MONITORING_VALUE = 1e12

/** A sample may be dated up to this far ahead of "now": a person in a later time zone, a clock a little fast. */
export const FUTURE_ALLOWANCE_MS = 24 * 60 * 60 * 1000

// ── rows ────────────────────────────────────────────────────────────────────

/** What a person enters to create or change a limit. A site-wide limit has no outfall. */
export interface MonitoringLimitInput {
  facilityId:    string
  outfallId:     string | null
  permitId:      string | null
  parameter:     string
  unit:          string
  kind:          LimitKind
  value:         number
  basis:         LimitBasis
  citation:      string | null
  /** What a reviewer must confirm before this number is relied on. */
  verify:        string | null
  /** First and last day (YYYY-MM-DD, inclusive) the limit is in force; null is open-ended. */
  effectiveFrom: string | null
  effectiveTo:   string | null
}

export interface MonitoringLimit extends MonitoringLimitInput {
  id:         string
  source:     LimitSource
  libraryKey: string | null
}

/** What a person enters to record or correct a sample result. A site-level sample has no outfall. */
export interface MonitoringResultInput {
  facilityId:      string
  outfallId:       string | null
  parameter:       string
  unit:            string
  value:           number
  /** Not detected: `value` is then the laboratory's reporting limit, not a measurement. */
  belowDetection:  boolean
  /** An instant, ISO 8601 in UTC. */
  sampledAt:       string
  eventLabel:      string | null
  lab:             string | null
  evidenceId:      string | null
  note:            string | null
}

export interface MonitoringResult extends MonitoringResultInput {
  id:        string
  sampledBy: string | null
}

// ── parameters and units ────────────────────────────────────────────────────

/** "  Oil &  Grease " and "oil & grease" are the same parameter. */
export const normalizeParameter = (parameter: string): string => parameter.trim().replace(/\s+/g, ' ').toLowerCase()

const sameParameter = (a: string, b: string): boolean => normalizeParameter(a) === normalizeParameter(b)

// Spellings of one unit. pH has no dimension, so "s.u." and "standard units" are the same thing.
const UNIT_SPELLINGS: Readonly<Record<string, string>> = {
  'su': 'su', 's.u.': 'su', 'standardunit': 'su', 'standardunits': 'su', 'phunits': 'su', 'ph': 'su',
}

// Mass concentration in micrograms per litre, so every factor is a whole number. ppm and ppb are
// read as mg/L and ug/L: that equivalence holds for dilute water, which is what a discharge
// sample is. Nothing else is converted; a conversion that needs a density or a molar mass is
// not guessed.
const MICROGRAMS_PER_LITRE: Readonly<Record<string, number>> = {
  'mg/l': 1000, 'ppm': 1000,
  'ug/l': 1,    'ppb': 1,
}

const unitKey = (unit: string): string => {
  const key = unit.trim().toLowerCase().replace(/[µμ]/g, 'u').replace(/\s+/g, '')
  return UNIT_SPELLINGS[key] ?? key
}

// Multiplying by 1000 turns 2.007 into 2007.0000000000002; twelve significant digits is far
// beyond a laboratory's precision and enough to make "equal to the limit" compare as equal.
const tidy = (value: number): number => Number(value.toPrecision(12))

// The same tidying for a difference, which is small beside what was subtracted: 2007 - 2007.1
// carries noise from the thirteenth digit of the operands, so it is rounded to the decimals
// that twelve significant digits of the larger operand allow, not of the difference itself.
function difference(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b))
  if (scale === 0) return 0
  const decimals = Math.min(100, Math.max(0, 11 - Math.floor(Math.log10(scale))))
  return Number((a - b).toFixed(decimals)) || 0
}

/** `value` expressed in `toUnit`, or null when the two units cannot be compared. */
export function convertValue(value: number, fromUnit: string, toUnit: string): number | null {
  const from = unitKey(fromUnit)
  const to = unitKey(toUnit)
  if (from === to) return value
  const fromFactor = MICROGRAMS_PER_LITRE[from]
  const toFactor = MICROGRAMS_PER_LITRE[to]
  if (fromFactor === undefined || toFactor === undefined) return null
  return tidy(value * fromFactor / toFactor)
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

// ── dates ───────────────────────────────────────────────────────────────────
// A day is a UTC day. A site's time zone is not recorded, so a sample taken within hours of
// midnight on the last day of a window can fall in the neighbouring one.

function utcDate(timestamp: string): string | null {
  const ms = Date.parse(timestamp)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10)
}

/** Whether a limit is in force on a day (YYYY-MM-DD). */
export function limitInForce(limit: Pick<MonitoringLimitInput, 'effectiveFrom' | 'effectiveTo'>, date: string): boolean {
  return (limit.effectiveFrom === null || limit.effectiveFrom <= date) && (limit.effectiveTo === null || date <= limit.effectiveTo)
}

export interface ReportingYear {
  /** First and last day of the year, YYYY-MM-DD, inclusive. */
  reportingYearStart: string
  reportingYearEnd:   string
  /** "2025-26" for a year that crosses a New Year, "2026" for a calendar year. */
  label:              string
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * The reporting year that contains a date (YYYY-MM-DD, or a timestamp read as a UTC day).
 * `startMonth` is the month it begins in: 1 for a calendar year, 7 for a July-to-June year.
 */
export function reportingYearFor(date: string, startMonth: number): ReportingYear {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new RangeError(`startMonth must be 1-12, got ${startMonth}`)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : utcDate(date)
  if (day === null || !isRealDate(day)) throw new RangeError(`not a date: ${date}`)

  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const startYear = month >= startMonth ? year : year - 1
  // Day 0 of the start month, a year on, is the last day of the month before it.
  const end = new Date(Date.UTC(startYear + 1, startMonth - 1, 0)).toISOString().slice(0, 10)
  return {
    reportingYearStart: `${startYear}-${pad2(startMonth)}-01`,
    reportingYearEnd:   end,
    label:              startMonth === 1 ? String(startYear) : `${startYear}-${String(startYear + 1).slice(2)}`,
  }
}

type Window = Pick<ReportingYear, 'reportingYearStart' | 'reportingYearEnd'>

function inWindow(sampledAt: string, window: Window): boolean {
  const day = utcDate(sampledAt)
  return day !== null && day >= window.reportingYearStart && day <= window.reportingYearEnd
}

// ── which limits apply to a result ─────────────────────────────────────────

type ResultSubject = Pick<MonitoringResultInput, 'outfallId' | 'parameter' | 'sampledAt'>

/**
 * The limits that bind a result: those for its parameter that are in force on the day it was
 * sampled and cover its outfall (a site-wide limit covers every outfall, and a site-level
 * sample too). An outfall's own limit comes before a site-wide one and replaces a site-wide
 * limit of the same kind and basis, which is how a permit gives one outfall an exception.
 */
export function limitsApplying(limits: readonly MonitoringLimit[], result: ResultSubject): MonitoringLimit[] {
  const day = utcDate(result.sampledAt)
  if (day === null) return []

  const candidates = limits.filter(limit =>
    sameParameter(limit.parameter, result.parameter)
    && limitInForce(limit, day)
    && (limit.outfallId === null || limit.outfallId === result.outfallId))

  const specific = candidates.filter(limit => limit.outfallId !== null)
  const replaced = (siteWide: MonitoringLimit) => specific.some(limit => limit.kind === siteWide.kind && limit.basis === siteWide.basis)
  return [...specific, ...candidates.filter(limit => limit.outfallId === null && !replaced(limit))]
}

// ── judging one result ─────────────────────────────────────────────────────

export type EvaluationStatus = 'within' | 'exceeds' | 'not_evaluable'

export interface Evaluation {
  status: EvaluationStatus
  /**
   * Room left under a maximum, or above a minimum, in the limit's unit: negative when exceeded,
   * zero exactly at the limit (which is within). Null when nothing could be judged.
   */
  margin: number | null
  /** Why it could not be judged, or what to know about a judgement that was made. */
  reason: string | null
}

const notEvaluable = (reason: string): Evaluation => ({ status: 'not_evaluable', margin: null, reason })

type JudgedLimit = Pick<MonitoringLimit, 'kind' | 'value' | 'unit'>
type JudgedResult = Pick<MonitoringResultInput, 'value' | 'unit' | 'belowDetection'>

/**
 * One sample against one limit that is judged sample by sample (an instantaneous maximum or
 * minimum). A value equal to the limit is within. A non-detect carries the laboratory's
 * reporting limit as its value: it is within a maximum only when that reporting limit is
 * itself under the maximum, and otherwise the method could not have shown compliance. It is
 * never an exceedance, and it can never show a minimum was met.
 */
export function evaluateResult(limit: JudgedLimit, result: JudgedResult): Evaluation {
  const meta = LIMIT_KIND_META[limit.kind]
  if (meta.judgedOn !== 'sample') return notEvaluable(`A ${meta.label.toLowerCase()} limit is not judged one sample at a time.`)

  const value = convertValue(result.value, result.unit, limit.unit)
  if (value === null) return notEvaluable(`Unit mismatch: the result is in ${result.unit.trim()} and the limit is in ${limit.unit.trim()}.`)

  if (result.belowDetection) {
    if (meta.direction === 'min') return notEvaluable('Not detected: a non-detect cannot show that a minimum was met.')
    if (value > limit.value) {
      return notEvaluable(`Not detected, but the reporting limit (${value} ${limit.unit.trim()}) is above the limit, so this method could not show compliance.`)
    }
    return { status: 'within', margin: difference(limit.value, value), reason: `Not detected; the reporting limit (${value} ${limit.unit.trim()}) is within the limit.` }
  }

  const margin = meta.direction === 'max' ? difference(limit.value, value) : difference(value, limit.value)
  return { status: margin < 0 ? 'exceeds' : 'within', margin, reason: null }
}

export interface Judgment {
  limit:      MonitoringLimit
  evaluation: Evaluation
}

/** A result against every limit that binds it and is judged sample by sample. */
export function judgeResult(limits: readonly MonitoringLimit[], result: ResultSubject & JudgedResult): Judgment[] {
  return limitsApplying(limits, result)
    .filter(limit => LIMIT_KIND_META[limit.kind].judgedOn === 'sample')
    .map(limit => ({ limit, evaluation: evaluateResult(limit, result) }))
}

// ── averages over a reporting year ─────────────────────────────────────────

export interface AnnualAverage {
  unit:                  string
  /** Samples averaged. */
  sampleCount:           number
  mean:                  number | null
  nonDetectCount:        number
  /** True when a non-detect went into the mean, counted at its reporting limit. */
  includesNonDetects:    boolean
  /** Samples in the window that could not be converted to `unit` and so were left out. */
  incompatibleUnitCount: number
}

type AveragedResult = Pick<MonitoringResultInput, 'value' | 'unit' | 'belowDetection' | 'sampledAt'>

/**
 * The arithmetic mean, in `unit`, of the results sampled inside the window. A non-detect goes
 * in at its reporting limit as reported; the answer says so, because that is a choice a permit
 * may make differently.
 */
export function annualAverage(results: readonly AveragedResult[], window: Window, unit: string): AnnualAverage {
  let sum = 0
  let sampleCount = 0
  let nonDetectCount = 0
  let incompatibleUnitCount = 0
  for (const result of results) {
    if (!inWindow(result.sampledAt, window)) continue
    const value = convertValue(result.value, result.unit, unit)
    if (value === null) { incompatibleUnitCount += 1; continue }
    sum += value
    sampleCount += 1
    if (result.belowDetection) nonDetectCount += 1
  }
  return {
    unit, sampleCount, nonDetectCount, incompatibleUnitCount,
    mean: sampleCount === 0 ? null : tidy(sum / sampleCount),
    includesNonDetects: nonDetectCount > 0,
  }
}

export interface AverageEvaluation extends Evaluation {
  average: AnnualAverage
}

type AveragedLimit = Pick<MonitoringLimit, 'kind' | 'value' | 'unit' | 'parameter' | 'outfallId'>
type ScopedResult = AveragedResult & Pick<MonitoringResultInput, 'parameter' | 'outfallId'>

/**
 * An annual-average limit against the window's results of its parameter. A site-wide limit
 * averages every sample at the site, all outfalls together; an outfall's limit averages that
 * outfall's. No sample, or a sample that cannot be put in the limit's unit, is not a pass:
 * a mean of part of the data would be a false answer either way.
 */
export function evaluateAnnualAverage(limit: AveragedLimit, results: readonly ScopedResult[], window: Window): AverageEvaluation {
  const inScope = results.filter(r => sameParameter(r.parameter, limit.parameter) && (limit.outfallId === null || r.outfallId === limit.outfallId))
  const average = annualAverage(inScope, window, limit.unit)
  const unjudged = (reason: string): AverageEvaluation => ({ ...notEvaluable(reason), average })

  if (limit.kind !== 'annual_average') return unjudged('Only an annual average limit is judged against an average.')
  if (average.incompatibleUnitCount > 0) {
    return unjudged(`${plural(average.incompatibleUnitCount, 'result')} in this reporting year ${average.incompatibleUnitCount === 1 ? 'is' : 'are'} in a unit that cannot be compared with ${limit.unit.trim()}.`)
  }
  if (average.mean === null) return unjudged('No samples in this reporting year.')

  const detail = `Average of ${plural(average.sampleCount, 'sample')}`
    + (average.includesNonDetects ? `, ${average.nonDetectCount} of them not detected and counted at their reporting limit` : '')
  const margin = difference(limit.value, average.mean)
  return { status: margin < 0 ? 'exceeds' : 'within', margin, reason: detail, average }
}

// ── the summary ─────────────────────────────────────────────────────────────

export type RowStatus = EvaluationStatus | 'no_data'

export interface ExceedanceRef {
  resultId:  string
  sampledAt: string
  value:     number
  unit:      string
  /** How far past the limit, in the limit's unit; negative. */
  margin:    number
}

export interface LimitRow {
  limit:            MonitoringLimit
  /** The outfall whose results this row judges; null for site-level samples, a pooled site-wide average, or a limit with nothing to judge yet. */
  outfallId:        string | null
  /** Where the latest result that could be judged stands. Past exceedances stay in `exceedanceCount`. */
  status:           RowStatus
  sampleCount:      number
  /** Exceedances in the reporting year: one per exceeding sample, or one for an annual average that exceeds. */
  exceedanceCount:  number
  latestExceedance: ExceedanceRef | null
  average:          AnnualAverage | null
  reason:           string | null
}

/** Exceedance counts by class. There is deliberately no total: the classes mean different things. */
export interface ClassCounts {
  limit:    number
  action:   number
  internal: number
}

export interface SubjectRollup {
  /** An outfall, or null for the site as a whole. */
  outfallId: string | null
  counts:    ClassCounts
}

export interface ExceedanceSummary {
  reportingYear: ReportingYear
  rows:          LimitRow[]
  subjects:      SubjectRollup[]
  totals:        ClassCounts
}

const noCounts = (): ClassCounts => ({ limit: 0, action: 0, internal: 0 })

const instant = (timestamp: string): number => Date.parse(timestamp)

function overlapsYear(limit: Pick<MonitoringLimitInput, 'effectiveFrom' | 'effectiveTo'>, year: Window): boolean {
  return (limit.effectiveFrom === null || limit.effectiveFrom <= year.reportingYearEnd)
    && (limit.effectiveTo === null || limit.effectiveTo >= year.reportingYearStart)
}

const rowKey = (limitId: string, outfallId: string | null): string => `${limitId}|${outfallId ?? ''}`

const emptyRow = (limit: MonitoringLimit, outfallId: string | null): LimitRow => ({
  limit, outfallId, status: 'no_data', sampleCount: 0, exceedanceCount: 0, latestExceedance: null, average: null, reason: null,
})

/**
 * Where each limit stands in the reporting year that contains `nowMs`, and how many times each
 * class of limit was exceeded, in total and per outfall.
 *
 * An instantaneous limit gets a row for each outfall that has results against it. An annual
 * average gets one row, for its own outfall or for the site as a whole. A limit judged on a day
 * or a month is listed as not evaluable: it needs the day's or month's reported value, which
 * the log does not compute.
 */
export function exceedanceSummary(
  limits: readonly MonitoringLimit[],
  results: readonly MonitoringResult[],
  nowMs: number,
  options: { reportingYearStartMonth: number },
): ExceedanceSummary {
  const year = reportingYearFor(new Date(nowMs).toISOString(), options.reportingYearStartMonth)
  const rows = new Map<string, LimitRow>()
  const limitsWithRows = new Set<string>()
  const rowFor = (limit: MonitoringLimit, outfallId: string | null): LimitRow => {
    const key = rowKey(limit.id, outfallId)
    const existing = rows.get(key)
    if (existing) return existing
    const created = emptyRow(limit, outfallId)
    rows.set(key, created)
    limitsWithRows.add(limit.id)
    return created
  }

  // Oldest first, so the last judgement a row sees is the latest.
  const inYear = results
    .filter(result => inWindow(result.sampledAt, year))
    .sort((a, b) => instant(a.sampledAt) - instant(b.sampledAt) || a.id.localeCompare(b.id))

  for (const result of inYear) {
    for (const { limit, evaluation } of judgeResult(limits, result)) {
      const row = rowFor(limit, result.outfallId)
      row.sampleCount += 1
      if (evaluation.status === 'not_evaluable') {
        if (row.status === 'no_data' || row.status === 'not_evaluable') { row.status = 'not_evaluable'; row.reason = evaluation.reason }
        continue
      }
      row.status = evaluation.status
      row.reason = evaluation.reason
      if (evaluation.status === 'exceeds') {
        row.exceedanceCount += 1
        row.latestExceedance = { resultId: result.id, sampledAt: result.sampledAt, value: result.value, unit: result.unit, margin: evaluation.margin ?? 0 }
      }
    }
  }

  for (const limit of limits) {
    if (!overlapsYear(limit, year)) continue
    const judgedOn = LIMIT_KIND_META[limit.kind].judgedOn
    if (judgedOn === 'reporting_year') {
      const evaluation = evaluateAnnualAverage(limit, results, year)
      const row = rowFor(limit, limit.outfallId)
      row.average = evaluation.average
      row.sampleCount = evaluation.average.sampleCount
      row.reason = evaluation.reason
      row.status = evaluation.average.sampleCount === 0 && evaluation.average.incompatibleUnitCount === 0 ? 'no_data' : evaluation.status
      row.exceedanceCount = evaluation.status === 'exceeds' ? 1 : 0
    } else if (judgedOn !== 'sample') {
      const row = rowFor(limit, limit.outfallId)
      row.status = 'not_evaluable'
      row.reason = `A ${LIMIT_KIND_META[limit.kind].label.toLowerCase()} limit is judged on the ${judgedOn} value in your discharge monitoring report, which this log does not compute.`
    } else if (!limitsWithRows.has(limit.id)) {
      rowFor(limit, limit.outfallId)
    }
  }

  const ordered = [...rows.values()].sort(compareRows)
  return { reportingYear: year, rows: ordered, ...rollUp(ordered) }
}

const kindOrder = (kind: LimitKind): number => LIMIT_KINDS.indexOf(kind)

function compareRows(a: LimitRow, b: LimitRow): number {
  return normalizeParameter(a.limit.parameter).localeCompare(normalizeParameter(b.limit.parameter))
    || kindOrder(a.limit.kind) - kindOrder(b.limit.kind)
    || a.limit.id.localeCompare(b.limit.id)
    || (a.outfallId ?? '').localeCompare(b.outfallId ?? '')
}

function rollUp(rows: readonly LimitRow[]): Pick<ExceedanceSummary, 'subjects' | 'totals'> {
  const subjects = new Map<string | null, ClassCounts>()
  const totals = noCounts()
  for (const row of rows) {
    const counts = subjects.get(row.outfallId) ?? noCounts()
    subjects.set(row.outfallId, counts)
    const exceedanceClass = LIMIT_BASIS_META[row.limit.basis].exceedanceClass
    counts[exceedanceClass] += row.exceedanceCount
    totals[exceedanceClass] += row.exceedanceCount
  }
  return {
    totals,
    subjects: [...subjects.entries()]
      .map(([outfallId, counts]) => ({ outfallId, counts }))
      .sort((a, b) => (a.outfallId ?? '').localeCompare(b.outfallId ?? '')),
  }
}

// ── validation ──────────────────────────────────────────────────────────────

export type LimitValidation =
  | { ok: true; limit: MonitoringLimitInput }
  | { ok: false; errors: string[] }

export type ResultValidation =
  | { ok: true; result: MonitoringResultInput }
  | { ok: false; errors: string[] }

/** Reads fields of a request body, collecting every problem instead of stopping at the first. */
function fieldReader(body: Record<string, unknown>, errors: string[]) {
  const has = (key: string) => body[key] !== undefined
  const fail = <T>(message: string, keep: T): T => { errors.push(message); return keep }

  return {
    has,

    /** Required text: trimmed, inner whitespace collapsed, 1 to `max` characters. */
    requiredText(key: string, max: number, keep: string): string {
      if (!has(key)) return keep === '' ? fail(`${key} is required.`, keep) : keep
      const v = body[key]
      if (typeof v !== 'string') return fail(`${key} must be text.`, keep)
      const text = v.trim().replace(/\s+/g, ' ')
      if (text === '') return fail(`${key} is required.`, keep)
      if (text.length > max) return fail(`${key} is too long (the limit is ${max} characters).`, keep)
      return text
    },

    text(key: string, max: number, keep: string | null): string | null {
      if (!has(key)) return keep
      const v = body[key]
      if (v === null || v === '') return null
      if (typeof v !== 'string') return fail(`${key} must be text.`, keep)
      const text = v.trim()
      if (text.length > max) return fail(`${key} is too long (the limit is ${max} characters).`, keep)
      return text || null
    },

    enumOf<T extends string>(key: string, allowed: readonly T[], keep: T): T {
      if (!has(key)) return keep
      const v = body[key]
      if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
      return fail(`${key} must be one of: ${allowed.join(', ')}.`, keep)
    },

    uuidOrNull(key: string, keep: string | null): string | null {
      if (!has(key)) return keep
      const v = body[key]
      if (v === null || v === '') return null
      if (typeof v === 'string' && UUID_PATTERN.test(v)) return v.toLowerCase()
      return fail(`${key} must be an id.`, keep)
    },

    amount(key: string, keep: number | null): number | null {
      if (!has(key)) return keep
      const v = body[key]
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_MONITORING_VALUE) return v
      return fail(`${key} must be a number from 0 to ${MAX_MONITORING_VALUE.toLocaleString('en-US')}.`, keep)
    },

    flag(key: string, keep: boolean): boolean {
      if (!has(key)) return keep
      return typeof body[key] === 'boolean' ? body[key] as boolean : fail(`${key} must be true or false.`, keep)
    },

    day(key: string, keep: string | null): string | null {
      if (!has(key)) return keep
      const v = body[key]
      if (v === null || v === '') return null
      if (typeof v === 'string' && isRealDate(v)) return v
      return fail(`${key} must be a date such as 2026-07-01.`, keep)
    },
  }
}

const asObject = (input: unknown): Record<string, unknown> | null =>
  typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : null

function readFacility(read: ReturnType<typeof fieldReader>, errors: string[], body: Record<string, unknown>, keep: string): string {
  let facilityId = keep
  if (read.has('facility_id')) {
    if (typeof body.facility_id === 'string' && UUID_PATTERN.test(body.facility_id)) facilityId = body.facility_id.toLowerCase()
    else errors.push('facility_id must be an id.')
  }
  if (!facilityId && !errors.some(e => e.startsWith('facility_id'))) errors.push('facility_id is required: this record belongs to one site.')
  return facilityId
}

/**
 * Validate a limit request body (snake_case, like the table). Left out of a partial update, a
 * field keeps the value in `current`. Where a limit came from (library or tenant) is not a
 * field: a person cannot claim a library source by asking.
 */
export function validateMonitoringLimit(input: unknown, options: { current?: MonitoringLimitInput } = {}): LimitValidation {
  const body = asObject(input)
  if (body === null) return { ok: false, errors: ['Expected an object.'] }
  const current = options.current
  const errors: string[] = []
  const read = fieldReader(body, errors)

  const facilityId = readFacility(read, errors, body, current?.facilityId ?? '')
  const parameter = read.requiredText('parameter', 80, current?.parameter ?? '')
  const unit = read.requiredText('unit', 20, current?.unit ?? '')
  const kind = read.enumOf('limit_kind', LIMIT_KINDS, current?.kind ?? 'instantaneous_max')
  const basis = read.enumOf('basis', LIMIT_BASES, current?.basis ?? 'permit_limit')

  let value = current?.value ?? null
  if (!read.has('value') && value === null) errors.push('value is required.')
  else value = read.amount('value', value)

  const effectiveFrom = read.day('effective_from', current?.effectiveFrom ?? null)
  const effectiveTo = read.day('effective_to', current?.effectiveTo ?? null)
  if (effectiveFrom !== null && effectiveTo !== null && effectiveTo < effectiveFrom
      && !errors.some(e => e.startsWith('effective_'))) {
    errors.push('effective_to cannot be before effective_from.')
  }

  const limit: MonitoringLimitInput = {
    facilityId, parameter, unit, kind, basis,
    value:         value ?? 0,
    outfallId:     read.uuidOrNull('outfall_id', current?.outfallId ?? null),
    permitId:      read.uuidOrNull('permit_id', current?.permitId ?? null),
    citation:      read.text('citation', 300, current?.citation ?? null),
    verify:        read.text('verify', 1000, current?.verify ?? null),
    effectiveFrom, effectiveTo,
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, limit }
}

const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * Validate a sample result request body. `nowMs` is the moment of the request: a sample may be
 * dated at most a day ahead of it. `evidencePathPrefix` is the folder the caller may reference
 * (the tenant's own); with none given every evidence path is refused. Left out of a partial
 * update, a field keeps the value in `current`.
 */
export function validateMonitoringResult(
  input: unknown,
  options: { nowMs: number; evidencePathPrefix?: string; current?: MonitoringResultInput },
): ResultValidation {
  const body = asObject(input)
  if (body === null) return { ok: false, errors: ['Expected an object.'] }
  const current = options.current
  const errors: string[] = []
  const read = fieldReader(body, errors)

  const facilityId = readFacility(read, errors, body, current?.facilityId ?? '')
  const parameter = read.requiredText('parameter', 80, current?.parameter ?? '')
  const unit = read.requiredText('unit', 20, current?.unit ?? '')

  let value = current?.value ?? null
  if (!read.has('value') && value === null) errors.push('value is required.')
  else value = read.amount('value', value)

  let sampledAt = current?.sampledAt ?? ''
  if (read.has('sampled_at')) {
    const v = body.sampled_at
    const match = typeof v === 'string' ? ISO_INSTANT.exec(v) : null
    const ms = match && isRealDate(match[1]!) ? Date.parse(v as string) : Number.NaN
    if (Number.isNaN(ms)) errors.push('sampled_at must be a date and time with a time zone, such as 2026-02-03T10:30:00Z.')
    else if (ms > options.nowMs + FUTURE_ALLOWANCE_MS) errors.push('sampled_at cannot be more than a day in the future.')
    else sampledAt = new Date(ms).toISOString()
  } else if (!sampledAt) {
    errors.push('sampled_at is required.')
  }

  let evidenceId = current?.evidenceId ?? null
  if (read.has('evidence_id')) {
    const v = body.evidence_id
    const prefix = options.evidencePathPrefix
    if (v === null || v === '') evidenceId = null
    else if (typeof v === 'string' && v.length <= 300 && !!prefix && v.startsWith(prefix) && !v.includes('..')) evidenceId = v
    else errors.push('evidence_id must be a file you uploaded to this account.')
  }

  const result: MonitoringResultInput = {
    facilityId, parameter, unit, sampledAt, evidenceId,
    value:          value ?? 0,
    outfallId:      read.uuidOrNull('outfall_id', current?.outfallId ?? null),
    belowDetection: read.flag('below_detection', current?.belowDetection ?? false),
    eventLabel:     read.text('event_label', 120, current?.eventLabel ?? null),
    lab:            read.text('lab', 120, current?.lab ?? null),
    note:           read.text('note', 2000, current?.note ?? null),
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, result }
}

// ── table <-> domain ────────────────────────────────────────────────────────

/** The limit as table columns. The inverse of parseLimitRow, for the fields a person controls. */
export function toLimitRow(limit: MonitoringLimitInput): Record<string, unknown> {
  return {
    facility_id:    limit.facilityId,
    outfall_id:     limit.outfallId,
    permit_id:      limit.permitId,
    parameter:      limit.parameter,
    unit:           limit.unit,
    limit_kind:     limit.kind,
    value:          limit.value,
    basis:          limit.basis,
    citation:       limit.citation,
    verify:         limit.verify,
    effective_from: limit.effectiveFrom,
    effective_to:   limit.effectiveTo,
  }
}

export function toResultRow(result: MonitoringResultInput): Record<string, unknown> {
  return {
    facility_id:     result.facilityId,
    outfall_id:      result.outfallId,
    parameter:       result.parameter,
    unit:            result.unit,
    value:           result.value,
    below_detection: result.belowDetection,
    sampled_at:      result.sampledAt,
    event_label:     result.eventLabel,
    lab:             result.lab,
    evidence_id:     result.evidenceId,
    note:            result.note,
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
// PostgREST sends numeric columns as numbers; a driver that sends them as text is read the same.
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v))

/** A stored limit row as the domain object; also what a partial update starts from. */
export function parseLimitRow(row: Record<string, unknown>): MonitoringLimit {
  return {
    id:            String(row.id),
    facilityId:    String(row.facility_id),
    outfallId:     str(row.outfall_id),
    permitId:      str(row.permit_id),
    parameter:     String(row.parameter ?? ''),
    unit:          String(row.unit ?? ''),
    kind:          row.limit_kind as LimitKind,
    value:         num(row.value),
    basis:         row.basis as LimitBasis,
    citation:      str(row.citation),
    verify:        str(row.verify),
    effectiveFrom: str(row.effective_from),
    effectiveTo:   str(row.effective_to),
    source:        row.source === 'library' ? 'library' : 'tenant',
    libraryKey:    str(row.library_key),
  }
}

export function parseResultRow(row: Record<string, unknown>): MonitoringResult {
  return {
    id:             String(row.id),
    facilityId:     String(row.facility_id),
    outfallId:      str(row.outfall_id),
    parameter:      String(row.parameter ?? ''),
    unit:           String(row.unit ?? ''),
    value:          num(row.value),
    belowDetection: row.below_detection === true,
    sampledAt:      String(row.sampled_at ?? ''),
    eventLabel:     str(row.event_label),
    lab:            str(row.lab),
    evidenceId:     str(row.evidence_id),
    note:           str(row.note),
    sampledBy:      str(row.sampled_by),
  }
}
