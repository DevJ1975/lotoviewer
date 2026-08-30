import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression cover for the triage severity tallies.
//
// The tiles used to be counted from whatever rows the page held, and the
// list is capped at 200. Any tenant past the cap saw under-reported
// Catastrophic/Fatality/Lost-time counts with nothing saying so. The counts
// now come from the server across the whole matching set.

interface ChainResult { data?: unknown; error?: { message: string } | null; count?: number }

const { requireTenantMemberMock, mockState } = vi.hoisted(() => {
  class MockChainState {
    results: ChainResult[] = []
    // Every filter each query applied, in build order.
    filters: Array<Record<string, unknown>> = []

    reset() { this.results = []; this.filters = [] }
    queue(...r: ChainResult[]) { this.results.push(...r) }

    buildClient() {
      const tableProxy = () => {
        const applied: Record<string, unknown> = {}
        this.filters.push(applied)
        const settle = () => Promise.resolve(this.results.shift() ?? { data: [], error: null, count: 0 })
        const chain: Record<string, unknown> = {
          select: (_cols: string, opts?: { head?: boolean }) => {
            applied.head = opts?.head ?? false
            return chain
          },
          eq: (col: string, val: unknown) => { applied[`eq:${col}`] = val; return chain },
          in: (col: string, val: unknown) => { applied[`in:${col}`] = val; return chain },
          or: () => chain,
          order: () => chain,
          range: () => chain,
          then: (f: (v: ChainResult) => unknown) => settle().then(f),
        }
        return chain
      }
      return { from: tableProxy }
    }
  }
  return { requireTenantMemberMock: vi.fn(), mockState: new MockChainState() }
})

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: (req: Request) => requireTenantMemberMock(req),
  requireTenantAdmin:  (req: Request) => requireTenantMemberMock(req),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

// Canonical order from packages/core/src/incident.ts — the route tallies in this order.
const SEVERITIES = ['none', 'first_aid', 'medical', 'lost_time', 'fatality', 'catastrophic']

describe('GET /api/incidents — severity tallies span the whole set, not the page', () => {
  beforeEach(() => {
    mockState.reset()
    requireTenantMemberMock.mockReset()
    requireTenantMemberMock.mockResolvedValue({
      ok: true, userId: 'u1', tenantId: 'tenant-1', userEmail: 'u@x.test',
      role: 'member', authedClient: mockState.buildClient(),
    })
  })

  it('reports counts larger than the page it returns', async () => {
    // One page of 2 rows out of 640 matching, then one count per severity.
    mockState.queue({ data: [{ id: 'a' }, { id: 'b' }], error: null, count: 640 })
    // Queued in SEVERITIES order: none, first_aid, medical, lost_time, fatality, catastrophic.
    for (const n of [494, 90, 40, 12, 1, 3]) mockState.queue({ data: null, error: null, count: n })

    const { GET } = await import('@/app/api/incidents/route')
    const res = await GET(new Request('http://x/api/incidents?limit=200'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.reports).toHaveLength(2)
    expect(body.total).toBe(640)
    // The severe tiles are not bounded by the two rows on the page.
    expect(body.active_severity_counts).toEqual({
      catastrophic: 3, fatality: 1, lost_time: 12, medical: 40, first_aid: 90, none: 494,
    })
  })

  it('counts each severity against the active statuses only', async () => {
    mockState.queue({ data: [], error: null, count: 0 })
    for (const _ of SEVERITIES) mockState.queue({ data: null, error: null, count: 0 })

    const { GET } = await import('@/app/api/incidents/route')
    await GET(new Request('http://x/api/incidents'))

    // First query is the page; the rest are the per-severity tallies.
    const tallies = mockState.filters.slice(1)
    expect(tallies).toHaveLength(SEVERITIES.length)
    expect(tallies.map(f => f['eq:severity_actual'])).toEqual(SEVERITIES)

    for (const f of tallies) {
      expect(f.head).toBe(true)                          // count-only, returns no rows
      expect(f['eq:tenant_id']).toBe('tenant-1')
      expect(f['in:status']).not.toContain('closed')     // open incidents only
    }
  })

  it('surfaces a failed tally instead of reporting it as zero', async () => {
    mockState.queue({ data: [], error: null, count: 0 })
    mockState.queue({ data: null, error: { message: 'statement timeout' }, count: 0 })
    for (let i = 1; i < SEVERITIES.length; i++) mockState.queue({ data: null, error: null, count: 0 })

    const { GET } = await import('@/app/api/incidents/route')
    const res = await GET(new Request('http://x/api/incidents'))

    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/statement timeout/)
  })
})
