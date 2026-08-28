import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authAdminMock,
  emptyRequest,
  mockState,
  resetMocks,
} from '../superadmin/_helpers'

const { requireTenantAdminMock } = vi.hoisted(() => ({
  requireTenantAdminMock: vi.fn(),
}))

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin: (req: Request) => requireTenantAdminMock(req),
}))

import { POST as resetAccess } from '@/app/api/admin/members/[memberId]/reset-access/route'

const TENANT  = '00000000-0000-0000-0000-00000000000a'
const MEMBER  = '00000000-0000-0000-0000-00000000000b'
const PROFILE = '00000000-0000-0000-0000-00000000000c'
const OTHER_TENANT = '00000000-0000-0000-0000-00000000000d'

function tenantAdminOk() {
  requireTenantAdminMock.mockResolvedValue({
    ok: true,
    userId: 'admin-1',
    userEmail: 'admin@example.com',
    tenantId: TENANT,
    role: 'admin',
    authedClient: {},
  })
}

function ctxFor(memberId: string) {
  return { params: Promise.resolve({ memberId }) }
}

/** Queues the happy-path lookups: member with a login, then the tenant. */
function queueMemberWithLogin() {
  mockState.queue('members', {
    data: {
      id: MEMBER,
      tenant_id: TENANT,
      profile_id: PROFILE,
      email: 'worker@example.com',
      legal_name: 'Worker One',
      display_name: 'Worker One',
    },
    error: null,
  })
  authAdminMock.getUserById.mockResolvedValue({
    data: { user: { id: PROFILE, email: 'worker@example.com', last_sign_in_at: '2026-01-01T00:00:00Z' } },
    error: null,
  })
  authAdminMock.updateUserById.mockResolvedValue({ data: { user: { id: PROFILE } }, error: null })
  mockState.queue('tenants', { data: { id: TENANT, name: 'Snak King' }, error: null })
}

describe('POST /api/admin/members/[memberId]/reset-access', () => {
  beforeEach(() => {
    resetMocks()
    requireTenantAdminMock.mockReset()
    tenantAdminOk()
  })

  it('rotates the password, forces a change, and emits an access_reset event', async () => {
    queueMemberWithLogin()

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.tempPassword).toBe('TempPass123!')
    expect(body.email).toBe('worker@example.com')

    expect(authAdminMock.updateUserById).toHaveBeenCalledWith(PROFILE, { password: 'TempPass123!' })

    const flag = mockState.updates.find(u => u.table === 'profiles')
    expect(flag?.payload).toMatchObject({ must_change_password: true })

    const event = mockState.inserts.find(i => i.table === 'member_status_events')
    expect(event?.payload).toMatchObject({
      tenant_id:     TENANT,
      member_id:     MEMBER,
      event_type:    'access_reset',
      actor_user_id: 'admin-1',
    })
  })

  // The whole point of this route versus the superadmin resend: an admin
  // resetting a locked-out worker must not be blocked by the fact that
  // the worker has signed in before.
  it('proceeds even when the member has already signed in', async () => {
    queueMemberWithLogin()

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))

    expect(res.status).toBe(200)
    expect(authAdminMock.updateUserById).toHaveBeenCalled()
  })

  it('refuses a roster-only member with 409 NO_LOGIN', async () => {
    mockState.queue('members', {
      data: {
        id: MEMBER, tenant_id: TENANT, profile_id: null,
        email: 'roster@example.com', legal_name: 'Roster', display_name: 'Roster',
      },
      error: null,
    })

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('NO_LOGIN')
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('404s for a member outside the active tenant', async () => {
    mockState.queue('members', { data: null, error: null })

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))

    expect(res.status).toBe(404)
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('rejects a malformed member id before touching the gate', async () => {
    const res = await resetAccess(emptyRequest('POST'), ctxFor('not-a-uuid'))

    expect(res.status).toBe(400)
    expect(requireTenantAdminMock).not.toHaveBeenCalled()
  })

  it('propagates the tenant gate rejection', async () => {
    requireTenantAdminMock.mockResolvedValue({ ok: false, status: 403, message: 'Admin role required' })

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))

    expect(res.status).toBe(403)
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  // A failed rotation must not leave the audit trail claiming success.
  it('does not write an audit event when the rotation fails', async () => {
    mockState.queue('members', {
      data: {
        id: MEMBER, tenant_id: TENANT, profile_id: PROFILE,
        email: 'worker@example.com', legal_name: 'Worker One', display_name: 'Worker One',
      },
      error: null,
    })
    authAdminMock.getUserById.mockResolvedValue({
      data: { user: { id: PROFILE, email: 'worker@example.com' } }, error: null,
    })
    authAdminMock.updateUserById.mockResolvedValue({
      data: null, error: { message: 'auth is down' },
    })

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))

    expect(res.status).toBe(500)
    expect(mockState.inserts.find(i => i.table === 'member_status_events')).toBeUndefined()
  })

  it('409s when the login has no email to send to', async () => {
    mockState.queue('members', {
      data: {
        id: MEMBER, tenant_id: TENANT, profile_id: PROFILE,
        email: null, legal_name: 'Worker One', display_name: 'Worker One',
      },
      error: null,
    })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { id: PROFILE, email: null } }, error: null })

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('NO_EMAIL')
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })
})


