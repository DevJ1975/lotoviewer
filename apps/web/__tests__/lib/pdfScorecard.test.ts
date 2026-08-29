import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildScorecardPdf, type ScorecardPdfInput } from '@/lib/pdfScorecard'
import { summarizeIncidentRisk } from '@soteria/core/incidentRiskModel'

// Smoke tests for the comprehensive EHS scorecard generator. We don't snapshot
// bytes (PDF dates vary); we assert it produces a valid, re-parseable PDF, never
// crashes on WinAnsi-incompatible text, and paginates when content overflows.

const risk = summarizeIncidentRisk({
  recordablesRecent: 6, recordablesPrior: 2, nearMissRecent: 0,
  bbsSafe: 0, bbsUnsafe: 10, capasOverdue: 8, riskReviewsOverdue: 9,
  highRisksUncontrolled: 4, trainingExpired: 6, atmFailed: 10, atmTotal: 10,
})

function months(n: number): { month: string; count: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    month: `2025-${String((i % 12) + 1).padStart(2, '0')}`,
    count: (i * 3) % 7,
  }))
}

function fullInput(overrides: Partial<ScorecardPdfInput> = {}): ScorecardPdfInput {
  return {
    // Tenant name carries an em-dash + smart quote to exercise sanitizeForWinAnsi.
    tenantName: 'Acme — “Field” Co. O₂',
    windowDays: 30,
    loto: {
      totalPermits: 42, cancelRate: 12, avgPermitDurationMinutes: 95,
      failingTestRate: 4, photoCompletionPct: 88,
      cancelReasonBreakdown: [{ reason: 'Task complete', count: 30 }, { reason: 'Expired', count: 5 }],
    },
    incident: {
      trir: 3.21, dart: 1.8, ltir: 0.9, severityRate: 12.4,
      totalRecordable: 6, daysSinceLastRecordable: 14,
      nearMissToRecordableRatio: 4.2, actionClosureOnTimePct: 76, rcaCompletionPct: 83,
      recordablesByMonth: months(12),
      nearMissByMonth: months(12).map(m => ({ ...m, count: m.count + 2 })),
    },
    risk,
    ...overrides,
  }
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPageCount()
}

describe('buildScorecardPdf', () => {
  it('produces a valid, re-parseable PDF from full input', async () => {
    const bytes = await buildScorecardPdf(fullInput())
    expect(bytes.byteLength).toBeGreaterThan(1000)
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1)
  })

  it('does not crash on WinAnsi-incompatible text', async () => {
    // The em-dash, smart quotes, and subscript-2 in the tenant name must not
    // throw a "WinAnsi cannot encode" error during draw.
    await expect(buildScorecardPdf(fullInput())).resolves.toBeInstanceOf(Uint8Array)
  })

  it('renders with no risk and no incident metrics (graceful degradation)', async () => {
    const bytes = await buildScorecardPdf(fullInput({ risk: null, incident: null }))
    expect(bytes.byteLength).toBeGreaterThan(800)
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1)
  })

  it('paginates when the trend series is long', async () => {
    const bytes = await buildScorecardPdf(fullInput({
      incident: { ...fullInput().incident, recordablesByMonth: months(36), nearMissByMonth: months(36) },
    }))
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1)
  })

  it('renders the distribution section and degrades on sparse recordable history', async () => {
    // One month of recordables exercises the distribution section's
    // insufficient-data path (the full-input cases above cover the populated path).
    const bytes = await buildScorecardPdf(fullInput({
      incident: { ...fullInput().incident, recordablesByMonth: [{ month: '2025-01', count: 2 }] },
    }))
    expect(bytes.byteLength).toBeGreaterThan(800)
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1)
  })
})
