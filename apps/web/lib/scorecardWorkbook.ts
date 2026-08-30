import type { Worksheet } from 'exceljs'
import type { IncidentRiskResult } from '@soteria/core/incidentRiskModel'
import { summarizeRecordableDistribution } from '@soteria/core/scorecardDistribution'

// Multi-tab Excel (.xlsx) export of the EHS Scorecard. The same numbers the
// page and the PDF show, in a workbook an analyst can pivot — and that imports
// cleanly into Google Sheets, satisfying the "Google spreadsheet" ask without an
// in-app OAuth integration.
//
// exceljs is loaded with a runtime dynamic import() so it never enters the
// client bundle (the type import below is erased at compile). The risk model +
// statistics are reused from @soteria/core so every surface agrees to the digit.
//
// Security: every STRING cell passes a CSV/formula-injection guard (a leading
// = + - @ TAB CR is the classic Sheets/Excel formula-injection vector). Numeric
// cells are written as numbers and carry no such risk.

// ── Defensive input shapes (LOTO + incident arrive as JSON from the client) ──
interface LotoLike {
  totalPermits?: number
  cancelRate?: number
  avgPermitDurationMinutes?: number
  failingTestRate?: number
  photoCompletionPct?: number
  cancelReasonBreakdown?: { reason?: unknown; count?: unknown }[]
}
interface MonthLike { month?: unknown; count?: unknown }
interface IncidentLike {
  trir?: number | null
  dart?: number | null
  ltir?: number | null
  severityRate?: number | null
  totalRecordable?: number
  daysSinceLastRecordable?: number
  nearMissToRecordableRatio?: number | null
  actionClosureOnTimePct?: number | null
  rcaCompletionPct?: number | null
  recordablesByMonth?: MonthLike[]
  nearMissByMonth?: MonthLike[]
}

/** One row of the Targets tab — pre-evaluated server-side (current vs goal). */
export interface TargetSummaryRow {
  metric:    string
  current:   number | null
  target:    number | null
  benchmark: number | null
  onTrack:   boolean | null
  status:    string
}

export interface ScorecardWorkbookInput {
  tenantName: string
  windowDays: number
  loto?:      LotoLike | null
  incident?:  IncidentLike | null
  /** Recomputed server-side — the authoritative predicted-risk headline. */
  risk?:      IncidentRiskResult | null
  targets?:   TargetSummaryRow[]
  generatedAt?: Date
}

// ── Cell safety + small helpers ──────────────────────────────────────────────
const FORMULA_PREFIX = /^[=+\-@\t\r]/
function safeText(value: unknown): string {
  const s = value == null ? '' : String(value)
  return FORMULA_PREFIX.test(s) ? `'${s}` : s
}
type Cell = string | number | null
function addRow(ws: Worksheet, cells: Cell[]) {
  return ws.addRow(cells.map(c => (typeof c === 'string' ? safeText(c) : c)))
}
function addHeader(ws: Worksheet, cells: string[]) {
  const r = addRow(ws, cells)
  r.font = { bold: true }
}
function addTitle(ws: Worksheet, text: string) {
  addRow(ws, [text]).font = { bold: true, size: 14 }
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function orNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function round(v: number | null, dp = 2): number | null {
  if (v === null) return null
  const f = 10 ** dp
  return Math.round(v * f) / f
}

// Merge the recordable + near-miss monthly series into a sorted, aligned trend.
function mergeMonthly(rec?: MonthLike[], nm?: MonthLike[]): { month: string; recordable: number; nearMiss: number }[] {
  const map = new Map<string, { recordable: number; nearMiss: number }>()
  for (const b of rec ?? []) {
    const m = String(b.month ?? '')
    if (m) map.set(m, { recordable: num(b.count), nearMiss: map.get(m)?.nearMiss ?? 0 })
  }
  for (const b of nm ?? []) {
    const m = String(b.month ?? '')
    if (!m) continue
    const e = map.get(m) ?? { recordable: 0, nearMiss: 0 }
    e.nearMiss = num(b.count)
    map.set(m, e)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, recordable: v.recordable, nearMiss: v.nearMiss }))
}

