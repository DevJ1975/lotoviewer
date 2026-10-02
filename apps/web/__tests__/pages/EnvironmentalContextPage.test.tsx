import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RegistersHealth } from '@/lib/environmental/client'

// /environmental/context (clauses 4.1-4.3, 5.2). The page says the rules the
// API enforces before anyone hits them: record the climate-change decision;
// a policy cannot be saved until it states every clause 5.2 commitment; a
// policy signed before the legal entity changed needs re-signing. The tab
// lives in the URL so the report card can link to the gap it names.

const nav = vi.hoisted(() => ({ tab: null as string | null, replace: vi.fn() }))
const access = vi.hoisted(() => ({ role: 'admin' }))
const api = vi.hoisted(() => ({
  getRegistersHealth:    vi.fn(),
  listContextIssues:     vi.fn(),
  listInterestedParties: vi.fn(),
  listObligations:       vi.fn(),
  createInterestedParty: vi.fn(),
  getScope:              vi.fn(),
  getPolicy:             vi.fn(),
  savePolicy:            vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'tab' ? nav.tab : null) }),
  useRouter: () => ({ replace: nav.replace }),
}))
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => ({ tenantId: 'tenant-1', role: access.role }) }))
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ profile: { is_superadmin: false } }) }))
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import EnvironmentalContextPage from '@/app/environmental/context/page'

const REQUIRED = [
  { key: 'ems.protect_environment', label: 'Protect the environment, including preventing pollution' },
  { key: 'ems.fulfil_obligations', label: 'Fulfil our compliance obligations' },
  { key: 'ems.continual_improvement', label: 'Continually improve the environmental management system' },
]

const health: RegistersHealth = {
  asOf: '2026-10-02',
  context: { health: 'amber', active: 1, reviewOverdue: 0, climateRecorded: false },
  scopeAndPolicy: { health: 'red', scopeVersion: null, policyVersion: null, policyComplete: false, signatoryStale: false },
  aspects: { health: 'red', active: 0, reviewOverdue: 0, unscored: 0 },
  obligations: { health: 'red', active: 0, reviewOverdue: 0, evaluationsOverdue: 0 },
}

beforeEach(() => {
  nav.tab = null
  nav.replace.mockReset()
  access.role = 'admin'
  for (const fn of Object.values(api)) fn.mockReset()
  api.getRegistersHealth.mockResolvedValue(health)
  api.listContextIssues.mockResolvedValue({ issues: [{
    id: 'i1', discipline: 'ems', kind: 'external', description: 'New stormwater general permit next year', relevance: null,
    effect: 'risk', retired_at: null, retired_reason: null, last_reviewed_at: null, next_review_due: '2099-01-01',
  }] })
  api.listInterestedParties.mockResolvedValue({ parties: [] })
  api.listObligations.mockResolvedValue({ obligations: [{ id: 'ob-1', title: 'Stormwater discharge monitoring reports' }], nextOffset: null })
  api.getScope.mockResolvedValue({ current: null, versions: [] })
  api.getPolicy.mockResolvedValue({ current: null, versions: [], requiredCommitments: REQUIRED, complete: false, signatoryStale: false })
})

describe('/environmental/context', () => {
  it('opens on the issues and asks for the climate-change decision until it is recorded', async () => {
    render(<EnvironmentalContextPage />)
    expect(await screen.findByText('New stormwater general permit next year')).toBeInTheDocument()
    expect(screen.getByText(/Amendment 1:2024 asks every organization to decide whether climate change is a relevant issue/)).toBeInTheDocument()
    expect(screen.getByText('missing')).toBeInTheDocument()
  })

  it('gives a member the register without write controls', async () => {
    access.role = 'member'
    render(<EnvironmentalContextPage />)
    await screen.findByText('New stormwater general permit next year')
    expect(screen.queryByText('Record an issue')).not.toBeInTheDocument()
    expect(screen.queryByText('Retire')).not.toBeInTheDocument()
  })

  it('lands on scope and policy from the report card\'s ?tab=policy link', async () => {
    nav.tab = 'policy'
    render(<EnvironmentalContextPage />)
    expect(await screen.findByText('No environmental policy is on record.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Scope & policy/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('will not save a policy until every clause 5.2 commitment is ticked, and says why', async () => {
    nav.tab = 'scope'
    api.savePolicy.mockResolvedValue({ policy: {} })
    render(<EnvironmentalContextPage />)
    fireEvent.click(await screen.findByText('Record the policy'))
    const save = screen.getByText('Save version')
    expect(save).toBeDisabled()
    expect(screen.getByText(/clause 5.2 requires the policy to make every one of these commitments/)).toBeInTheDocument()

    for (const c of REQUIRED) fireEvent.click(screen.getByLabelText(c.label))
    fireEvent.change(screen.getByLabelText('Policy text'), { target: { value: 'We protect the environment.' } })
    fireEvent.change(screen.getByLabelText('Signed by'), { target: { value: 'Plant Manager' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(api.savePolicy).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      body: 'We protect the environment.', signatory_name: 'Plant Manager',
      commitments: { 'ems.protect_environment': true, 'ems.fulfil_obligations': true, 'ems.continual_improvement': true },
    })))
  })

  it('warns when the policy carries a prior owner\'s signature', async () => {
    nav.tab = 'scope'
    api.getPolicy.mockResolvedValue({
      current: { id: 'p1', version: 1, body: 'Policy', commitments: { 'ems.protect_environment': true }, signatory_name: 'Former owner',
        signatory_title: null, signed_at: '2025-01-01', next_review_due: '2026-01-01', created_at: '2025-01-01' },
      versions: [], requiredCommitments: REQUIRED, complete: false, signatoryStale: true,
    })
    render(<EnvironmentalContextPage />)
    expect(await screen.findByText(/carries a prior owner's signature/)).toBeInTheDocument()
  })

  it('links an adopted need to the obligation it became', async () => {
    nav.tab = 'parties'
    api.createInterestedParty.mockResolvedValue({ party: {} })
    render(<EnvironmentalContextPage />)
    fireEvent.click(await screen.findByText('Record a party'))
    fireEvent.change(screen.getByLabelText('Interested party'), { target: { value: 'County water district' } })
    fireEvent.change(screen.getByLabelText('Their needs and expectations'), { target: { value: 'Discharges within permit limits' } })
    fireEvent.click(screen.getByLabelText('We adopt this need as a compliance obligation'))
    fireEvent.change(screen.getByLabelText('The obligation it became (optional)'), { target: { value: 'ob-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record party' }))
    await waitFor(() => expect(api.createInterestedParty).toHaveBeenCalledWith('tenant-1', {
      name: 'County water district', needs_expectations: 'Discharges within permit limits',
      becomes_obligation: true, obligation_id: 'ob-1',
    }))
  })
})
