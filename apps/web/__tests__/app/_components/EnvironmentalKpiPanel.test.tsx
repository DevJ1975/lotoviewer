import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const fetchKpis = vi.fn()
vi.mock('@/lib/environmental/kpiFetch', () => ({ fetchEnvironmentalKpis: () => fetchKpis() }))
const tenantState = { tenant: { modules: { environmental: true } as Record<string, boolean> | null }, loading: false }
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => tenantState }))

import EnvironmentalKpiPanel from '@/app/_components/EnvironmentalKpiPanel'

const kpis = (over: Record<string, number> = {}) => ({
  obligationsOverdue: 0, obligationsDueSoon: 0, checklistsOverdue: 0, checklistsNeverRun: 0, openFindings: 0,
  permitsExpiring: 0, permitsExpired: 0, legalReviewsOverdue: 0, legalNeverReviewed: 0, ...over,
})

beforeEach(() => {
  fetchKpis.mockReset()
  tenantState.tenant = { modules: { environmental: true } }
  tenantState.loading = false
})

describe('EnvironmentalKpiPanel', () => {
  it('stays out of the way when the tenant does not have the module, without fetching anything', () => {
    tenantState.tenant = { modules: { environmental: false } }
    const { container } = render(<EnvironmentalKpiPanel />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchKpis).not.toHaveBeenCalled()
  })

  it('waits for the tenant before deciding', () => {
    tenantState.loading = true
    const { container } = render(<EnvironmentalKpiPanel />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchKpis).not.toHaveBeenCalled()
  })

  it('invites an untouched account to set up, rather than showing a wall of zeros', async () => {
    fetchKpis.mockResolvedValue({ kpis: kpis(), legalNonCompliant: 0, hasData: false })
    render(<EnvironmentalKpiPanel />)
    expect(await screen.findByText('No environmental compliance records yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Set up your sites/ })).toHaveAttribute('href', '/environmental/compliance')
  })

  it('shows what needs attention, each tile linking to where it is fixed', async () => {
    fetchKpis.mockResolvedValue({
      kpis: kpis({ obligationsOverdue: 2, obligationsDueSoon: 3, permitsExpiring: 1, permitsExpired: 1, legalReviewsOverdue: 4, openFindings: 5 }),
      legalNonCompliant: 2, hasData: true,
    })
    render(<EnvironmentalKpiPanel />)
    await screen.findByText('Overdue deadlines')
    const link = (name: RegExp) => screen.getByRole('link', { name })
    expect(link(/Overdue deadlines/)).toHaveAttribute('href', '/environmental/compliance/calendar')
    expect(link(/Permits to renew/)).toHaveAttribute('href', '/environmental/compliance/permits')
    expect(link(/Non-compliant/)).toHaveAttribute('href', '/environmental/compliance/legal')
    expect(link(/Open findings/)).toHaveAttribute('href', '/environmental/nonconformities')
    expect(screen.getByText('3 due soon')).toBeInTheDocument()
    expect(screen.getByText('1 expired')).toBeInTheDocument()
    expect(screen.getByText('4 reviews overdue')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Something needs attention today.')
  })

  it('says nothing alarming when all is well', async () => {
    fetchKpis.mockResolvedValue({ kpis: kpis({ obligationsDueSoon: 1 }), legalNonCompliant: 0, hasData: true })
    render(<EnvironmentalKpiPanel />)
    await screen.findByText('Overdue deadlines')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders nothing, not an error box, when the numbers cannot be read', async () => {
    fetchKpis.mockRejectedValue(new Error('relation does not exist'))
    const { container } = render(<EnvironmentalKpiPanel />)
    await waitFor(() => expect(fetchKpis).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
