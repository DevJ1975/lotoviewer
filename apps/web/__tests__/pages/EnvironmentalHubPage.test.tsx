import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { RegistersHealth } from '@/lib/environmental/client'

// /environmental, the hub. Each register card carries its light and the
// counts behind it; the process map's card says what keeps it from green.

const api = vi.hoisted(() => ({ getRegistersHealth: vi.fn() }))

vi.mock('@/components/TenantProvider', () => ({ useTenant: () => ({ tenantId: 'tenant-1' }) }))
vi.mock('@/lib/supabase', () => {
  const head = { eq: () => head, is: () => head, in: () => head, then: (done: (r: unknown) => void) => done({ count: 3, error: null }) }
  return { supabase: { from: () => ({ select: () => head }) } }
})
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import EnvironmentalHomePage from '@/app/environmental/page'

const health = (responsibilities: RegistersHealth['responsibilities']): RegistersHealth => ({
  asOf: '2026-10-02',
  context: { health: 'green', active: 5, reviewOverdue: 0, climateRecorded: true },
  scopeAndPolicy: {
    health: 'green', scopeVersion: 1, policyVersion: 1, policyComplete: true, signatoryStale: false,
    scopeStatesControlAndInfluence: true, policyCommunicatedInternally: true,
  },
  aspects: { health: 'green', active: 25, reviewOverdue: 0, unscored: 0 },
  obligations: { health: 'amber', active: 15, reviewOverdue: 1, evaluationsOverdue: 1, unscheduled: 0, deadlinesMissed: 0 },
  responsibilities,
})

const processesCard = async () => within((await screen.findByText('Processes & responsibilities')).closest('a') as HTMLElement)

beforeEach(() => api.getRegistersHealth.mockReset())

describe('/environmental hub', () => {
  it('shows the process map red, and why, until the clause 5.3 roles are assigned', async () => {
    api.getRegistersHealth.mockResolvedValue(health({ health: 'red', rolesUnassigned: 2, processesUnassigned: 15 }))
    render(<EnvironmentalHomePage />)
    const card = await processesCard()
    expect(card.getByText('Missing')).toBeInTheDocument()
    expect(card.getByText('2 of 2 roles unassigned · 15 processes without an owner')).toBeInTheDocument()
    expect(card.getByText('Clauses 4.4 & 5.3')).toBeInTheDocument()
  })

  it('turns it green once every role and process is held', async () => {
    api.getRegistersHealth.mockResolvedValue(health({ health: 'green', rolesUnassigned: 0, processesUnassigned: 0 }))
    render(<EnvironmentalHomePage />)
    const card = await processesCard()
    expect(card.getByText('Current')).toBeInTheDocument()
    expect(card.getByText('roles assigned · 0 processes without an owner')).toBeInTheDocument()
  })
})
