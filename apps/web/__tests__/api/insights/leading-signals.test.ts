import { describe, it, expect, beforeEach, vi } from 'vitest'
// The AI harness mocks the tenant gate (member + admin) + Sentry — all the
// pre-DB guard path of this route touches.
import { gateOk, gateRejects, requireTenantMemberMock } from '../ai/_helpers'

// Every query resolves empty; the tables asked for are recorded.
const queriedTables: string[] = []
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      queriedTables.push(table)
      const chain: Record<string, unknown> = {}
      for (const step of ['select', 'eq', 'gte', 'in']) chain[step] = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
      return chain
    },
  }),
}))

async function importRoute() {
  return import('@/app/api/insights/leading-signals/route')
}

describe('leading-signals route — guards', () => {
  beforeEach(() => {
    requireTenantMemberMock.mockReset()
    gateOk()
  })

  it('rejects an unauthorized (non-admin) caller with the gate status', async () => {
    gateRejects(403, 'Admins only')
    const { GET } = await importRoute()
    const res = await GET(new Request('http://t/api/insights/leading-signals') as never)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/Admins only/)
  })
})

describe('leading-signals route — indicators', () => {
  beforeEach(() => {
    requireTenantMemberMock.mockReset()
    gateOk()
    queriedTables.length = 0
  })

  it('never treats CAPAs opened as a leading indicator', async () => {
    // Corrective actions are opened because of incidents, so that series is a
    // consequence of the outcome, not a precursor (scorecard review §9).
    const { GET } = await importRoute()
    const res = await GET(new Request('http://t/api/insights/leading-signals') as never)
    expect(res.status).toBe(200)
    expect(queriedTables).not.toContain('incident_actions')
    const body = await res.json()
    expect(body.signals.map((s: { key: string }) => s.key)).not.toContain('capa_opened')
  })
})
