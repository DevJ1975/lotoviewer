import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AspectRow, ObligationRow, RegistersHealth } from '@/lib/environmental/client'

// The register lists page through the server 200 rows at a time. Requests
// overlap when a user changes a filter or clicks "Load more", and responses
// can land in any order; the list must show exactly one filter's rows, each
// row once.

const api = vi.hoisted(() => ({
  listAspects:        vi.fn(),
  listObligations:    vi.fn(),
  getRegistersHealth: vi.fn(),
}))

vi.mock('@/components/TenantProvider', () => ({ useTenant: () => ({ tenantId: 'tenant-1', role: 'admin' }) }))
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ profile: { is_superadmin: false }, userId: 'u1', loading: false }) }))
vi.mock('@/components/FacilityProvider', () => ({ useFacility: () => ({ facilityId: 'fac-1' }) }))
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import EnvironmentalAspectsPage from '@/app/environmental/aspects/page'
import ComplianceObligationsPage from '@/app/environmental/obligations/page'

const health: RegistersHealth = {
  asOf: '2026-10-02',
  context: { health: 'green', active: 1, reviewOverdue: 0, climateRecorded: true },
  scopeAndPolicy: { health: 'green', scopeVersion: 1, policyVersion: 1, policyComplete: true, signatoryStale: false },
  aspects: { health: 'green', active: 1, reviewOverdue: 0, unscored: 0 },
  obligations: { health: 'green', active: 1, reviewOverdue: 0, evaluationsOverdue: 0 },
}

function aspect(id: string): AspectRow {
  return {
    id, facility_id: 'fac-1', activity: `Activity ${id}`, aspect: 'Aspect', impact: 'Impact', process_area: 'Finishing',
    life_cycle_stage: 'operation', flow: null, status: 'identified', controls: null, notes: null, source_reference: null,
    obsolete_at: null, obsolete_reason: null, last_reviewed_at: null, next_review_due: '2099-01-01',
    significant: false, max_score: null, current_scores: [],
  }
}

function obligation(id: string): ObligationRow {
  return {
    id, facility_id: null, discipline: 'ems', title: `Obligation ${id}`, description: null, regulatory_ref: null,
    cadence: 'annual', next_due_at: '2027-01-01', status: 'open', source: 'tenant', source_kind: 'law',
    jurisdiction: 'federal', applicability_rationale: null, evaluation_cadence_days: 365, last_reviewed_at: null,
    next_review_due: '2099-01-01', last_evaluation_id: null, last_evaluated_at: null, last_result: null,
    last_nonconformity_id: null, open_evaluation_id: null, open_evaluation_due: null, open_evaluation_assignee: null,
  }
}

/** A promise the test resolves when it chooses, to make responses land out of order. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.getRegistersHealth.mockResolvedValue(health)
})

describe('/environmental/obligations "Load more"', () => {
  it('fetches the next page once, however fast the user clicks', async () => {
    const nextPage = deferred<{ obligations: ObligationRow[]; nextOffset: null }>()
    api.listObligations.mockImplementation(async (_tenant: string, filters: { offset?: number }) =>
      filters.offset ? nextPage.promise : { obligations: [obligation('first')], nextOffset: 200 })
    render(<ComplianceObligationsPage />)
    await screen.findByText('Obligation first')

    const more = screen.getByRole('button', { name: 'Load more' })
    fireEvent.click(more)
    fireEvent.click(more)
    await act(async () => nextPage.resolve({ obligations: [obligation('second')], nextOffset: null }))

    expect(await screen.findAllByText('Obligation second')).toHaveLength(1)
    expect(api.listObligations.mock.calls.filter(([, filters]) => filters.offset === 200)).toHaveLength(1)
  })
})

describe('/environmental/aspects filters', () => {
  it('shows the filter chosen last, even when the earlier filter\'s answer lands last', async () => {
    const significantOnly = deferred<{ aspects: AspectRow[]; nextOffset: null }>()
    api.listAspects.mockImplementation(async (_tenant: string, filters: { significant?: boolean }) =>
      filters.significant === true ? significantOnly.promise : { aspects: [aspect('every')], nextOffset: null })
    render(<EnvironmentalAspectsPage />)
    await screen.findByText('Activity every')

    fireEvent.change(screen.getByLabelText('Significance'), { target: { value: 'yes' } })
    fireEvent.change(screen.getByLabelText('Significance'), { target: { value: 'all' } })
    await waitFor(() => expect(api.listAspects).toHaveBeenCalledTimes(3))
    await act(async () => significantOnly.resolve({ aspects: [aspect('significant')], nextOffset: null }))

    expect(screen.getByText('Activity every')).toBeInTheDocument()
    expect(screen.queryByText('Activity significant')).not.toBeInTheDocument()
  })

  it('offers no "Load more" for the old filter while the new one loads', async () => {
    const significantOnly = deferred<{ aspects: AspectRow[]; nextOffset: null }>()
    api.listAspects.mockImplementation(async (_tenant: string, filters: { significant?: boolean }) =>
      filters.significant === true ? significantOnly.promise : { aspects: [aspect('every')], nextOffset: 200 })
    render(<EnvironmentalAspectsPage />)
    await screen.findByRole('button', { name: 'Load more' })

    fireEvent.change(screen.getByLabelText('Significance'), { target: { value: 'yes' } })
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    await act(async () => significantOnly.resolve({ aspects: [aspect('significant')], nextOffset: null }))
    expect(await screen.findByText('Activity significant')).toBeInTheDocument()
  })

  it('still shows the register when the health strip cannot load', async () => {
    api.getRegistersHealth.mockRejectedValue(new Error('health is down'))
    api.listAspects.mockResolvedValue({ aspects: [aspect('every')], nextOffset: null })
    render(<EnvironmentalAspectsPage />)
    expect(await screen.findByText('Activity every')).toBeInTheDocument()
  })
})
