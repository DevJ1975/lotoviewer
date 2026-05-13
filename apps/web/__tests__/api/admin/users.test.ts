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

  it('creates a tenant membership and canonical member row for a new invite', async () => {
    mockState.queue('tenants', { data: { id: 'T1', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: null, error: null })
    authAdminMock.createUser.mockResolvedValue({
      data: { user: { id: 'NEW-USER', email: 'new@example.com' } },
      error: null,
    })
    mockState.queue('profiles', { data: null, error: null })
    mockState.queue('tenant_memberships', { data: null, error: null })

    const res = await inviteUser(
      jsonRequest('POST', { email: 'New@Example.com', fullName: 'New Worker' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      email: 'new@example.com',
      fullName: 'New Worker',
      tempPassword: 'TempPass123!',
      emailSent: true,
      alreadyExisted: false,
      tenantId: 'T1',
    })

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
    expect(sendInviteEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'new@example.com',
      tenantName: 'Snak King',
      tempPassword: 'TempPass123!',
    }))
  })

  it('rolls back a brand-new auth user when membership insert races into a duplicate', async () => {
    mockState.queue('tenants', { data: { id: 'T1', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: null, error: null })
    authAdminMock.createUser.mockResolvedValue({
      data: { user: { id: 'RACE-USER', email: 'race@example.com' } },
      error: null,
    })
    mockState.queue('profiles', { data: null, error: null })
    mockState.queue('tenant_memberships', {
      data: null,
      error: { message: 'duplicate key', code: '23505' },
    })

    const res = await inviteUser(
      jsonRequest('POST', { email: 'race@example.com', fullName: 'Race User' }),
    )

    expect(res.status).toBe(409)
    expect(authAdminMock.deleteUser).toHaveBeenCalledWith('RACE-USER')
    expect(mockState.inserts.some(i => i.table === 'members')).toBe(false)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })
})
