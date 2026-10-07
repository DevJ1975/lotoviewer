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
}

// ── fake Supabase client ────────────────────────────────────────────────────
export interface Result { data?: unknown; error?: { message: string; code?: string } | null }
export interface Op { method: string; args: unknown[] }
export interface Call { table: string; ops: Op[] }

/**
 * A scriptable stand-in for the Supabase client. `script` maps a table to the
 * results its queries return, in order (the last one repeats), or to a function
 * that decides from the recorded call. Every builder method returns the builder;
 * awaiting it (or .single()/.maybeSingle()) yields the next scripted result.
 */
export function fakeSupabase(script: Record<string, Result[] | ((call: Call) => Result)> = {}) {
  const calls: Call[] = []
  const queues = new Map(Object.entries(script).map(([table, entry]) => [table, Array.isArray(entry) ? [...entry] : entry]))

  const next = (call: Call): Result => {
    const entry = queues.get(call.table)
    if (typeof entry === 'function') return entry(call)
    if (Array.isArray(entry) && entry.length > 0) return entry.length > 1 ? entry.shift()! : entry[0]!
    return { data: null, error: null }
  }

  const builder = (call: Call): unknown => new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(next(call)).then(resolve, reject)
      }
      return (...args: unknown[]) => { call.ops.push({ method: String(prop), args }); return builder(call) }
    },
  })

  const client = {
    from(table: string) { const call: Call = { table, ops: [] }; calls.push(call); return builder(call) },
    rpc(name: string, args?: unknown) { const call: Call = { table: `rpc:${name}`, ops: [{ method: 'rpc', args: [args] }] }; calls.push(call); return builder(call) },
  }

  return {
    client,
    calls,
    /** The calls made against `table` that used `method`, e.g. every insert. */
    used: (table: string, method: string) => calls.filter(c => c.table === table && c.ops.some(o => o.method === method)),
    /** The first argument of the first `method` call on `table`, e.g. the inserted row(s). */
    arg: (table: string, method: string) => calls.find(c => c.table === table && c.ops.some(o => o.method === method))
      ?.ops.find(o => o.method === method)?.args[0],
    /** Whether a query on `table` filtered with `.eq(column, value)`. */
    filtered: (table: string, column: string, value: unknown) =>
      calls.some(c => c.table === table && c.ops.some(o => o.method === 'eq' && o.args[0] === column && o.args[1] === value)),
  }
}

// ── requests ────────────────────────────────────────────────────────────────
export function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(`https://example.com${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export const params = <T extends Record<string, string>>(values: T) => ({ params: Promise.resolve(values) })
