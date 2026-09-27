import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression cover for the CAPA owner_user_id cross-tenant leak.
//
// POST /api/incidents/[id]/actions accepts owner_user_id from the body and
// (a) stores it, (b) looks up that profile WITHOUT a tenant filter and emails
// it the incident report number + action description. owner_user_id was
// validated only as a UUID, so a member could address a CAPA to another
// tenant's user id and leak incident details across the tenant boundary.
// The fix verifies owner_user_id is a member of gate.tenantId first.

interface ChainResult { data?: unknown; error?: { message: string } | null }

const { requireTenantMemberMock, sendEmailMock, mockState } = vi.hoisted(() => {
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
          select: () => chain, eq: () => chain, in: () => chain,
          order: () => chain, limit: () => chain,
          single: result, maybeSingle: result,
          insert: (payload: Record<string, unknown>) => { this.inserts.push({ table, payload }); return chain },
          then: (f: (v: ChainResult) => unknown) => Promise.resolve(this.next(table)).then(f),
        }
        return chain
      }
      return { from: (table: string) => tableProxy(table) }
    }
  }
  return { requireTenantMemberMock: vi.fn(), sendEmailMock: vi.fn(), mockState: new MockChainState() }
})

vi.mock('@/lib/auth/tenantGate', () => ({ requireTenantMember: (req: Request) => requireTenantMemberMock(req) }))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => mockState.buildAdmin() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/email/sendActionAssignment', () => ({ sendActionAssignmentEmail: (a: unknown) => sendEmailMock(a) }))
vi.mock('@/lib/email/sendInvite', () => ({ computeLoginUrl: () => 'http://app.local' }))

const INCIDENT_ID = '11111111-1111-1111-1111-111111111111'
const TENANT = '22222222-2222-2222-2222-222222222222'
const OUTSIDER = '33333333-3333-3333-3333-333333333333'
const MEMBER = '44444444-4444-4444-4444-444444444444'

function ctx() { return { params: Promise.resolve({ id: INCIDENT_ID }) } }
function post(body: unknown): Request {
  return new Request(`http://x/api/incidents/${INCIDENT_ID}/actions`, {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState.reset()
  requireTenantMemberMock.mockResolvedValue({ ok: true, tenantId: TENANT, userId: 'creator', role: 'member' })
})

describe('POST /api/incidents/[id]/actions — owner_user_id tenant scoping', () => {
  it('rejects an owner_user_id that is not a member of the tenant — no insert, no email', async () => {
    mockState.queue('incidents', { data: { id: INCIDENT_ID, tenant_id: TENANT, report_number: 'INC-1' } })
    mockState.queue('tenant_memberships', { data: null }) // outsider: not a member
    const { POST } = await import('@/app/api/incidents/[id]/actions/route')
    const res = await POST(post({ action_type: 'corrective', description: 'Fix the guard', owner_user_id: OUTSIDER }), ctx())
    expect(res.status).toBe(400)
    expect(mockState.inserts.find(i => i.table === 'incident_actions')).toBeUndefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('allows an owner_user_id that IS a member of the tenant', async () => {
    mockState.queue('incidents', { data: { id: INCIDENT_ID, tenant_id: TENANT, report_number: 'INC-1' } })
    mockState.queue('tenant_memberships', { data: { user_id: MEMBER } })
    mockState.queue('incident_actions', { data: { id: 'act-1' } })
    mockState.queue('profiles', { data: { email: 'm@example.com', full_name: 'M' } })
    mockState.queue('tenants', { data: { name: 'Acme' } })
    const { POST } = await import('@/app/api/incidents/[id]/actions/route')
    const res = await POST(post({ action_type: 'corrective', description: 'Fix the guard', owner_user_id: MEMBER }), ctx())
    expect(res.status).toBe(201)
    expect(mockState.inserts.find(i => i.table === 'incident_actions')).toBeDefined()
  })

  it('still allows a CAPA with no owner assigned', async () => {
    mockState.queue('incidents', { data: { id: INCIDENT_ID, tenant_id: TENANT, report_number: 'INC-1' } })
    mockState.queue('incident_actions', { data: { id: 'act-2' } })
    const { POST } = await import('@/app/api/incidents/[id]/actions/route')
    const res = await POST(post({ action_type: 'corrective', description: 'Fix the guard' }), ctx())
    expect(res.status).toBe(201)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})
