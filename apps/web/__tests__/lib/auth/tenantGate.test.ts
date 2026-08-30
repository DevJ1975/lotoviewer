import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// `tenantGate` is the authorization boundary for 229 API route files, and
// 279 of the 344 route files reach the database through the service-role
// client — which bypasses RLS entirely. For those routes this gate is the
// ONLY thing standing between a request and the data, so it is tested
// directly here rather than through a route.
//
// Mocks must be declared before the import. We control:
//   - createClient (anon)  → auth.getUser, to flip token validity
//   - supabaseAdmin        → dispatches on table name so `profiles` and
//                            `tenant_memberships` can be flipped separately

const getUserMock          = vi.fn()
const profileMaybeSingle   = vi.fn()
const membershipMaybeSingle = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn((table: string) => {
      // profiles: .select().eq().maybeSingle()
      // tenant_memberships: .select().eq().eq().maybeSingle()
      const terminal = table === 'profiles' ? profileMaybeSingle : membershipMaybeSingle
      const eq2 = { maybeSingle: terminal }
      const eq1 = { eq: vi.fn(() => eq2), maybeSingle: terminal }
      return { select: vi.fn(() => ({ eq: vi.fn(() => eq1) })) }
    }),
  })),
}))

import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'

const TENANT = '11111111-2222-3333-4444-555555555555'
const ORIG_ENV = process.env

function req(headers: Record<string, string> = {}) {
  return new Request('https://app.test/api/anything', {
    headers: {
      authorization:    'Bearer token-abc',
      'x-active-tenant': TENANT,
      ...headers,
    },
  })
}

/** A membership row shaped the way the gate's select returns it. */
function membership(over: Partial<{
  role: string
  invite_cancelled_at: string | null
  disabled_at: string | null
}> = {}) {
  const { role = 'member', invite_cancelled_at = null, disabled_at = null } = over
  return { data: { role, invite_cancelled_at, tenants: { disabled_at } } }
}

