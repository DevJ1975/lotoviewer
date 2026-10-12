import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const fetchKpis = vi.fn()
vi.mock('@/lib/environmental/kpiFetch', () => ({ fetchEnvironmentalKpis: () => fetchKpis() }))
const tenantState = { tenant: { modules: { environmental: true } as Record<string, boolean> | null }, loading: false }
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => tenantState }))
// The card's tone is only a colour class in the real one; this stand-in exposes the
// props the panel decides (tone, value, link) so the tests can assert them directly.
vi.mock('@/app/_components/InfographicMetricCard', () => ({
  InfographicMetricCard: (props: { label: string; value: number; caption?: string; href?: string; tone?: string }) => (
    <a href={props.href} data-tone={props.tone} data-value={props.value}>
      <span>{props.label}</span>
      <span>{props.caption}</span>
    </a>
  ),
}))

import EnvironmentalKpiPanel from '@/app/_components/EnvironmentalKpiPanel'

const kpis = (over: Record<string, number> = {}) => ({
  obligationsOverdue: 0, obligationsDueSoon: 0, checklistsOverdue: 0, checklistsNeverRun: 0, openFindings: 0,
  permitsRenewalSoon: 0, permitsRenewalMissed: 0, legalReviewsOverdue: 0, legalNeverReviewed: 0, ...over,
})

const showPanel = async (over: Record<string, number> = {}) => {
  fetchKpis.mockResolvedValue({ kpis: kpis(over), legalNonCompliant: 0, hasData: true })
  const view = render(<EnvironmentalKpiPanel />)
  await screen.findByText('Overdue deadlines')
  return view
}
const permitsTile = () => screen.getByRole('link', { name: /Permits to renew/ })

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
      kpis: kpis({ obligationsOverdue: 2, obligationsDueSoon: 3, permitsRenewalSoon: 1, permitsRenewalMissed: 1, legalReviewsOverdue: 4, openFindings: 5 }),
      legalNonCompliant: 2, hasData: true,
    })
    render(<EnvironmentalKpiPanel />)
    await screen.findByText('Overdue deadlines')
    const link = (name: RegExp) => screen.getByRole('link', { name })
    expect(link(/Overdue deadlines/)).toHaveAttribute('href', '/environmental/compliance/calendar')
    expect(link(/Permits to renew/)).toHaveAttribute('href', '/environmental/permits')
    expect(link(/Non-compliant/)).toHaveAttribute('href', '/environmental/compliance/legal')
    expect(link(/Open findings/)).toHaveAttribute('href', '/environmental/nonconformities')
    expect(screen.getByText('3 due soon')).toBeInTheDocument()
    expect(screen.getByText('1 past their renewal deadline')).toBeInTheDocument()
    expect(screen.getByText('4 reviews overdue')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Something needs attention today.')
  })

  it('says nothing alarming when all is well', async () => {
    await showPanel({ obligationsDueSoon: 1 })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders nothing, not an error box, when the numbers cannot be read', async () => {
    fetchKpis.mockRejectedValue(new Error('relation does not exist'))
    const { container } = render(<EnvironmentalKpiPanel />)
    await waitFor(() => expect(fetchKpis).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('claims no ISO 14001 clause, since the suite does not grade one', async () => {
    const { container } = await showPanel()
    expect(container.textContent).not.toMatch(/ISO 14001|\b\d\.\d(\.\d)?\b/)
  })
})

describe('the "Permits to renew" tile', () => {
  it('counts renewals due soon together with missed ones, and turns critical once any deadline was missed', async () => {
    await showPanel({ permitsRenewalSoon: 2, permitsRenewalMissed: 1 })
    expect(permitsTile()).toHaveAttribute('data-value', '3')
    expect(permitsTile()).toHaveAttribute('data-tone', 'critical')
    expect(screen.getByText('1 past their renewal deadline')).toBeInTheDocument()
  })

  it('is critical for a missed deadline alone, and that alone calls for attention today', async () => {
    await showPanel({ permitsRenewalMissed: 1 })
    expect(permitsTile()).toHaveAttribute('data-value', '1')
    expect(permitsTile()).toHaveAttribute('data-tone', 'critical')
    expect(screen.getByRole('status')).toHaveTextContent('Something needs attention today.')
  })

  it('is only a warning while renewals are coming up, and says so without calling anything expired', async () => {
    await showPanel({ permitsRenewalSoon: 2 })
    expect(permitsTile()).toHaveAttribute('data-value', '2')
    expect(permitsTile()).toHaveAttribute('data-tone', 'warning')
    expect(screen.getByText('renewal due within 90 days')).toBeInTheDocument()
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is calm when no renewal is due', async () => {
    await showPanel()
    expect(permitsTile()).toHaveAttribute('data-value', '0')
    expect(permitsTile()).toHaveAttribute('data-tone', 'safe')
  })
})
