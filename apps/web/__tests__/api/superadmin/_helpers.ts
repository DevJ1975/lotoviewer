// Shared harness for the /api/superadmin/* route tests.
//
// Each test file:
//   1. import this BEFORE the route file
//   2. Calls one of the helpers below to seed the mock state
//   3. Imports the route handler and invokes it with a built Request

import { vi } from 'vitest'

// ── requireSuperadmin gate ────────────────────────────────────────────────
// Default: gate passes. Tests can override with `gateRejects(...)`.
export const requireSuperadminMock = vi.fn()

vi.mock('@/lib/auth/superadmin', () => ({
  requireSuperadmin: (h: string | null) => requireSuperadminMock(h),
}))

export function gateOk(userId = 'super-1', email = 'super@example.com') {
  requireSuperadminMock.mockResolvedValue({ ok: true, userId, email })
}
export function gateRejects(status: number, message: string) {
  requireSuperadminMock.mockResolvedValue({ ok: false, status, message })
}

// ── supabaseAdmin builder ─────────────────────────────────────────────────
// Routes chain like:
//   admin.from('tenants').select('*').eq('tenant_number', '0001').maybeSingle()
//   admin.from('tenants').update({...}).eq('id', x).select('*').maybeSingle()
//   admin.from('tenant_memberships').insert({...})
//   admin.rpc('next_tenant_number')
//   admin.auth.admin.createUser({...})
//   admin.auth.admin.deleteUser(id)
//   admin.auth.admin.getUserById(id)
//   admin.storage.from('bucket').upload(path, blob)
//
// Rather than build thenables for every chain shape, we expose a small
// fluent mock where every chain method returns `chain` itself, and the
// "terminal" operations resolve to whatever the test queued via
// `queueResult(...)`. Tests can also intercept inserts/updates by
// listening on `lastInsert` / `lastUpdate`.

export interface ChainResult { data?: unknown; error?: { message: string; code?: string } | null; count?: number }

class MockChain {
  // Per-table queue of results for terminal operations.
  // Tests push to a queue keyed by the table name; the chain pops one
  // each time a terminal is awaited. If the queue is empty we resolve
  // to { data: null, error: null } so an unconfigured call doesn't
  // explode the test (the assertion will still fail clearly).
  private queues: Map<string, ChainResult[]> = new Map()
  // Inserts/updates are captured for later assertions.
  public inserts: Array<{ table: string; payload: unknown }>  = []
  public updates: Array<{ table: string; payload: unknown }>  = []
  public deletes: Array<{ table: string }>                    = []
  public rpcCalls: Array<{ name: string; args?: unknown }>    = []

  queue(table: string, ...results: ChainResult[]) {
    if (!this.queues.has(table)) this.queues.set(table, [])
    this.queues.get(table)!.push(...results)
  }

  private next(table: string): ChainResult {
    const q = this.queues.get(table)
    if (!q || q.length === 0) return { data: null, error: null }
    return q.shift()!
  }

  buildAdmin() {
    const self = this
    function tableProxy(table: string) {
      const result = (): Promise<ChainResult> => Promise.resolve(self.next(table))
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        neq:    () => chain,
        in:     () => chain,
        order:  () => chain,
        single: result,
        maybeSingle: result,
        insert: (payload: unknown) => { self.inserts.push({ table, payload }); return chain },
        update: (payload: unknown) => { self.updates.push({ table, payload }); return chain },
        delete: () => { self.deletes.push({ table }); return chain },
        // Terminal awaits also work directly via .then on the chain:
        then: (onFulfilled: (v: ChainResult) => unknown) =>
          Promise.resolve(self.next(table)).then(onFulfilled),
      }
      return chain
    }

    return {
      from: (table: string) => tableProxy(table),
      rpc:  (name: string, args?: unknown) => {
        self.rpcCalls.push({ name, args })
        const r = self.queues.get(`rpc:${name}`)?.shift() ?? { data: null, error: null }
        return Promise.resolve(r)
      },
      auth: { admin: authAdminMock },
      storage: {
        from: (_b: string) => ({
          upload: vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null }),
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/logo.png' } }),
          remove: vi.fn().mockResolvedValue({ data: [], error: null }),
          list:   vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      },
    }
  }
}

export const authAdminMock = {
  createUser:   vi.fn(),
  deleteUser:   vi.fn(),
  getUserById:  vi.fn(),
  listUsers:    vi.fn(),
}

export const mockState = new MockChain()

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin:        () => mockState.buildAdmin(),
  generateTempPassword: vi.fn(() => 'TempPass123!'),
}))

// ── sendInviteEmail mock (for member-invite tests) ────────────────────────
export const sendInviteEmailMock = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/email/sendInvite', () => ({
  sendInviteEmail: sendInviteEmailMock,
  computeLoginUrl: () => 'https://soteriafield.app',
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

// ── reset between tests ───────────────────────────────────────────────────
export function resetMocks() {
  requireSuperadminMock.mockReset()
  authAdminMock.createUser.mockReset()
  authAdminMock.deleteUser.mockReset()
  authAdminMock.getUserById.mockReset()
  authAdminMock.listUsers.mockReset()
  sendInviteEmailMock.mockReset()
  sendInviteEmailMock.mockResolvedValue(true)
  mockState.inserts.length = 0
  mockState.updates.length = 0
  mockState.deletes.length = 0
  mockState.rpcCalls.length = 0
  // Clear queues
  ;(mockState as unknown as { queues: Map<string, unknown> }).queues = new Map()
}

// ── Request builders ──────────────────────────────────────────────────────
export function jsonRequest(method: string, body?: unknown): Request {
  return new Request('http://x/api', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  })
}
export function emptyRequest(method: string): Request {
  return new Request('http://x/api', {
    method,
    headers: { Authorization: 'Bearer t' },
  })
}
// Builds a context object whose `params` is a Promise (Next.js 16 shape).
export function ctxFor<T>(params: T) {
  return { params: Promise.resolve(params) }
}
