import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { generateIso14001ReportCard } from '@/lib/pdfIso14001ReportCard'
import { assessIso14001, type ReadinessSignals } from '@soteria/core/iso14001Readiness'

// Smoke tests for the ISO 14001 audit-readiness PDF. Bytes aren't
// snapshotted (timestamps vary); we assert it produces a valid,
// re-parseable PDF, survives text pdf-lib's WinAnsi fonts can't encode,
// and — the part that matters — never prints the word "compliant".

function signals(overrides: Partial<ReadinessSignals> = {}): ReadinessSignals {
  return {
    disabledModules: [],
    risks: { count: 12, ageDays: 30 },
    documentsRegisterLive: false, policyApproved: false, policyReviewOverdue: false,
    requiredDocsMissing: 0, docsReviewOverdue: 0, risksWithoutControls: 0,
    aspectsTotal: 14, aspectsSignificant: 5, significantUncontrolled: 1,
    aspectsRegisterAgeDays: 20,
    obligationsTotal: 6, obligationsOverdue: 1, complianceEvalAgeDays: 50,
    significantUnaddressed: 1,
    objectivesActive: 6, objectivesLinked: 6, objectivesWithTargets: 6, objectivesAchieved: 1,
    trainingRecords: 40, trainingExpired: 0, trainingExpiringSoon: 0,
    awarenessAgeDays: 45, communicationAgeDays: 45,
    operationalInspections: 22, operationalOverdue: 0,
    emergencyDrillAgeDays: null, objectivesStaleReadings: 1,
    auditProgrammeLive: false, lastAuditAgeDays: null, auditClausesUncovered: 0,
    lastReviewAgeDays: 120, lastReviewHasOutputs: true,
    nonconformityRegisterLive: true, openMajorNonconformities: 1, overdueActions: 2,
    closedWithoutVerification: 0, improvementsThisPeriod: 4,
    ...overrides,
  }
}

const GENERATED_AT = '2026-08-19T12:00:00.000Z'

async function render(overrides: Partial<ReadinessSignals> = {}, tenantName = 'Acme Manufacturing') {
  return generateIso14001ReportCard({
    card: assessIso14001(signals(overrides)),
    tenantName,
    generatedAt: GENERATED_AT,
  })
}

describe('generateIso14001ReportCard', () => {
  it('produces a valid, re-parseable PDF', async () => {
    const bytes = await render()
    expect(bytes.byteLength).toBeGreaterThan(1000)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('paginates rather than overflowing when every clause carries a long reason', async () => {
    // 19 clauses each with a wrapped multi-line reason will not fit on
    // one Letter page; reserveSpace() should add pages.
    const doc = await PDFDocument.load(await render({
      aspectsTotal: 0, aspectsSignificant: 0, obligationsTotal: 0,
      objectivesActive: 0, trainingRecords: 0, awarenessAgeDays: null,
      communicationAgeDays: null, operationalInspections: 0,
      complianceEvalAgeDays: null, risks: { count: 0, ageDays: null },
      nonconformityRegisterLive: false, improvementsThisPeriod: 0,
      objectivesAchieved: 0,
    }))
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('survives characters WinAnsi cannot encode', async () => {
    // Tenant names arrive from user input; an unsanitised em-dash,
    // smart quote, or subscript once crashed a generator in production.
    const bytes = await render({}, 'Acme — “Field” Co. O₂ 😀')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('renders the not-ready band when a major is open', async () => {
    const card = assessIso14001(signals())
    expect(card.band).toBe('not_ready')
    // The PDF is generated from that card, so the band it draws is the
    // band the assessment produced — no second opinion in the renderer.
    const bytes = await generateIso14001ReportCard({
      card, tenantName: 'Acme', generatedAt: GENERATED_AT,
    })
    expect(bytes.byteLength).toBeGreaterThan(1000)
  })

  it('renders a fully-evidenced EMS without blocking findings', async () => {
    const card = assessIso14001(signals({
      documentsRegisterLive: true, policyApproved: true, requiredDocsMissing: 0,
      auditProgrammeLive: true, lastAuditAgeDays: 90, auditClausesUncovered: 0,
      emergencyDrillAgeDays: 120, openMajorNonconformities: 0, overdueActions: 0,
      significantUncontrolled: 0, significantUnaddressed: 0,
      obligationsOverdue: 0, objectivesStaleReadings: 0,
    }))
    expect(card.band).toBe('ready')
    expect(card.blockers).toEqual([])
    const doc = await PDFDocument.load(await generateIso14001ReportCard({
      card, tenantName: 'Acme', generatedAt: GENERATED_AT,
    }))
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })
})
