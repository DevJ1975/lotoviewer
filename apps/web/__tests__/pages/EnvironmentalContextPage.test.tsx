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
  saveScope:             vi.fn(),
  recordPolicyCommunication: vi.fn(),
}))
const pdf = vi.hoisted(() => ({ generatePolicyScopeStatement: vi.fn() }))

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
vi.mock('@/lib/pdfEmsPolicyScope', () => pdf)

import EnvironmentalContextPage from '@/app/environmental/context/page'

const REQUIRED = [
  { key: 'ems.protect_environment', label: 'Protect the environment, including preventing pollution' },
  { key: 'ems.fulfil_obligations', label: 'Fulfil our compliance obligations' },
  { key: 'ems.continual_improvement', label: 'Continually improve the environmental management system' },
]

const health: RegistersHealth = {
  asOf: '2026-10-02',
  context: { health: 'amber', active: 1, reviewOverdue: 0, climateRecorded: false },
  scopeAndPolicy: { health: 'red', scopeVersion: null, policyVersion: null, policyComplete: false, signatoryStale: false, scopeStatesControlAndInfluence: true, policyCommunicatedInternally: true },
  aspects: { health: 'red', active: 0, reviewOverdue: 0, unscored: 0 },
  obligations: { health: 'red', active: 0, reviewOverdue: 0, evaluationsOverdue: 0, unscheduled: 0, deadlinesMissed: 0 },
  responsibilities: { health: 'red', rolesUnassigned: 2, processesUnassigned: 14 },
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
  api.getPolicy.mockResolvedValue({
    current: null, versions: [], requiredCommitments: REQUIRED, complete: false, signatoryStale: false,
    communications: [], communicatedInternally: false,
  })
  pdf.generatePolicyScopeStatement.mockReset()
})

const SCOPE = {
  id: 's1', version: 1, legal_entity: 'Northfield Forge & Finish LLC', physical_boundary: 'Inside the fence line',
  activities: 'Forging', products_services: 'Forged parts', control_and_influence: 'On-site operations; suppliers by influence',
  exclusions: null, effective_from: '2026-01-01', next_review_due: '2027-01-01', created_at: '2026-01-01',
}
const POLICY = {
  id: 'p1', version: 2, body: 'We protect the environment.', commitments: { 'ems.protect_environment': true, 'ems.fulfil_obligations': true, 'ems.continual_improvement': true },
  signatory_name: 'Plant Manager', signatory_title: null, signed_at: '2026-02-01', next_review_due: '2027-02-01', created_at: '2026-02-01',
}
const policyState = (over: Record<string, unknown> = {}) => ({
  current: POLICY, versions: [POLICY], requiredCommitments: REQUIRED, complete: true, signatoryStale: false,
  communications: [], communicatedInternally: false, ...over,
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
      communications: [], communicatedInternally: false,
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

  it('asks what the organization controls and influences, and sends no exclusions as null', async () => {
    nav.tab = 'scope'
    api.saveScope.mockResolvedValue({ scope: {} })
    render(<EnvironmentalContextPage />)
    fireEvent.click(await screen.findByText('Document the scope'))
    fireEvent.change(screen.getByLabelText('Legal entity'), { target: { value: 'Northfield Forge & Finish LLC' } })
    fireEvent.change(screen.getByLabelText('What we control, and what we can only influence'),
      { target: { value: 'On-site operations; suppliers by influence' } })
    fireEvent.click(screen.getByText('Save version'))
    await waitFor(() => expect(api.saveScope).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      legal_entity: 'Northfield Forge & Finish LLC', control_and_influence: 'On-site operations; suppliers by influence', exclusions: null,
    })))
  })

  it('flags a scope version that does not say what the organization controls and influences (4.3 e)', async () => {
    nav.tab = 'scope'
    api.getScope.mockResolvedValue({ current: { ...SCOPE, control_and_influence: null }, versions: [] })
    render(<EnvironmentalContextPage />)
    expect(await screen.findByText(/does not say what the organization can control and what it can only influence/)).toBeInTheDocument()
  })

  it('records how the policy was communicated, and says so until it reaches the organization', async () => {
    nav.tab = 'scope'
    api.getPolicy.mockResolvedValue(policyState())
    api.recordPolicyCommunication.mockResolvedValue({ communication: {} })
    render(<EnvironmentalContextPage />)
    expect(await screen.findByText(/Version 2 has no record of being communicated within the organization/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Record a communication'))
    fireEvent.change(screen.getByLabelText('How, and to whom'), { target: { value: 'Posted at both entrances' } })
    fireEvent.change(screen.getByLabelText('On'), { target: { value: '2026-09-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(api.recordPolicyCommunication).toHaveBeenCalledWith('tenant-1', {
      policy_id: 'p1', audience: 'internal', method: 'Posted at both entrances', communicated_on: '2026-09-20',
    }))
  })

  it('lists the communications, and gives a member no way to add one', async () => {
    nav.tab = 'scope'
    access.role = 'member'
    api.getPolicy.mockResolvedValue(policyState({
      communicatedInternally: true,
      communications: [{ id: 'c1', policy_id: 'p1', audience: 'external', method: 'Company website', communicated_on: '2026-09-01', recorded_by: null, created_at: '' }],
    }))
    render(<EnvironmentalContextPage />)
    expect(await screen.findByText('Company website')).toBeInTheDocument()
    expect(screen.getByText(/To interested parties outside it/)).toBeInTheDocument()
    expect(screen.queryByText(/has no record of being communicated/)).not.toBeInTheDocument()
    expect(screen.queryByText('Record a communication')).not.toBeInTheDocument()
  })

  it('keeps the download for interested parties disabled until both a scope and a policy are on record', async () => {
    nav.tab = 'scope'
    api.getScope.mockResolvedValue({ current: SCOPE, versions: [SCOPE] })
    render(<EnvironmentalContextPage />)
    const download = await screen.findByRole('button', { name: /Download for interested parties/ })
    expect(download).toBeDisabled()
    expect(screen.getByText('Available once both a scope and a policy are on record.')).toBeInTheDocument()
  })

  it('hands the scope, the policy and its commitments to the PDF', async () => {
    nav.tab = 'scope'
    URL.createObjectURL = vi.fn(() => 'blob:statement')
    URL.revokeObjectURL = vi.fn()
    api.getScope.mockResolvedValue({ current: SCOPE, versions: [SCOPE] })
    api.getPolicy.mockResolvedValue(policyState())
    pdf.generatePolicyScopeStatement.mockResolvedValue(new Uint8Array([37, 80, 68, 70]))
    render(<EnvironmentalContextPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Download for interested parties/ }))
    await waitFor(() => expect(pdf.generatePolicyScopeStatement).toHaveBeenCalledWith(expect.objectContaining({
      scope: SCOPE, policy: POLICY, commitments: REQUIRED,
    })))
    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})
