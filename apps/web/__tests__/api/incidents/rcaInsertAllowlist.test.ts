import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression cover for the RCA/ECFA insert allowlists.
//
// Both POST handlers used to spread the caller's node into the insert and
// scope tenant_id/investigation_id afterwards. That stopped a caller
// overriding those two columns and nothing else, so id and created_at were
// caller-settable — enough to choose an investigation node's identity and
// backdate it. RCA could also be made to write a column belonging to a
// different method's table.

interface ChainResult { data?: unknown; error?: { message: string } | null }

const { requireTenantMemberMock, mockState } = vi.hoisted(() => {
  class MockChainState {
    queues = new Map<string, ChainResult[]>()
    inserts: Array<{ table: string; payload: Record<string, unknown> }> = []

    reset() { this.queues.clear(); this.inserts = [] }

    queue(table: string, ...results: ChainResult[]) {
      if (!this.queues.has(table)) this.queues.set(table, [])
      this.queues.get(table)!.push(...results)
    }

    next(table: string): ChainResult {
      return this.queues.get(table)?.shift() ?? { data: null, error: null }
    }

    buildAdmin() {
      const tableProxy = (table: string) => {
        const result = () => Promise.resolve(this.next(table))
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          single: result,
          maybeSingle: result,
          insert: (payload: Record<string, unknown>) => {
            this.inserts.push({ table, payload })
            return chain
          },
          then: (f: (v: ChainResult) => unknown) => Promise.resolve(this.next(table)).then(f),
        }
        return chain
      }
      return { from: (table: string) => tableProxy(table) }
    }
  }
  return { requireTenantMemberMock: vi.fn(), mockState: new MockChainState() }
})

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: (req: Request) => requireTenantMemberMock(req),
  requireTenantAdmin:  (req: Request) => requireTenantMemberMock(req),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => mockState.buildAdmin() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

const INCIDENT_ID = '11111111-1111-1111-1111-111111111111'
const INVESTIGATION_ID = '22222222-2222-2222-2222-222222222222'
const FORGED_ID = '33333333-3333-3333-3333-333333333333'

function ctx() {
  return { params: Promise.resolve({ id: INCIDENT_ID }) }
}

function post(path: string, body: unknown) {
  return new Request(`http://x/api/incidents/${INCIDENT_ID}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('RCA + ECFA inserts only accept caller-settable columns', () => {
  beforeEach(() => {
    mockState.reset()
    requireTenantMemberMock.mockReset()
    requireTenantMemberMock.mockResolvedValue({
      ok: true, userId: 'user-1', tenantId: 'tenant-1', userEmail: 'u@x.test',
      role: 'admin', authedClient: {} as never,
    })
    // Both routes resolve the investigation before inserting.
    mockState.queue('incident_investigations', {
      data: { id: INVESTIGATION_ID, lead_investigator: 'user-1', team_member_ids: [] },
      error: null,
    })
  })

  it('drops a caller-supplied id and created_at on an RCA node', async () => {
    mockState.queue('incident_rca_5whys', { data: { id: 'server-generated' }, error: null })

    const { POST } = await import('@/app/api/incidents/[id]/rca/route')
    const res = await POST(post('rca', {
      method: '5_whys',
      node: {
        ordinal: 1,
        answer: 'the guard was removed',
        id: FORGED_ID,
        created_at: '1999-01-01T00:00:00.000Z',
      },
    }), ctx())

    expect(res.status).toBe(201)
    const insert = mockState.inserts.find(i => i.table === 'incident_rca_5whys')
    expect(insert).toBeDefined()
    expect(insert!.payload.answer).toBe('the guard was removed')
    expect(insert!.payload.id).toBeUndefined()
    expect(insert!.payload.created_at).toBeUndefined()
    expect(insert!.payload.tenant_id).toBe('tenant-1')
    expect(insert!.payload.investigation_id).toBe(INVESTIGATION_ID)
  })

  it('will not let one RCA method write another method table\'s column', async () => {
    mockState.queue('incident_rca_fishbone', { data: { id: 'x' }, error: null })

    const { POST } = await import('@/app/api/incidents/[id]/rca/route')
    await POST(post('rca', {
      method: 'fishbone',
      node: { category: 'people', cause: 'no briefing', answer: 'belongs to 5 whys' },
    }), ctx())

    const insert = mockState.inserts.find(i => i.table === 'incident_rca_fishbone')
    expect(insert!.payload.cause).toBe('no briefing')
    expect(insert!.payload.answer).toBeUndefined()
  })

  it('drops a caller-supplied id and created_at on an ECFA node', async () => {
    mockState.queue('incident_ecfa_nodes', { data: { id: 'server-generated' }, error: null })

    const { POST } = await import('@/app/api/incidents/[id]/ecfa/route')
    const res = await POST(post('ecfa', {
      node: {
        node_type: 'event',
        title: 'operator opened the door',
        id: FORGED_ID,
        created_at: '1999-01-01T00:00:00.000Z',
      },
    }), ctx())

    expect(res.status).toBe(201)
    const insert = mockState.inserts.find(i => i.table === 'incident_ecfa_nodes')
    expect(insert!.payload.title).toBe('operator opened the door')
    expect(insert!.payload.id).toBeUndefined()
    expect(insert!.payload.created_at).toBeUndefined()
    expect(insert!.payload.created_by).toBe('user-1')
  })

  it('still carries the AI provenance flags the accept flow sets', async () => {
    mockState.queue('incident_ecfa_nodes', { data: { id: 'x' }, error: null })

    const { POST } = await import('@/app/api/incidents/[id]/ecfa/route')
    await POST(post('ecfa', {
      node: { node_type: 'event', title: 'drafted by the assistant', ai_origin: true },
    }), ctx())

    const insert = mockState.inserts.find(i => i.table === 'incident_ecfa_nodes')
    expect(insert!.payload.ai_origin).toBe(true)
  })
})
