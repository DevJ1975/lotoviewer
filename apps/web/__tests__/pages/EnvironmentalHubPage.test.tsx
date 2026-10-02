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

const QUIET_PERMITS: RegistersHealth['permits'] = {
  health: 'green', active: 5, deadlineMissed: 0, holderMismatch: 0, renewalSoon: 0, conditionsOverdue: 0, reviewOverdue: 0,
}

const health = (
  responsibilities: RegistersHealth['responsibilities'],
  permits: RegistersHealth['permits'] = QUIET_PERMITS,
): RegistersHealth => ({
  asOf: '2026-10-02',
  context: { health: 'green', active: 5, reviewOverdue: 0, climateRecorded: true },
  scopeAndPolicy: {
    health: 'green', scopeVersion: 1, policyVersion: 1, policyComplete: true, signatoryStale: false,
    scopeStatesControlAndInfluence: true, policyCommunicatedInternally: true,
  },
  aspects: { health: 'green', active: 25, reviewOverdue: 0, unscored: 0 },
  obligations: { health: 'amber', active: 15, reviewOverdue: 1, evaluationsOverdue: 1, unscheduled: 0, deadlinesMissed: 0 },
  responsibilities,
  permits,
})

const ALL_HELD = { health: 'green', rolesUnassigned: 0, processesUnassigned: 0 } as const
const cardFor = async (title: string) => within((await screen.findByText(title)).closest('a') as HTMLElement)
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

  it('shows the permits card with its light and what is wrong, worst first', async () => {
    api.getRegistersHealth.mockResolvedValue(health(ALL_HELD, {
      ...QUIET_PERMITS, health: 'red', active: 6, deadlineMissed: 1, holderMismatch: 2, renewalSoon: 1,
    }))
    render(<EnvironmentalHomePage />)
    const card = await cardFor('Permits')
    expect(card.getByText('Missing')).toBeInTheDocument()
    expect(card.getByText('6 in force · 1 renewal deadlines missed · 2 holder mismatch · 1 renewals due within 90 days')).toBeInTheDocument()
    expect(card.getByText('Clause 6.1.3')).toBeInTheDocument()
  })

  it('shows a quiet permits card as just the count, and links to the vault', async () => {
    api.getRegistersHealth.mockResolvedValue(health(ALL_HELD))
    render(<EnvironmentalHomePage />)
    const card = await cardFor('Permits')
    expect(card.getByText('Current')).toBeInTheDocument()
    expect(card.getByText('5 in force')).toBeInTheDocument()
    expect((await screen.findByText('Permits')).closest('a')).toHaveAttribute('href', '/environmental/permits')
  })

  it('shows the open changes on the management of change card', async () => {
    api.getRegistersHealth.mockResolvedValue(health(ALL_HELD))
    render(<EnvironmentalHomePage />)
    const card = await cardFor('Management of change')
    expect(card.getByText('3 open')).toBeInTheDocument()
    expect(card.getByText('Clauses 6.1.4 & 8.1')).toBeInTheDocument()
  })
})
