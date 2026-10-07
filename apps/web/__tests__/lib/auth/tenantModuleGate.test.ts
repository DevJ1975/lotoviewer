import { vi, describe, it, expect, beforeEach } from 'vitest'

// The module variants layer the tenant's module toggle over the role gate. The
// property that matters is that the admin variant needs BOTH: an admin of a
// tenant that switched the module off, and a member of one that left it on,
// are each refused.

const getUserMock           = vi.fn()
const profileMaybeSingle    = vi.fn()
const membershipMaybeSingle = vi.fn()
const tenantMaybeSingle     = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn((table: string) => {
      const terminal =
        table === 'profiles' ? profileMaybeSingle
        : table === 'tenants' ? tenantMaybeSingle
        : membershipMaybeSingle
      const eq2 = { maybeSingle: terminal }
      const eq1 = { eq: vi.fn(() => eq2), maybeSingle: terminal }
      return { select: vi.fn(() => ({ eq: vi.fn(() => eq1) })) }
    }),
  })),
}))

import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'

const TENANT = '11111111-2222-3333-4444-555555555555'

const request = () => new Request('https://app.test/api/anything', {
  headers: { authorization: 'Bearer token-abc', 'x-active-tenant': TENANT },
})

const asRole = (role: string) =>
  membershipMaybeSingle.mockResolvedValue({ data: { role, invite_cancelled_at: null, tenants: { disabled_at: null } } })

const tenantRow = (over: Partial<{ modules: Record<string, boolean> | null; disabled_at: string | null }> = {}) =>
  tenantMaybeSingle.mockResolvedValue({
    data: { name: 'Acme', modules: { environmental: true }, settings: { tier: 'pro' }, disabled_at: null, ...over },
    error: null,
  })

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPERADMIN_EMAILS = 'root@example.com'
  for (const m of [getUserMock, profileMaybeSingle, membershipMaybeSingle, tenantMaybeSingle]) m.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'worker@example.com' } }, error: null })
  profileMaybeSingle.mockResolvedValue({ data: { is_superadmin: false } })
})

describe('requireTenantModuleAdmin', () => {
  it('admits an admin of a tenant with the module enabled, and returns the tenant context', async () => {
    asRole('admin'); tenantRow()
    const r = await requireTenantModuleAdmin(request(), 'environmental')
    expect(r).toMatchObject({ ok: true, role: 'admin', tenantName: 'Acme', tenantModules: { environmental: true } })
  })

  it('refuses a plain member even when the module is enabled', async () => {
    asRole('member'); tenantRow()
    const r = await requireTenantModuleAdmin(request(), 'environmental')
    expect(r).toMatchObject({ ok: false, status: 403, message: 'Tenant admin or owner required' })
  })

  it('refuses an admin when the tenant switched the module off', async () => {
    asRole('admin'); tenantRow({ modules: { environmental: false } })
    const r = await requireTenantModuleAdmin(request(), 'environmental')
    expect(r).toMatchObject({ ok: false, status: 403, message: 'Module is not enabled for this tenant' })
  })

  it('refuses an admin of a disabled tenant', async () => {
    asRole('admin'); tenantRow({ disabled_at: '2026-01-01T00:00:00Z' })
    const r = await requireTenantModuleAdmin(request(), 'environmental')
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('passes a failed tenant lookup through as 500, not as a permission error', async () => {
    asRole('admin')
    tenantMaybeSingle.mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    const r = await requireTenantModuleAdmin(request(), 'environmental')
    expect(r).toMatchObject({ ok: false, status: 500 })
  })
})

describe('requireTenantModuleMember', () => {
  it('admits a member of a tenant with the module enabled', async () => {
    asRole('member'); tenantRow()
    expect(await requireTenantModuleMember(request(), 'environmental')).toMatchObject({ ok: true, role: 'member' })
  })

  it('refuses a member when the module is off', async () => {
    asRole('member'); tenantRow({ modules: { environmental: false } })
    expect(await requireTenantModuleMember(request(), 'environmental')).toMatchObject({ ok: false, status: 403 })
  })

  it('does not look up the tenant at all when the role gate already failed', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'bad token' } })
    const r = await requireTenantModuleMember(request(), 'environmental')
    expect(r).toMatchObject({ ok: false, status: 401 })
    expect(tenantMaybeSingle).not.toHaveBeenCalled()
  })
})
