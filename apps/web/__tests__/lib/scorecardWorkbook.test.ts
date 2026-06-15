import { describe, it, expect } from 'vitest'
import * as ExcelJS from 'exceljs'
import { buildScorecardWorkbook, type ScorecardWorkbookInput } from '@/lib/scorecardWorkbook'
import { summarizeIncidentRisk } from '@soteria/core/incidentRiskModel'

// The workbook is server-only and reuses the deterministic risk model + core
// statistics. We assert the structural contract (every documented tab exists), a
// couple of known numeric cells round-trip, and — critically — that a cell whose
// value starts with a spreadsheet formula trigger is neutralized so the export
// can't carry a CSV/formula-injection payload into Excel or Google Sheets.

const risk = summarizeIncidentRisk({
  recordablesRecent: 4, recordablesPrior: 2, nearMissRecent: 1,
  bbsSafe: 2, bbsUnsafe: 5, capasOverdue: 3, riskReviewsOverdue: 2,
  highRisksUncontrolled: 1, trainingExpired: 2, atmFailed: 1, atmTotal: 4,
})

function months(n: number): { month: string; count: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    month: `2025-${String((i % 12) + 1).padStart(2, '0')}`,
    count: (i * 2) % 5,
  }))
}

function fullInput(overrides: Partial<ScorecardWorkbookInput> = {}): ScorecardWorkbookInput {
  return {
    tenantName: 'Acme — “Field” Co. O₂',
    windowDays: 30,
    loto: {
      totalPermits: 10, cancelRate: 5, avgPermitDurationMinutes: 60,
      failingTestRate: 2, photoCompletionPct: 90, cancelReasonBreakdown: [],
    },
    incident: {
      trir: 3.2, dart: 1.1, ltir: 0.5, severityRate: 8, totalRecordable: 4,
      daysSinceLastRecordable: 10, nearMissToRecordableRatio: 2,
      actionClosureOnTimePct: 80, rcaCompletionPct: 75,
      recordablesByMonth: months(12),
      nearMissByMonth: months(12).map(m => ({ ...m, count: m.count + 1 })),
    },
    risk,
    targets: [
      // A hostile goal label: must be neutralized with a leading apostrophe.
      { metric: '=HYPERLINK("http://evil")', current: 3.2, target: 3.0, benchmark: 2.7, onTrack: false, status: 'off track' },
      { metric: 'DART', current: 1.1, target: 1.5, benchmark: 1.7, onTrack: true, status: 'on track' },
    ],
    ...overrides,
  }
}

async function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  // exceljs types `load(buffer: Buffer)` against an older Buffer than the one
  // @types/node now produces. Cast to exceljs's own parameter type to bridge the
  // skew — it reads the bytes the same either way.
  await wb.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof wb.xlsx.load>[0])
  return wb
}

function findRowValue(ws: ExcelJS.Worksheet, label: string): ExcelJS.CellValue {
  let value: ExcelJS.CellValue = null
  ws.eachRow(row => {
    if (row.getCell(1).value === label) value = row.getCell(2).value
  })
  return value
}

describe('buildScorecardWorkbook', () => {
  it('produces every documented tab', async () => {
    const wb = await load(await buildScorecardWorkbook(fullInput()))
    const names = wb.worksheets.map(w => w.name)
    expect(names).toEqual(
      expect.arrayContaining(['Summary', 'Leading', 'Lagging', 'Trends', 'Distribution', 'Targets', 'Risk drivers']),
    )
  })

  it('writes known numeric cells', async () => {
    const wb = await load(await buildScorecardWorkbook(fullInput()))
    expect(findRowValue(wb.getWorksheet('Summary')!, 'TRIR (per 100 FTE)')).toBe(3.2)
    expect(findRowValue(wb.getWorksheet('Distribution')!, 'Months observed (n)')).toBe(12)
  })

  it('neutralizes a formula-injection cell value', async () => {
    const wb = await load(await buildScorecardWorkbook(fullInput()))
    const targets = wb.getWorksheet('Targets')!
    let neutralized: string | null = null
    targets.eachRow(row => {
      const v = row.getCell(1).value
      if (typeof v === 'string' && v.includes('HYPERLINK')) neutralized = v
    })
    expect(neutralized).not.toBeNull()
    expect(neutralized!).toMatch(/^'=HYPERLINK/)
  })

  it('degrades when risk and incident metrics are absent', async () => {
    const bytes = await buildScorecardWorkbook(fullInput({ risk: null, incident: null, targets: [] }))
    const wb = await load(bytes)
    expect(wb.worksheets.map(w => w.name)).toEqual(
      expect.arrayContaining(['Summary', 'Distribution', 'Targets']),
    )
  })
})
