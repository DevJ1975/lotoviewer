// The tenant gate must agree with the RLS functions it stands in for.
//
// Migration 190 defines current_user_tenant_ids() and
// current_user_admin_tenant_ids() as a join over tenant_memberships and
// tenants with `t.disabled_at is null and m.invite_cancelled_at is null`.
// The gate checked neither, which is invisible only while a route queries
// through gate.authedClient (the user's JWT, subject to those policies).
// The many routes that pass the gate and then reach for supabaseAdmin()
// bypass RLS entirely — for them this gate IS the access control, and a
// revoked member or a member of a disabled tenant still walked through it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getUserMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (t: string) => getUserMock(t) } }),
}))

interface Result { data?: unknown; error?: unknown }
const queues = new Map<string, Result[]>()
function queue(table: string, r: Result) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table)!.push(r)
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const next = (): Promise<Result> =>
        Promise.resolve(queues.get(table)?.shift() ?? { data: null, error: null })
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        maybeSingle: next,
        then: (f: (v: Result) => unknown) => next().then(f),
      }
      return chain
    },
  }),
}))

import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'

const TENANT = '00000000-0000-0000-0000-0000000000aa'
const USER   = 'user-1'

function req(): Request {
  return new Request('https://x/api/thing', {
    method: 'GET',
    headers: { authorization: 'Bearer tok', 'x-active-tenant': TENANT },
  })
}

/** Not a superadmin — the gate's first lookup. */
function notSuperadmin() {
  queue('profiles', { data: { is_superadmin: false }, error: null })
}

const ORIG_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const ORIG_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

beforeEach(() => {
  queues.clear()
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: USER, email: 'u@example.com' } }, error: null })
  process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://project.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPERADMIN_EMAILS             = ''
})
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL      = ORIG_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIG_ANON
})

describe('tenantGate — revoked and disabled access', () => {
  it('refuses a membership whose invite was cancelled', async () => {
    notSuperadmin()
    queue('tenant_memberships', {
      data: { role: 'admin', invite_cancelled_at: '2026-08-01T00:00:00Z', tenants: { disabled_at: null } },
      error: null,
    })

    const g = await requireTenantMember(req())

    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.status).toBe(403)
      expect(g.message).toMatch(/revoked/i)
    }
  })

  it('refuses a membership in a disabled tenant', async () => {
    notSuperadmin()
    queue('tenant_memberships', {
      data: { role: 'owner', invite_cancelled_at: null, tenants: { disabled_at: '2026-07-01T00:00:00Z' } },
      error: null,
    })

    const g = await requireTenantAdmin(req())

    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.status).toBe(403)
      expect(g.message).toMatch(/disabled/i)
    }
  })

  it('accepts the embedded tenant as a single-element array too', async () => {
    // PostgREST returns a to-one embed as an object or a 1-element array
    // depending on how it infers the relationship; both must be read.
    notSuperadmin()
    queue('tenant_memberships', {
      data: { role: 'admin', invite_cancelled_at: null, tenants: [{ disabled_at: '2026-07-01T00:00:00Z' }] },
      error: null,
    })

    const g = await requireTenantAdmin(req())

    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.message).toMatch(/disabled/i)
  })

  it('still admits a live membership', async () => {
    notSuperadmin()
    queue('tenant_memberships', {
      data: { role: 'admin', invite_cancelled_at: null, tenants: { disabled_at: null } },
      error: null,
    })

    const g = await requireTenantAdmin(req())

    expect(g.ok).toBe(true)
    if (g.ok) {
      expect(g.role).toBe('admin')
      expect(g.tenantId).toBe(TENANT)
    }
  })

  it('reports a failed lookup as 500, not as "not a member"', async () => {
    // The embed makes this query more complex than it was; a PostgREST or
    // network fault must not present as a permanent-looking 403.
    notSuperadmin()
    queue('tenant_memberships', { data: null, error: { message: 'could not find relationship' } })

    const g = await requireTenantMember(req())

    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.status).toBe(500)
      expect(g.message).not.toMatch(/not a member/i)
    }
  })

  it('still enforces the role floor for admin routes', async () => {
    notSuperadmin()
    queue('tenant_memberships', {
      data: { role: 'member', invite_cancelled_at: null, tenants: { disabled_at: null } },
      error: null,
    })

    const g = await requireTenantAdmin(req())

    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.message).toMatch(/admin or owner/i)
  })
})
