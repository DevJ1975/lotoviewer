import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authAdminMock,
  jsonRequest,
  mockState,
  resetMocks,
  sendInviteEmailMock,
} from '../superadmin/_helpers'

const { requireTenantAdminMock } = vi.hoisted(() => ({
  requireTenantAdminMock: vi.fn(),
}))

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin: (req: Request) => requireTenantAdminMock(req),
}))

import { POST as grantLogin } from '@/app/api/admin/members/[memberId]/grant-login/route'

const TENANT = '00000000-0000-0000-0000-00000000000a'
const MEMBER = '00000000-0000-0000-0000-00000000000b'

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

describe('POST /api/admin/members/[memberId]/grant-login', () => {
  beforeEach(() => {
    resetMocks()
    tenantAdminOk()
  })

  it('creates auth user, attaches profile_id to existing member, emits login_granted event', async () => {
    // member lookup: roster-only member with email on file
    mockState.queue('members', {
      data: {
        id: MEMBER,
        tenant_id: TENANT,
        profile_id: null,
        email: 'roster@example.com',
        legal_name: 'Roster Worker',
        display_name: 'Roster Worker',
      },
      error: null,
    })
    // tenant lookup
    mockState.queue('tenants', { data: { id: TENANT, name: 'Snak King' }, error: null })
    // profile-by-email lookup: none
    mockState.queue('profiles', { data: null, error: null })
    // auth.users createUser success
    authAdminMock.createUser.mockResolvedValue({
      data: { user: { id: 'NEW-USER', email: 'roster@example.com' } },
      error: null,
    })
    // profile patch ok
    mockState.queue('profiles', { data: null, error: null })
    // tenant_memberships insert ok
    mockState.queue('tenant_memberships', { data: null, error: null })
    // members update (link profile_id) ok
    mockState.queue('members', { data: null, error: null })
    // member_status_events insert ok
    mockState.queue('member_status_events', { data: null, error: null })

    const res = await grantLogin(jsonRequest('POST', {}), ctxFor(MEMBER))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      memberId: MEMBER,
      profileId: 'NEW-USER',
      tempPassword: 'TempPass123!',
      emailSent: true,
    })

    // Member link is an UPDATE, not an INSERT — that's the whole point.
    expect(mockState.updates.find(u => u.table === 'members')?.payload).toMatchObject({
      profile_id: 'NEW-USER',
      email: 'roster@example.com',
      source: 'profile',
    })
    // login_granted event captured.
    expect(mockState.inserts.find(i => i.table === 'member_status_events')?.payload).toMatchObject({
      member_id: MEMBER,
      event_type: 'login_granted',
      actor_user_id: 'admin-1',
    })
    expect(sendInviteEmailMock).toHaveBeenCalled()
  })

  it('refuses when the member already has a profile_id (409)', async () => {
    mockState.queue('members', {
      data: {
        id: MEMBER,
        tenant_id: TENANT,
        profile_id: 'EXISTING-USER',
        email: 'has@example.com',
        legal_name: 'Has Login',
        display_name: 'Has Login',
      },
      error: null,
    })

    const res = await grantLogin(jsonRequest('POST', {}), ctxFor(MEMBER))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('ALREADY_HAS_LOGIN')
    expect(authAdminMock.createUser).not.toHaveBeenCalled()
  })

  it('returns 400 when no email is on file and none provided', async () => {
    mockState.queue('members', {
      data: {
        id: MEMBER,
        tenant_id: TENANT,
        profile_id: null,
        email: null,
        legal_name: 'No Email',
        display_name: 'No Email',
      },
      error: null,
    })

    const res = await grantLogin(jsonRequest('POST', {}), ctxFor(MEMBER))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('EMAIL_REQUIRED')
  })
})
