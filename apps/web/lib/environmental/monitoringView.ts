import {
  EXCEEDANCE_CLASS_LABELS, LIMIT_BASES, LIMIT_BASIS_META, LIMIT_KIND_META, LIMIT_KINDS, normalizeParameter,
  type ClassCounts, type ExceedanceClass, type Judgment, type LimitBasis, type LimitKind, type LimitRow, type MonitoringLimit,
  type MonitoringResult, type RowStatus,
} from '@soteria/core/environmental/monitoring'
import type { DefaultLimit } from '@soteria/core/environmental/monitoringDefaults'
import type { Tone } from './legalView'
import { permitsAtSite, type PermitRef } from './permitRefs'

// What the monitoring screen shows and sends, as pure functions: how a limit and a result read
// in a table, how a judgement is labelled (a permit limit and a benchmark never share a label
// or a colour), and the form <-> request-body translation. Nothing here reads the clock; the
// one function that needs "now" is given it.

const isBlank = (text: string): boolean => text.trim() === ''
const orNull = (text: string): string | null => text.trim() || null

export interface Chip {
  tone:  Tone
  label: string
}

// ── numbers and times ──────────────────────────────────────────────────────

/** Six significant digits: enough for a laboratory, and free of floating point tails. */
export const formatAmount = (value: number): string => String(Number(value.toPrecision(6)))

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** An instant as UTC to the minute. Limits and reporting years are counted in UTC days, so the table shows the same clock. */
export const sampledAtText = (iso: string): string => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? iso : `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** A non-detect is shown as the laboratory reported it: below its reporting limit, not as a measurement. */
export const resultValueText = (result: Pick<MonitoringResult, 'value' | 'unit' | 'belowDetection'>): string =>
  result.belowDetection ? `Not detected (< ${formatAmount(result.value)} ${result.unit})` : `${formatAmount(result.value)} ${result.unit}`

// ── limits ─────────────────────────────────────────────────────────────────

/** "≤ 100 mg/L" for a sample limit, "Annual average ≤ 100 mg/L" for one judged over a longer span. */
export function limitText(limit: Pick<MonitoringLimit, 'kind' | 'value' | 'unit'>): string {
  const meta = LIMIT_KIND_META[limit.kind]
  const bound = `${meta.direction === 'min' ? '≥' : '≤'} ${formatAmount(limit.value)} ${limit.unit}`
  return meta.judgedOn === 'sample' ? bound : `${meta.label} ${bound}`
}

export const basisLabel = (basis: LimitBasis): string => LIMIT_BASIS_META[basis].label

/** "Permit limit" or "Benchmark" etc., and "(draft default)" for a limit adopted from the library. */
export const limitProvenance = (limit: Pick<MonitoringLimit, 'basis' | 'source'>): string =>
  limit.source === 'library' ? `${basisLabel(limit.basis)} (draft default)` : basisLabel(limit.basis)

export const appliesToText = (limit: Pick<MonitoringLimit, 'outfallId'>, outfalls: readonly { id: string; code: string }[]): string =>
  limit.outfallId === null ? 'Whole site' : (outfalls.find(o => o.id === limit.outfallId)?.code ?? 'Unknown outfall')

/** "Site-level" for a sample of the site as a whole. */
export const outfallName = (outfallId: string | null, outfalls: readonly { id: string; code: string }[]): string =>
  outfallId === null ? 'Site-level' : (outfalls.find(o => o.id === outfallId)?.code ?? 'Unknown outfall')

export function effectiveText(limit: Pick<MonitoringLimit, 'effectiveFrom' | 'effectiveTo'>): string | null {
  const { effectiveFrom: from, effectiveTo: to } = limit
  if (from === null && to === null) return null
  if (from !== null && to !== null) return `${from} to ${to}`
  return from !== null ? `From ${from}` : `Until ${to}`
}

// ── how a verdict reads ────────────────────────────────────────────────────

// An exceedance is red only for a limit that binds the discharger; a benchmark or action
// level is amber, and an internal target is neutral. The colour carries the same distinction
// the label does, so neither has to be read to tell them apart.
const EXCEEDANCE_TONE: Readonly<Record<ExceedanceClass, Tone>> = { limit: 'bad', action: 'warn', internal: 'idle' }

const STATUS_CHIPS: Readonly<Record<Exclude<RowStatus, 'exceeds'>, Chip>> = {
  within:        { tone: 'good', label: 'Within' },
  not_evaluable: { tone: 'idle', label: 'Not evaluable' },
  no_data:       { tone: 'idle', label: 'No data' },
}

/** The chip for a status against a limit of this basis. An exceedance is named for the basis. */
export function verdictChip(status: RowStatus, basis: LimitBasis): Chip {
  if (status !== 'exceeds') return STATUS_CHIPS[status]
  const meta = LIMIT_BASIS_META[basis]
  return { tone: EXCEEDANCE_TONE[meta.exceedanceClass], label: meta.exceedanceLabel }
}

export interface JudgmentLine {
  key:        string
  chip:       Chip
  /** The limit the result was judged against: its bound and what kind of limit it is. */
  limit:      string
  /** Why it could not be judged, or what to know about the verdict. */
  reason:     string | null
}

export function judgmentLines(judgments: readonly Judgment[]): JudgmentLine[] {
  return judgments.map(({ limit, evaluation }) => ({
    key:    limit.id,
    chip:   verdictChip(evaluation.status, limit.basis),
    limit:  `${limitText(limit)} · ${limitProvenance(limit)}`,
    reason: evaluation.reason,
  }))
}

// Worst first: the standing of a limit with several outfalls is its worst outfall's.
const STANDING_RANK: Readonly<Record<RowStatus, number>> = { exceeds: 3, not_evaluable: 2, within: 1, no_data: 0 }

export interface LimitStanding {
  chip:            Chip
  exceedanceCount: number
  sampleCount:     number
}

/** Where one limit stands in the reporting year, across every outfall it was judged at; null if the summary has no row for it. */
export function limitStanding(limit: Pick<MonitoringLimit, 'id' | 'basis'>, rows: readonly LimitRow[]): LimitStanding | null {
  const own = rows.filter(row => row.limit.id === limit.id)
  if (own.length === 0) return null
  const worst = own.reduce((a, b) => (STANDING_RANK[b.status] > STANDING_RANK[a.status] ? b : a))
  return {
    chip:            verdictChip(worst.status, limit.basis),
    exceedanceCount: own.reduce((sum, row) => sum + row.exceedanceCount, 0),
    sampleCount:     own.reduce((sum, row) => sum + row.sampleCount, 0),
  }
}

// ── the summary strip ──────────────────────────────────────────────────────

const CLASS_EXPLANATIONS: Readonly<Record<ExceedanceClass, string>> = {
  limit:    'Results above a limit that binds the site.',
  action:   'Results above a benchmark or numeric action level. These call for a response; on their own they are not violations of the permit.',
  internal: 'Results outside a target the site set for itself.',
}

export interface ExceedanceCard {
  exceedanceClass: ExceedanceClass
  label:           string
  count:           number
  explanation:     string
}

/** One card per class, never one number for several: internal targets appear only when one was missed. */
export function exceedanceCards(totals: ClassCounts): ExceedanceCard[] {
  const classes: ExceedanceClass[] = totals.internal > 0 ? ['limit', 'action', 'internal'] : ['limit', 'action']
  return classes.map(exceedanceClass => ({
    exceedanceClass, label: EXCEEDANCE_CLASS_LABELS[exceedanceClass], count: totals[exceedanceClass], explanation: CLASS_EXPLANATIONS[exceedanceClass],
  }))
}

// ── choices ────────────────────────────────────────────────────────────────

/** The parameters to suggest: those the site has limits for first, then any it only has results for, one spelling each. */
export function parameterChoices(limits: readonly Pick<MonitoringLimit, 'parameter'>[], results: readonly Pick<MonitoringResult, 'parameter'>[]): string[] {
  const seen = new Map<string, string>()
  for (const { parameter } of [...limits, ...results]) {
    const key = normalizeParameter(parameter)
    if (!seen.has(key)) seen.set(key, parameter.trim())
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** The unit the site's limits use for a parameter, to save typing it again; null if it has no limit for it. */
export function unitSuggestion(limits: readonly Pick<MonitoringLimit, 'parameter' | 'unit'>[], parameter: string): string | null {
  const key = normalizeParameter(parameter)
  return limits.find(limit => normalizeParameter(limit.parameter) === key)?.unit ?? null
}

/** The permits to offer a limit: those at its site in force, and the one it names now even if retired. */
export function permitChoicesForLimit<T extends PermitRef>(permits: readonly T[], siteId: string, linkedPermitId: string | null): T[] {
  return permitsAtSite(permits, siteId).filter(permit => permit.retired_at === null || permit.id === linkedPermitId)
}

export interface DefaultChoice {
  limit:   DefaultLimit
  /** Already adopted for this place: adopting it again would change nothing. */
  adopted: boolean
}

export const defaultChoices = (offered: readonly DefaultLimit[], limits: readonly MonitoringLimit[], outfallId: string | null): DefaultChoice[] =>
  offered.map(limit => ({
    limit,
    adopted: limits.some(existing => existing.libraryKey === limit.libraryKey && existing.outfallId === outfallId),
  }))

export const LIMIT_KIND_CHOICES: ReadonlyArray<{ value: LimitKind; label: string }> =
  LIMIT_KINDS.map(value => ({ value, label: LIMIT_KIND_META[value].label }))

export const LIMIT_BASIS_CHOICES: ReadonlyArray<{ value: LimitBasis; label: string }> =
  LIMIT_BASES.map(value => ({ value, label: LIMIT_BASIS_META[value].label }))

// ── the result form ────────────────────────────────────────────────────────

export interface ResultFormState {
  /** The id of the outfall sampled, or '' for the site as a whole. */
  outfallId:      string
  parameter:      string
  value:          string
  unit:           string
  belowDetection: boolean
  /** For a datetime-local input: the sampler's own clock, no zone. */
  sampledAt:      string
  eventLabel:     string
  lab:            string
  evidenceId:     string | null
  note:           string
}

/** A datetime-local value for an instant, on this computer's clock. */
export const toLocalInput = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** A new result starts at the moment it is being recorded: most are entered straight after the sample. */
export const blankResultForm = (nowMs: number): ResultFormState => ({
  outfallId: '', parameter: '', value: '', unit: '', belowDetection: false, sampledAt: toLocalInput(nowMs),
  eventLabel: '', lab: '', evidenceId: null, note: '',
})

export const resultToForm = (result: MonitoringResult): ResultFormState => ({
  outfallId:      result.outfallId ?? '',
  parameter:      result.parameter,
  value:          String(result.value),
  unit:           result.unit,
  belowDetection: result.belowDetection,
  sampledAt:      toLocalInput(Date.parse(result.sampledAt)),
  eventLabel:     result.eventLabel ?? '',
  lab:            result.lab ?? '',
  evidenceId:     result.evidenceId,
  note:           result.note ?? '',
})

// A type alias, not an interface: the API client takes a Record<string, unknown>.
export type ResultRequestBody = {
  outfall_id:      string | null
  parameter:       string
  value:           number
  unit:            string
  below_detection: boolean
  sampled_at:      string
  event_label:     string | null
  lab:             string | null
  evidence_id:     string | null
  note:            string | null
}

export type ResultRequest =
  | { ok: true; body: ResultRequestBody }
  | { ok: false; errors: string[] }

/**
 * The request for the API from the form, or what to fix first. Ranges are the API's to judge;
 * here the value only has to be a number and the time a time, because anything else cannot be
 * sent as one.
 */
export function buildResultRequest(form: ResultFormState): ResultRequest {
  const errors: string[] = []
  const value = isBlank(form.value) ? Number.NaN : Number(form.value.trim())
  if (!Number.isFinite(value)) errors.push('Enter the result as a number.')
  const sampled = isBlank(form.sampledAt) ? Number.NaN : new Date(form.sampledAt).getTime()
  if (Number.isNaN(sampled)) errors.push('Enter when the sample was taken.')
  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    body: {
      outfall_id:      form.outfallId || null,
      parameter:       form.parameter.trim(),
      value,
      unit:            form.unit.trim(),
      below_detection: form.belowDetection,
      sampled_at:      new Date(sampled).toISOString(),
      event_label:     orNull(form.eventLabel),
      lab:             orNull(form.lab),
      evidence_id:     form.evidenceId,
      note:            orNull(form.note),
    },
  }
}

// ── the limit form ─────────────────────────────────────────────────────────

export interface LimitFormState {
  /** The id of the outfall the limit is for, or '' for the whole site. */
  outfallId:     string
  parameter:     string
  kind:          LimitKind
  value:         string
  unit:          string
  basis:         LimitBasis
  /** The id of the permit it comes from, or ''. */
  permitId:      string
  citation:      string
  verify:        string
  effectiveFrom: string
  effectiveTo:   string
}

export const blankLimitForm = (): LimitFormState => ({
  outfallId: '', parameter: '', kind: 'instantaneous_max', value: '', unit: '', basis: 'permit_limit', permitId: '',
  citation: '', verify: '', effectiveFrom: '', effectiveTo: '',
})

export const limitToForm = (limit: MonitoringLimit): LimitFormState => ({
  outfallId:     limit.outfallId ?? '',
  parameter:     limit.parameter,
  kind:          limit.kind,
  value:         String(limit.value),
  unit:          limit.unit,
  basis:         limit.basis,
  permitId:      limit.permitId ?? '',
  citation:      limit.citation ?? '',
  verify:        limit.verify ?? '',
  effectiveFrom: limit.effectiveFrom ?? '',
  effectiveTo:   limit.effectiveTo ?? '',
})

export type LimitRequestBody = {
  outfall_id:     string | null
  permit_id:      string | null
  parameter:      string
  unit:           string
  limit_kind:     LimitKind
  value:          number
  basis:          LimitBasis
  citation:       string | null
  verify:         string | null
  effective_from: string | null
  effective_to:   string | null
}

export type LimitRequest =
  | { ok: true; body: LimitRequestBody }
  | { ok: false; errors: string[] }

export function buildLimitRequest(form: LimitFormState): LimitRequest {
  const value = isBlank(form.value) ? Number.NaN : Number(form.value.trim())
  if (!Number.isFinite(value)) return { ok: false, errors: ['Enter the limit as a number.'] }

  return {
    ok: true,
    body: {
      outfall_id:     form.outfallId || null,
      permit_id:      form.permitId || null,
      parameter:      form.parameter.trim(),
      unit:           form.unit.trim(),
      limit_kind:     form.kind,
      value,
      basis:          form.basis,
      citation:       orNull(form.citation),
      verify:         orNull(form.verify),
      effective_from: orNull(form.effectiveFrom),
      effective_to:   orNull(form.effectiveTo),
    },
  }
}