function fmtBool(v: boolean | null): string {
  return v === null ? '—' : v ? 'Yes' : 'No'
}

export async function buildScorecardWorkbook(input: ScorecardWorkbookInput): Promise<Uint8Array> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'SoteriaField'
  wb.created = input.generatedAt ?? new Date()
  wb.title = `EHS Scorecard · ${input.tenantName}`

  const inc = input.incident ?? {}
  const loto = input.loto ?? {}
  const risk = input.risk ?? null

  // ── Summary ────────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Summary')
    ws.columns = [{ width: 32 }, { width: 24 }]
    addTitle(ws, `EHS Scorecard — ${input.tenantName}`)
    addRow(ws, [`Last ${input.windowDays} days · generated ${(input.generatedAt ?? new Date()).toLocaleDateString()}`])
    addRow(ws, [])

    if (risk) {
      addHeader(ws, ['Predicted incident risk', ''])
      addRow(ws, ['Score (0–100)', round(risk.score, 1)])
      addRow(ws, ['Band', risk.band])
      addRow(ws, [])
    }

    addHeader(ws, ['Injury & OSHA metric', 'Value'])
    addRow(ws, ['TRIR (per 100 FTE)', orNull(inc.trir)])
    addRow(ws, ['DART (per 100 FTE)', orNull(inc.dart)])
    addRow(ws, ['LTIR (per 100 FTE)', orNull(inc.ltir)])
    addRow(ws, ['Severity rate', orNull(inc.severityRate)])
    addRow(ws, ['Days since last recordable', (inc.daysSinceLastRecordable ?? -1) < 0 ? 'none on file' : num(inc.daysSinceLastRecordable)])
    addRow(ws, ['Near-miss : recordable ratio', orNull(inc.nearMissToRecordableRatio)])
    addRow(ws, ['CAPA on time (%)', orNull(inc.actionClosureOnTimePct)])
    addRow(ws, ['RCA completion (%)', orNull(inc.rcaCompletionPct)])
    addRow(ws, [])

    addHeader(ws, ['Permits & LOTO program', 'Value'])
    addRow(ws, ['Permit load (permits)', num(loto.totalPermits)])
    addRow(ws, ['Cancel pressure (% non-routine)', num(loto.cancelRate)])
    addRow(ws, ['Permit cycle (avg minutes)', num(loto.avgPermitDurationMinutes)])
    addRow(ws, ['Atmospheric control (% failed tests)', num(loto.failingTestRate)])
    addRow(ws, ['LOTO photo readiness (%)', num(loto.photoCompletionPct)])
  }

  // ── Leading / Lagging (one builder, two tabs) ────────────────────────────────
  for (const kind of ['leading', 'lagging'] as const) {
    const ws = wb.addWorksheet(kind === 'leading' ? 'Leading' : 'Lagging')
    ws.columns = [{ width: 36 }, { width: 22 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 60 }]
    addTitle(ws, kind === 'leading' ? 'Leading indicators (preventive)' : 'Lagging indicators (outcomes)')
    addRow(ws, [])
    addHeader(ws, ['Indicator', 'Current', 'Target', 'Pressure (0–100)', 'Contribution', 'Suggested action'])
    const drivers = (risk?.drivers ?? []).filter(d => d.kind === kind)
    if (drivers.length === 0) {
      addRow(ws, ['No indicators in this class.'])
    } else {
      for (const d of drivers) {
        addRow(ws, [d.label, d.value, d.target, round(d.pressure, 1), round(d.contribution, 1), d.suggestedAction])
      }
    }
  }

  // ── Trends ───────────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Trends')
    ws.columns = [{ width: 14 }, { width: 16 }, { width: 16 }]
    addTitle(ws, 'Recordable & near-miss trend (monthly)')
    addRow(ws, [])
    addHeader(ws, ['Month', 'Recordables', 'Near-misses'])
    const monthly = mergeMonthly(inc.recordablesByMonth, inc.nearMissByMonth)
    if (monthly.length === 0) {
      addRow(ws, ['No monthly history available.'])
    } else {
      for (const r of monthly) addRow(ws, [r.month, r.recordable, r.nearMiss])
    }
  }

  // ── Distribution (statistically honest: c-chart + descriptive stats) ─────────
  {
    const ws = wb.addWorksheet('Distribution')
    ws.columns = [{ width: 34 }, { width: 20 }]
    addTitle(ws, 'Recordable count distribution (monthly)')
    addRow(ws, ['Counts are rare events — summarized with a c-chart (mean ±3σ), not a bell curve.'])
    addRow(ws, [])

    const counts = (inc.recordablesByMonth ?? []).map(m => num(m.count))
    const dist = summarizeRecordableDistribution(counts)
    if (dist.n < 2) {
      addRow(ws, ['Insufficient data', `${dist.n} month(s) — need ≥ 2`])
    } else {
      addHeader(ws, ['Statistic', 'Value'])
      addRow(ws, ['Months observed (n)', dist.n])
      addRow(ws, ['Mean', round(dist.mean, 2)])
      addRow(ws, ['Median', round(dist.median, 2)])
      addRow(ws, ['Std. deviation', round(dist.stdDev, 2)])
      addRow(ws, ['Coefficient of variation', round(dist.cv, 2)])
      addRow(ws, ['Skewness', round(dist.skewness, 2)])
      addRow(ws, ['Min', dist.min])
      addRow(ws, ['Max', dist.max])
      addRow(ws, [])

      if (dist.cChart) {
        addHeader(ws, ['c-chart control limits', 'Value'])
        addRow(ws, ['Center line (mean count)', round(dist.cChart.centerLine, 2)])
        addRow(ws, ['Upper control limit (UCL)', round(dist.cChart.ucl, 2)])
        addRow(ws, ['Lower control limit (LCL)', round(dist.cChart.lcl, 2)])
        addRow(ws, [])
      }

      addHeader(ws, ['Next-month forecast', 'Value'])
      if (dist.forecast) {
        addRow(ws, ['Expected recordables', round(dist.forecast.expected, 2)])
        addRow(ws, ['95% interval — lower', round(dist.forecast.lower, 2)])
        addRow(ws, ['95% interval — upper', round(dist.forecast.upper, 2)])
        addRow(ws, ['Reliable trend?', dist.forecast.hasTrend ? 'Yes' : 'No (run-rate)'])
      } else {
        addRow(ws, ['Forecast', 'insufficient history'])
      }
    }
  }

  // ── Targets ──────────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Targets')
    ws.columns = [{ width: 22 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 12 }, { width: 18 }]
    addTitle(ws, 'Goals vs. industry benchmark')
    addRow(ws, [])
    addHeader(ws, ['Metric', 'Current', 'Target', 'Benchmark', 'On track', 'Status'])
    const targets = input.targets ?? []
    if (targets.length === 0) {
      addRow(ws, ['No targets configured.'])
    } else {
      for (const t of targets) {
        addRow(ws, [t.metric, orNull(t.current), orNull(t.target), orNull(t.benchmark), fmtBool(t.onTrack), t.status])
      }
    }
  }

  // ── Risk drivers (full, ranked) ──────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Risk drivers')
    ws.columns = [{ width: 36 }, { width: 12 }, { width: 22 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 60 }]
    addTitle(ws, 'All risk drivers (ranked by contribution)')
    addRow(ws, [])
    addHeader(ws, ['Indicator', 'Kind', 'Current', 'Target', 'Pressure (0–100)', 'Contribution', 'Suggested action'])
    const drivers = risk?.drivers ?? []
    if (drivers.length === 0) {
      addRow(ws, ['No driver data available.'])
    } else {
      for (const d of drivers) {
        addRow(ws, [d.label, d.kind, d.value, d.target, round(d.pressure, 1), round(d.contribution, 1), d.suggestedAction])
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf)
}