describe('tenantGate', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://x.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPERADMIN_EMAILS             = 'root@example.com'
    getUserMock.mockReset()
    profileMaybeSingle.mockReset()
    membershipMaybeSingle.mockReset()

    // Default: a valid, non-superadmin user.
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'worker@example.com' } }, error: null })
    profileMaybeSingle.mockResolvedValue({ data: { is_superadmin: false } })
  })

  afterEach(() => {
    process.env = ORIG_ENV
  })

  describe('token and header handling', () => {
    it('rejects with 401 when the authorization header is absent', async () => {
      const r = await requireTenantMember(new Request('https://app.test/api/anything'))
      expect(r).toMatchObject({ ok: false, status: 401 })
    })

    it('rejects with 401 when the header has no Bearer prefix', async () => {
      const r = await requireTenantMember(req({ authorization: 'Basic abc' }))
      expect(r).toMatchObject({ ok: false, status: 401 })
    })

    it('rejects with 401 when the token does not resolve to a user', async () => {
      getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
      const r = await requireTenantMember(req())
      expect(r).toMatchObject({ ok: false, status: 401 })
    })

    it('rejects with 400 when x-active-tenant is missing', async () => {
      const r = await requireTenantMember(new Request('https://app.test/api/anything', {
        headers: { authorization: 'Bearer token-abc' },
      }))
      expect(r).toMatchObject({ ok: false, status: 400 })
    })

    it('rejects with 400 when x-active-tenant is not a uuid', async () => {
      const r = await requireTenantMember(req({ 'x-active-tenant': 'not-a-uuid' }))
      expect(r).toMatchObject({ ok: false, status: 400 })
    })
  })

  describe('membership', () => {
    it('rejects with 403 when the user is not a member of the tenant', async () => {
      membershipMaybeSingle.mockResolvedValue({ data: null })
      const r = await requireTenantMember(req())
      expect(r).toMatchObject({ ok: false, status: 403, message: 'Not a member of this tenant' })
    })

    it('reports 500 when the membership lookup itself fails', async () => {
      // A discarded error presented as 403 Not a member — a permanent-looking
      // denial for a transient DB fault, on the hot path of every gated route.
      membershipMaybeSingle.mockResolvedValue({ data: null, error: { message: 'connection reset' } })
      const r = await requireTenantMember(req())
      expect(r).toMatchObject({ ok: false, status: 500 })
    })

    it('admits a member of the tenant', async () => {
      membershipMaybeSingle.mockResolvedValue(membership({ role: 'member' }))
      const r = await requireTenantMember(req())
      expect(r).toMatchObject({ ok: true, tenantId: TENANT, role: 'member', userId: 'user-1' })
    })
  })

  // The two checks below are the reason this file exists. The DB helper the
  // RLS policies use (migration 190) enforces both; before this, the gate
  // enforced neither — so a disabled tenant's signed-in users kept read AND
  // write access across every service-role route until their JWT expired.
  describe('tenant lifecycle', () => {
    it('rejects a member of a DISABLED tenant with 403', async () => {
      membershipMaybeSingle.mockResolvedValue(membership({ disabled_at: '2026-08-01T00:00:00Z' }))
      const r = await requireTenantMember(req())
      expect(r).toMatchObject({ ok: false, status: 403 })
      expect((r as { message: string }).message).toMatch(/disabled/i)
    })

    it('rejects a member whose invite was CANCELLED with 403', async () => {
      membershipMaybeSingle.mockResolvedValue(membership({ invite_cancelled_at: '2026-08-01T00:00:00Z' }))
      const r = await requireTenantMember(req())
      expect(r).toMatchObject({ ok: false, status: 403 })
      expect((r as { message: string }).message).toMatch(/revoked/i)
    })

    it('rejects an ADMIN of a disabled tenant too — role does not exempt', async () => {
      membershipMaybeSingle.mockResolvedValue(membership({ role: 'admin', disabled_at: '2026-08-01T00:00:00Z' }))
      const r = await requireTenantAdmin(req())
      expect(r).toMatchObject({ ok: false, status: 403 })
    })

    it('tolerates the embedded tenant arriving as a single-element array', async () => {
      // PostgREST shapes an embedded to-one as an object under some select
      // forms and a one-element array under others. Either must gate.
      membershipMaybeSingle.mockResolvedValue({
        data: { role: 'member', invite_cancelled_at: null, tenants: [{ disabled_at: '2026-08-01T00:00:00Z' }] },
      })
      const r = await requireTenantMember(req())
      expect(r).toMatchObject({ ok: false, status: 403 })
    })
  })

  describe('role escalation', () => {
    it.each(['member', 'viewer'])('rejects a %s from an admin-only route with 403', async role => {
      membershipMaybeSingle.mockResolvedValue(membership({ role }))
      const r = await requireTenantAdmin(req())
      expect(r).toMatchObject({ ok: false, status: 403 })
    })

    it.each(['owner', 'admin'])('admits a %s to an admin-only route', async role => {
      membershipMaybeSingle.mockResolvedValue(membership({ role }))
      const r = await requireTenantAdmin(req())
      expect(r).toMatchObject({ ok: true, role })
    })
  })

  describe('superadmin bypass', () => {
    // The profile and membership reads now issue together rather than in
    // series, so a superadmin does pay for a membership query it does not
    // use — one wasted read for a rare role, against a round-trip saved on
    // every gated request by everyone else. What matters is unchanged and is
    // what this asserts: a superadmin is admitted on the profile flag alone,
    // whatever tenant_memberships says. The previous version asserted the
    // query was never issued, which was a statement about the serial
    // implementation rather than about the authorization rule.
    it('admits a superadmin on the profile flag alone, whatever membership says', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'root-1', email: 'root@example.com' } }, error: null })
      profileMaybeSingle.mockResolvedValue({ data: { is_superadmin: true } })
      membershipMaybeSingle.mockResolvedValue({ data: null, error: null })
      const r = await requireTenantAdmin(req())
      expect(r).toMatchObject({ ok: true, role: 'superadmin' })
    })

    it('does NOT admit a DB-flagged superadmin whose email is off the env allowlist', async () => {
      // Both halves are required: the flag alone is not authority.
      getUserMock.mockResolvedValue({ data: { user: { id: 'x', email: 'impostor@example.com' } }, error: null })
      profileMaybeSingle.mockResolvedValue({ data: { is_superadmin: true } })
      membershipMaybeSingle.mockResolvedValue({ data: null })
      const r = await requireTenantAdmin(req())
      expect(r).toMatchObject({ ok: false, status: 403 })
    })
  })

  describe('facility header', () => {
    it('carries a valid x-active-facility through to the gate result', async () => {
      const facility = '99999999-8888-7777-6666-555555555555'
      membershipMaybeSingle.mockResolvedValue(membership())
      const r = await requireTenantMember(req({ 'x-active-facility': facility }))
      expect(r).toMatchObject({ ok: true, facilityId: facility })
    })

    it('treats a malformed x-active-facility as the roll-up view rather than rejecting', async () => {
      membershipMaybeSingle.mockResolvedValue(membership())
      const r = await requireTenantMember(req({ 'x-active-facility': 'garbage' }))
      expect(r).toMatchObject({ ok: true, facilityId: null })
    })
  })
})
