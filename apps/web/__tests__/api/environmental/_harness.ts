// Shared harness for the /api/environmental route tests.
//
// Import this BEFORE the route under test: it installs the tenant-gate and
// error-sanitizer mocks, and exports a scriptable fake of the Supabase query
// builder so a test can assert on the queries a route actually issues, not just
// on its input validation.

import { vi } from 'vitest'

// ── gate ────────────────────────────────────────────────────────────────────
export const memberGate = vi.fn()
export const adminGate = vi.fn()

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantModuleMember: (...a: unknown[]) => memberGate(...a),
  requireTenantModuleAdmin:  (...a: unknown[]) => adminGate(...a),
  requireTenantMember:       (...a: unknown[]) => memberGate(...a),
  requireTenantAdmin:        (...a: unknown[]) => adminGate(...a),
}))
// Errors the routes hand to sanitizeError, so a test that expects a 500 can say why.
const hoisted = vi.hoisted(() => ({ sanitized: [] as unknown[] }))
export const sanitized = hoisted.sanitized
vi.mock('@/lib/security/sanitizeError', () => ({
  sanitizeError: (error: unknown) => { hoisted.sanitized.push(error); return Response.json({ error: 'internal' }, { status: 500 }) },
}))

// Users the service-client membership lookup reports as belonging to the tenant.
const membership = vi.hoisted(() => ({ members: new Set<string>() }))
export const members = membership.members
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      let userId = ''
      const query: Record<string, unknown> = {
        select: () => query,
        eq: (column: string, value: string) => { if (column === 'user_id') userId = value; return query },
        maybeSingle: async () => ({ data: membership.members.has(userId) ? { user_id: userId, invite_cancelled_at: null } : null, error: null }),
      }
      return query
    },
  }),
}))

export const TENANT = '11111111-1111-1111-1111-111111111111'
export const FACILITY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
export const OTHER_FACILITY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
export const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

type Role = 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'

export function allow(
  gate: typeof memberGate, client: unknown,
  over: Partial<{ facilityId: string | null; role: Role; userId: string }> = {},
) {
  gate.mockResolvedValue({
    ok: true, tenantId: TENANT, userId: over.userId ?? USER, userEmail: 'u@example.com',
    facilityId: over.facilityId === undefined ? FACILITY : over.facilityId,
    role: over.role ?? 'admin', authedClient: client,
    tenantName: 'Acme', tenantModules: { environmental: true }, tenantSettings: null,
  })
}

export function refuse(gate: typeof memberGate, status: number, message: string) {
  gate.mockResolvedValue({ ok: false, status, message })
}

export function resetGates() {
  memberGate.mockReset()
  adminGate.mockReset()
  sanitized.length = 0
  members.clear()
}

// ── fake Supabase client ────────────────────────────────────────────────────
export { fakeSupabase, type Result, type Op, type Call } from './_fakeSupabase'

// ── requests ────────────────────────────────────────────────────────────────
export function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(`https://example.com${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export const params = <T extends Record<string, string>>(values: T) => ({ params: Promise.resolve(values) })
