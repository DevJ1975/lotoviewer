import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authAdminMock,
  generateLinkOk,
  jsonRequest,
  mockState,
  resetMocks,
  sendInviteEmailMock,
  sendVerifyInviteEmailMock,
} from '../superadmin/_helpers'

const { requireTenantAdminMock } = vi.hoisted(() => ({
  requireTenantAdminMock: vi.fn(),
}))

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin: (req: Request) => requireTenantAdminMock(req),
}))

import { POST as inviteUser } from '@/app/api/admin/users/route'

function tenantAdminOk() {
  requireTenantAdminMock.mockResolvedValue({
    ok: true,
    userId: 'admin-1',
    userEmail: 'admin@example.com',
    tenantId: 'T1',
    role: 'admin',
    authedClient: {},
  })
}

describe('POST /api/admin/users', () => {
  beforeEach(() => {
    resetMocks()
    tenantAdminOk()
  })

  it('emails a verify link and creates membership + canonical member row for a new invite', async () => {
    mockState.queue('tenants', { data: { id: 'T1', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: null, error: null })
    generateLinkOk('NEW-USER', 'new@example.com', 'https://supabase.test/verify?token=abc')
    mockState.queue('profiles', { data: null, error: null })             // profile upsert
    mockState.queue('tenant_memberships', { data: null, error: null })

    const res = await inviteUser(
      jsonRequest('POST', { email: 'New@Example.com', fullName: 'New Worker' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      email: 'new@example.com',
      fullName: 'New Worker',
      emailSent: true,
      alreadyExisted: false,
      tenantId: 'T1',
    })
    // No credential is ever returned in the response.
    expect(body.tempPassword).toBeUndefined()
    expect(authAdminMock.createUser).not.toHaveBeenCalled()

    expect(mockState.inserts.find(i => i.table === 'tenant_memberships')?.payload).toMatchObject({
      user_id: 'NEW-USER',
      tenant_id: 'T1',
      role: 'member',
      invited_by: 'admin-1',
    })
    expect(mockState.inserts.find(i => i.table === 'members')?.payload).toMatchObject({
      tenant_id: 'T1',
      profile_id: 'NEW-USER',
      source: 'profile',
      display_name: 'New Worker',
      email: 'new@example.com',
      status: 'active',
      readiness_status: 'setup_needed',
    })
    expect(sendVerifyInviteEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'new@example.com',
      tenantName: 'Snak King',
      verifyUrl: 'https://supabase.test/verify?token=abc',
    }))
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('rolls back a brand-new auth user when membership insert races into a duplicate', async () => {
    mockState.queue('tenants', { data: { id: 'T1', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: null, error: null })
    generateLinkOk('RACE-USER', 'race@example.com')
    mockState.queue('profiles', { data: null, error: null })             // profile upsert
    mockState.queue('tenant_memberships', {
      data: null,
      error: { message: 'duplicate key', code: '23505' },
    })

    const res = await inviteUser(
      jsonRequest('POST', { email: 'race@example.com', fullName: 'Race User' }),
    )

    expect(res.status).toBe(409)
    // created:true (a fresh invite) → the auth user is rolled back.
    expect(authAdminMock.deleteUser).toHaveBeenCalledWith('RACE-USER')
    expect(mockState.inserts.some(i => i.table === 'members')).toBe(false)
    expect(sendVerifyInviteEmailMock).not.toHaveBeenCalled()
  })
})
