import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReadinessSignals } from '@soteria/core/iso14001Readiness'
import Iso14001ReportCardPage from '@/app/environmental/report-card/page'

// The report card page renders a verdict a customer may act on, so the
// tests that matter are about what it says, not how it looks:
//   - a blocking finding beats a high coverage percentage
//   - the word "compliant" never reaches the screen
//   - a clause with no shipped feature offers no dead "Fix" link

const signals = vi.hoisted(() => ({ current: null as ReadinessSignals | null }))

vi.mock('@/lib/iso14001Signals', () => ({
  fetchIso14001Signals: vi.fn(async () => {
    if (!signals.current) throw new Error('no fixture installed')
    return signals.current
  }),
}))

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ profile: { is_admin: true }, loading: false }),
}))

vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => ({
    tenantId: 'tenant-1',
    tenant:   { id: 'tenant-1', name: 'Acme Manufacturing', modules: {} },
  }),
}))

vi.mock('@/components/Breadcrumbs', () => ({ Breadcrumbs: () => null }))

function healthy(): ReadinessSignals {
  return {
    contextIssuesActive: 8, contextIssuesReviewOverdue: 0, climateIssueRecorded: true,
    interestedPartiesActive: 5, interestedPartiesReviewOverdue: 0,
    scopeOnFile: true, scopeReviewOverdue: false, policySignatoryStale: false,
    risks: { count: 12, ageDays: 30 },
    documentsRegisterLive: true, policyApproved: true, policyReviewOverdue: false,
    requiredDocsMissing: 0, docsReviewOverdue: 0, risksWithoutControls: 0,
    aspectsTotal: 14, aspectsSignificant: 5, significantUncontrolled: 0,
    aspectsUnscored: 0, aspectsReviewOverdue: 0,
    obligationsTotal: 6, obligationsOverdue: 0, obligationsReviewOverdue: 0,
    complianceEvalAgeDays: 50, evaluationsOverdue: 0, obligationsUnscheduled: 0, evaluationsUndetermined: 0,
    significantUnaddressed: 0,
    objectivesActive: 6, objectivesLinked: 6, objectivesWithTargets: 6, objectivesAchieved: 2,
    objectivesStaleReadings: 0,
    auditProgrammeLive: true, lastAuditAgeDays: 90, auditClausesUncovered: 0,
    lastReviewAgeDays: 120, lastReviewHasOutputs: true,
    nonconformityRegisterLive: true, openMajorNonconformities: 0, overdueActions: 0,
    closedWithoutVerification: 0, improvementsThisPeriod: 4,
  }
}

beforeEach(() => { signals.current = healthy() })

describe('ISO 14001 report card page', () => {
  it('leads with the readiness band, not the percentage', async () => {
    render(<Iso14001ReportCardPage />)
    await waitFor(() => {
      expect(screen.getByText('Ready with gaps')).toBeInTheDocument()
    })
    expect(screen.getByText('76%')).toBeInTheDocument()
    expect(screen.getByText('16 of 21 clauses')).toBeInTheDocument()
  })

  it('never shows Ready while clauses are not assessed, and names them instead', async () => {
    // Every clause the platform can see is green. Clauses 7.2 to 8.2 have no
    // environmental source yet, so the card must not call the system ready.
    render(<Iso14001ReportCardPage />)
    await waitFor(() => expect(screen.getByText('Ready with gaps')).toBeInTheDocument())
    expect(screen.queryByText('Ready for a certification audit')).toBeNull()
    expect(screen.getByText(/Check 7\.2, 7\.3, 7\.4, 8\.1, 8\.2 against your own records/)).toBeInTheDocument()
    expect(screen.getAllByText('Not assessed')).toHaveLength(5)
    expect(screen.queryAllByRole('link', { name: /Fix/ })).toEqual([])
  })

  it('says Not ready when a major is open, however high coverage is', async () => {
    signals.current = { ...healthy(), openMajorNonconformities: 1 }
    render(<Iso14001ReportCardPage />)
    await waitFor(() => {
      expect(screen.getByText('Not ready')).toBeInTheDocument()
    })
    expect(screen.getByText(/1 open major nonconformity/)).toBeInTheDocument()
  })

  it('never uses the word "compliant"', async () => {
    // Coverage is not a conformity claim. If this ever fails, someone has
    // put a statement on screen the platform cannot stand behind.
    signals.current = { ...healthy(), openMajorNonconformities: 1, obligationsOverdue: 3 }
    const { container } = render(<Iso14001ReportCardPage />)
    await waitFor(() => expect(screen.getByText('Not ready')).toBeInTheDocument())
    expect(container.textContent?.toLowerCase()).not.toContain('compliant')
    expect(container.textContent).toContain('Evidence coverage')
  })

  it('lists blocking findings separately from the clause table', async () => {
    signals.current = { ...healthy(), documentsRegisterLive: false, requiredDocsMissing: 0 }
    render(<Iso14001ReportCardPage />)
    await waitFor(() => expect(screen.getByText('Blocking findings')).toBeInTheDocument())
    expect(screen.getAllByText('Documented information').length).toBeGreaterThan(0)
  })

  it('offers no Fix link for a clause whose feature has not shipped', async () => {
    signals.current = { ...healthy(), documentsRegisterLive: false, auditProgrammeLive: false }
    render(<Iso14001ReportCardPage />)
    await waitFor(() => expect(screen.getByText('Not ready')).toBeInTheDocument())
    // 7.5 and 9.2 are gaps with a null fixHref, so no dead link is rendered
    // for them. Any "Fix" link that IS present must point somewhere real.
    for (const link of screen.queryAllByRole('link', { name: /Fix/ })) {
      expect(link.getAttribute('href')).toMatch(/^\//)
    }
  })

  it('surfaces a fetch failure instead of rendering an empty card', async () => {
    signals.current = null
    render(<Iso14001ReportCardPage />)
    await waitFor(() => {
      expect(screen.getByText(/no fixture installed/)).toBeInTheDocument()
    })
  })
})
