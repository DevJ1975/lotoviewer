import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// requireTenantModuleAdmin guards every register write in /api/environmental.
// It must agree with the RLS it fronts (owner / admin only, superadmins
// pass) and still refuse when the module is off, whatever the role.

const getUserMock    = vi.fn()
const profileResult  = vi.fn()
const membershipResult = vi.fn()
const tenantResult   = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn((table: string) => {
      const terminal = { profiles: profileResult, tenant_memberships: membershipResult, tenants: tenantResult }[table]
      if (!terminal) throw new Error(`unexpected table ${table}`)
      const chain = { select: () => chain, eq: () => chain, maybeSingle: terminal }
      return chain
    }),
  })),
}))

import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'

const TENANT = '11111111-2222-4333-8444-555555555555'
const ORIG_ENV = process.env

function req(): Request {
  return new Request('https://app.test/api/environmental/policy', {
    headers: { authorization: 'Bearer token-abc', 'x-active-tenant': TENANT },
  })
}

function memberWithRole(role: string) {
  return { data: { role, invite_cancelled_at: null, tenants: { disabled_at: null } }, error: null }
}

describe('requireTenantModuleAdmin', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://x.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPERADMIN_EMAILS             = 'root@example.com'
    getUserMock.mockReset()
    profileResult.mockReset()
    membershipResult.mockReset()
    tenantResult.mockReset()

    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'worker@example.com' } }, error: null })
    profileResult.mockResolvedValue({ data: { is_superadmin: false } })
    tenantResult.mockResolvedValue({
      data: { name: 'Northfield Forge & Finish', modules: { environmental: true }, settings: null, disabled_at: null },
      error: null,
    })
  })

  afterEach(() => {
    process.env = ORIG_ENV
  })

  it.each(['owner', 'admin'])('admits a tenant %s', async role => {
    membershipResult.mockResolvedValue(memberWithRole(role))
    expect(await requireTenantModuleAdmin(req(), 'environmental')).toMatchObject({ ok: true, role, tenantId: TENANT })
  })

  it.each(['member', 'viewer'])('refuses a tenant %s with 403', async role => {
    membershipResult.mockResolvedValue(memberWithRole(role))
    expect(await requireTenantModuleAdmin(req(), 'environmental'))
      .toEqual({ ok: false, status: 403, message: 'Tenant admin or owner required' })
  })

  it('admits a superadmin who holds no membership', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'root', email: 'root@example.com' } }, error: null })
    profileResult.mockResolvedValue({ data: { is_superadmin: true } })
    membershipResult.mockResolvedValue({ data: null, error: null })
    expect(await requireTenantModuleAdmin(req(), 'environmental')).toMatchObject({ ok: true, role: 'superadmin' })
  })

  it('refuses an owner when the module is off for the tenant', async () => {
    membershipResult.mockResolvedValue(memberWithRole('owner'))
    tenantResult.mockResolvedValue({
      data: { name: 'Northfield Forge & Finish', modules: {}, settings: null, disabled_at: null }, error: null,
    })
    expect(await requireTenantModuleAdmin(req(), 'environmental'))
      .toEqual({ ok: false, status: 403, message: 'Module is not enabled for this tenant' })
  })

  it('passes a membership failure through unchanged', async () => {
    membershipResult.mockResolvedValue({ data: null, error: null })
    expect(await requireTenantModuleAdmin(req(), 'environmental'))
      .toEqual({ ok: false, status: 403, message: 'Not a member of this tenant' })
  })

  it('refuses an admin of a disabled tenant', async () => {
    membershipResult.mockResolvedValue(memberWithRole('admin'))
    tenantResult.mockResolvedValue({
      data: { name: 'Northfield Forge & Finish', modules: { environmental: true }, settings: null, disabled_at: '2026-01-01T00:00:00Z' },
      error: null,
    })
    expect(await requireTenantModuleAdmin(req(), 'environmental'))
      .toEqual({ ok: false, status: 403, message: 'Module is not enabled for this tenant' })
  })

  it('passes a failed tenant lookup through as 500, not as a permission error', async () => {
    membershipResult.mockResolvedValue(memberWithRole('admin'))
    tenantResult.mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    expect(await requireTenantModuleAdmin(req(), 'environmental'))
      .toMatchObject({ ok: false, status: 500 })
  })
})

// Reads share the same module toggle; the admin variant above adds the role on top.
describe('requireTenantModuleMember', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://x.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPERADMIN_EMAILS             = 'root@example.com'
    getUserMock.mockReset()
    profileResult.mockReset()
    membershipResult.mockReset()
    tenantResult.mockReset()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'worker@example.com' } }, error: null })
    profileResult.mockResolvedValue({ data: { is_superadmin: false } })
    tenantResult.mockResolvedValue({
      data: { name: 'Northfield Forge & Finish', modules: { environmental: true }, settings: null, disabled_at: null },
      error: null,
    })
  })

  afterEach(() => {
    process.env = ORIG_ENV
  })

  it('admits a member of a tenant with the module enabled', async () => {
    membershipResult.mockResolvedValue(memberWithRole('member'))
    expect(await requireTenantModuleMember(req(), 'environmental')).toMatchObject({ ok: true, role: 'member' })
  })

  it('refuses a member when the module is off', async () => {
    membershipResult.mockResolvedValue(memberWithRole('member'))
    tenantResult.mockResolvedValue({
      data: { name: 'Northfield Forge & Finish', modules: { environmental: false }, settings: null, disabled_at: null }, error: null,
    })
    expect(await requireTenantModuleMember(req(), 'environmental')).toMatchObject({ ok: false, status: 403 })
  })

  it('does not look up the tenant at all when the role gate already failed', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'bad token' } })
    expect(await requireTenantModuleMember(req(), 'environmental')).toMatchObject({ ok: false, status: 401 })
    expect(tenantResult).not.toHaveBeenCalled()
  })
})