// The route rotates a credential AND returns it in the response body. That
// combination means authorizing only the CALLER turns "reset a worker's
// access" into "mint myself a working login as anyone in this tenant" —
// including the owner, and any superadmin holding a membership here.
describe('reset-access — the caller must out-rank the target', () => {
  beforeEach(() => { resetMocks(); tenantAdminOk() })

  /** members row, then the two target-rank lookups the guard performs. */
  function queueTargetAs(roles: string | string[] | null, isSuperadmin = false) {
    const list = roles == null ? [] : (Array.isArray(roles) ? roles : [roles])
    mockState.queue('members', {
      data: {
        id: MEMBER, tenant_id: TENANT, profile_id: PROFILE,
        email: 'worker@example.com', legal_name: 'Worker One', display_name: 'Worker One',
      },
      error: null,
    })
    mockState.queue('profiles',           { data: { is_superadmin: isSuperadmin }, error: null })
    // The guard reads EVERY membership the target holds, not just this
    // tenant's, and it distinguishes them by tenant_id — power in someone
    // else's tenant is disqualifying, power in this one is merely ranked. A
    // bare role means "in this tenant"; suffix it with '@other' to place it
    // in a different one.
    mockState.queue('tenant_memberships', {
      data: list.map(spec => {
        const [role, where] = spec.split('@')
        return { role, tenant_id: where === 'other' ? OTHER_TENANT : TENANT }
      }),
      error: null,
    })
  }

  function allowRotationAndSend() {
    authAdminMock.getUserById.mockResolvedValue({
      data: { user: { id: PROFILE, email: 'worker@example.com' } }, error: null,
    })
    authAdminMock.updateUserById.mockResolvedValue({ data: { user: { id: PROFILE } }, error: null })
    mockState.queue('tenants', { data: { id: TENANT, name: 'Snak King' }, error: null })
  }

  it('403s when an admin targets the tenant owner', async () => {
    queueTargetAs('owner')

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('FORBIDDEN_TARGET')
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('403s when an admin targets another admin', async () => {
    queueTargetAs('admin')

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))

    expect(res.status).toBe(403)
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('403s when the target is a superadmin, whatever their tenant role', async () => {
    queueTargetAs('member', true)

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.message).toMatch(/Soteria administrator/i)
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('allows the core case — an admin resetting a member', async () => {
    queueTargetAs('member')
    allowRotationAndSend()

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))

    expect(res.status).toBe(200)
    expect(authAdminMock.updateUserById).toHaveBeenCalledWith(PROFILE, { password: 'TempPass123!' })
  })

  it('403s when the target is a plain member here but an owner elsewhere', async () => {
    // auth.users holds ONE password, and `members` is per-tenant by design, so
    // a person legitimately holds member rows in several tenants. A
    // tenant-local rank check would let this tenant's admin rotate — and read —
    // the credential that owns a different tenant.
    queueTargetAs(['member', 'owner@other'])

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('FORBIDDEN_TARGET')
    expect(body.message).toMatch(/another organization/i)
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('403s when the caller out-ranks the target but the target administers elsewhere', async () => {
    // The mirror image of the case above, and the one a single account-global
    // max(role) could not see. Caller is the OWNER of this tenant (rank 3),
    // target is merely an ADMIN of a different one (rank 2), so strict
    // dominance said yes — handing this tenant's owner a credential that
    // administers a tenant they have no standing in at all. Ranks only mean
    // something within one tenant; across tenants there is no order to compare.
    requireTenantAdminMock.mockResolvedValue({
      ok: true, userId: 'owner-1', userEmail: 'owner@example.com',
      tenantId: TENANT, role: 'owner', authedClient: {},
    })
    queueTargetAs(['member', 'admin@other'])

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('FORBIDDEN_TARGET')
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('still allows an admin to reset someone who is a member in several tenants', async () => {
    queueTargetAs(['member', 'viewer@other', 'member@other'])
    allowRotationAndSend()

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))

    expect(res.status).toBe(200)
    expect(authAdminMock.updateUserById).toHaveBeenCalled()
  })

  it('allows an owner to reset an admin', async () => {
    requireTenantAdminMock.mockResolvedValue({
      ok: true, userId: 'owner-1', userEmail: 'owner@example.com',
      tenantId: TENANT, role: 'owner', authedClient: {},
    })
    queueTargetAs('admin')
    allowRotationAndSend()

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))

    expect(res.status).toBe(200)
    expect(authAdminMock.updateUserById).toHaveBeenCalled()
  })

  it('allows a self-reset — rotating your own password is not an escalation', async () => {
    requireTenantAdminMock.mockResolvedValue({
      ok: true, userId: PROFILE, userEmail: 'admin@example.com',
      tenantId: TENANT, role: 'admin', authedClient: {},
    })
    // No rank lookups are queued: the self case short-circuits before them.
    mockState.queue('members', {
      data: {
        id: MEMBER, tenant_id: TENANT, profile_id: PROFILE,
        email: 'admin@example.com', legal_name: 'Ad Min', display_name: 'Ad Min',
      },
      error: null,
    })
    allowRotationAndSend()

    const res = await resetAccess(emptyRequest('POST'), ctxFor(MEMBER))

    expect(res.status).toBe(200)
  })
})
