import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AspectRow, RegistersHealth } from '@/lib/environmental/client'

// The aspects register page (clause 6.1.2). What matters: members see the
// register but no write controls; an aspect cannot be recorded without a
// facility; filters reach the server; scoring sends exactly what the API
// expects and shows the API's field errors where they belong.

const access = vi.hoisted(() => ({ role: 'admin' as string, facilityId: 'fac-1' as string | null }))
const api = vi.hoisted(() => ({
  listAspects:        vi.fn(),
  getRegistersHealth: vi.fn(),
  getAspect:          vi.fn(),
  listObligations:    vi.fn(),
  scoreAspect:        vi.fn(),
}))

vi.mock('@/components/TenantProvider', () => ({ useTenant: () => ({ tenantId: 'tenant-1', role: access.role }) }))
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ profile: { is_superadmin: false }, loading: false }) }))
vi.mock('@/components/FacilityProvider', () => ({ useFacility: () => ({ facilityId: access.facilityId }) }))
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import EnvironmentalAspectsPage from '@/app/environmental/aspects/page'
import { EmsApiError } from '@/lib/environmental/client'

function aspect(over: Partial<AspectRow> = {}): AspectRow {
  return {
    id: 'a1', facility_id: 'fac-1', activity: 'Parts degreasing', aspect: 'Solvent vapour release',
    impact: 'Air pollution (VOC)', process_area: 'Finishing', life_cycle_stage: 'operation', flow: 'output',
    status: 'identified', controls: null, notes: null, source_reference: null, obsolete_at: null, obsolete_reason: null,
    last_reviewed_at: null, next_review_due: '2099-01-01', significant: true, max_score: 12,
    current_scores: [{ operating_condition: 'normal', severity: 4, likelihood: 3, score: 12, significant: true, method_id: 'm1', scored_at: '2026-09-01' }],
    ...over,
  }
}

const health: RegistersHealth = {
  asOf: '2026-10-02',
  context: { health: 'red', active: 0, reviewOverdue: 0, climateRecorded: false },
  scopeAndPolicy: { health: 'red', scopeVersion: null, policyVersion: null, policyComplete: false, signatoryStale: false },
  aspects: { health: 'amber', active: 2, reviewOverdue: 0, unscored: 1 },
  obligations: { health: 'red', active: 0, reviewOverdue: 0, evaluationsOverdue: 0 },
}

beforeEach(() => {
  access.role = 'admin'
  access.facilityId = 'fac-1'
  for (const fn of Object.values(api)) fn.mockReset()
  api.listAspects.mockResolvedValue({ aspects: [aspect(), aspect({ id: 'a2', activity: 'Boiler firing', process_area: 'Utilities', significant: false, max_score: null, current_scores: [] })], nextOffset: null })
  api.getRegistersHealth.mockResolvedValue(health)
  api.getAspect.mockResolvedValue({ aspect: aspect(), history: [], obligationIds: [] })
  api.listObligations.mockResolvedValue({ obligations: [], nextOffset: null })
})

describe('/environmental/aspects', () => {
  it('shows each aspect with its condition coverage and the register\'s health', async () => {
    render(<EnvironmentalAspectsPage />)
    expect(await screen.findByText('Parts degreasing')).toBeInTheDocument()
    expect(screen.getByText('Normal: score 12, significant')).toBeInTheDocument()
    expect(screen.getAllByText('Emergency: not scored')).toHaveLength(2)
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByText('not scored').textContent).toBe('1 not scored')
  })

  it('shows a member the register without any write controls', async () => {
    access.role = 'member'
    render(<EnvironmentalAspectsPage />)
    await screen.findByText('Parts degreasing')
    expect(screen.queryByText('Record aspect')).not.toBeInTheDocument()
    expect(screen.queryByText('Import CSV')).not.toBeInTheDocument()
  })

  it('will not let an admin record an aspect without choosing a facility', async () => {
    access.facilityId = null
    render(<EnvironmentalAspectsPage />)
    await screen.findByText('Parts degreasing')
    expect(screen.getByText('Record aspect')).toBeDisabled()
    expect(screen.getByText(/Choose a facility/)).toBeInTheDocument()
  })

  it('asks the server for significant aspects when that filter is chosen', async () => {
    render(<EnvironmentalAspectsPage />)
    await screen.findByText('Parts degreasing')
    fireEvent.change(screen.getByLabelText('Significance'), { target: { value: 'yes' } })
    await waitFor(() => expect(api.listAspects).toHaveBeenLastCalledWith('tenant-1', expect.objectContaining({ significant: true, status: 'active' })))
  })

  it('scores a condition from the aspect\'s sheet, previewing the score first', async () => {
    api.scoreAspect.mockResolvedValue({ score: {} })
    render(<EnvironmentalAspectsPage />)
    fireEvent.click(await screen.findByText('Parts degreasing'))
    const sheet = await screen.findByText('Add score').then(button => button.closest('form') as HTMLElement)

    fireEvent.change(within(sheet).getByLabelText('Condition'), { target: { value: 'emergency' } })
    fireEvent.change(within(sheet).getByLabelText('Severity'), { target: { value: '4' } })
    fireEvent.change(within(sheet).getByLabelText('Likelihood'), { target: { value: '3' } })
    expect(within(sheet).getByText(/Score 12, significant under the default rule/)).toBeInTheDocument()
    fireEvent.change(within(sheet).getByLabelText('Why this score'), { target: { value: 'Bund failure reaches the drain' } })
    fireEvent.click(within(sheet).getByText('Add score'))

    await waitFor(() => expect(api.scoreAspect).toHaveBeenCalledWith('tenant-1', 'a1', {
      operating_condition: 'emergency', severity: 4, likelihood: 3, rationale: 'Bund failure reaches the drain',
    }))
  })

  it('puts the API\'s field error under the field it names', async () => {
    api.scoreAspect.mockRejectedValue(new EmsApiError('rationale is required', 400, [{ field: 'rationale', message: 'is required: say why this score' }]))
    render(<EnvironmentalAspectsPage />)
    fireEvent.click(await screen.findByText('Parts degreasing'))
    fireEvent.click(await screen.findByText('Add score'))
    expect(await screen.findByText('is required: say why this score')).toBeInTheDocument()
  })
})
