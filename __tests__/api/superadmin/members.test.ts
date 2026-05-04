import { describe, it, expect, beforeEach } from 'vitest'
import {
  authAdminMock, gateOk, gateRejects, mockState, resetMocks,
  jsonRequest, emptyRequest, ctxFor, sendInviteEmailMock,
} from './_helpers'
import { POST as inviteMember, GET as listMembers } from '@/app/api/superadmin/tenants/[number]/members/route'
import { PATCH as changeRole, DELETE as removeMember }
  from '@/app/api/superadmin/tenants/[number]/members/[user_id]/route'

describe('GET /api/superadmin/tenants/[number]/members', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('returns 401 when the gate rejects', async () => {
    gateRejects(401, 'Missing bearer token')
    const r = await listMembers(emptyRequest('GET'), ctxFor({ number: '0001' }))
    expect(r.status).toBe(401)
  })

  it('returns 404 when the tenant_number is unknown', async () => {
    mockState.queue('tenants', { data: null, error: null })
    const r = await listMembers(emptyRequest('GET'), ctxFor({ number: '9999' }))
    expect(r.status).toBe(404)
  })

  it('enriches each membership with status from auth.users.last_sign_in_at', async () => {
    mockState.queue('tenants', { data: { id: 'T1', tenant_number: '0001' }, error: null })
    mockState.queue('tenant_memberships', {
      data: [
        { user_id: 'U1', role: 'owner',  created_at: '2024-01-01T00:00:00Z',
          profiles: { email: 'o@x.com', full_name: 'Owner', is_admin: true,  is_superadmin: true,  must_change_password: false } },
        { user_id: 'U2', role: 'member', created_at: '2024-02-01T00:00:00Z',
          profiles: { email: 'm@x.com', full_name: null,    is_admin: false, is_superadmin: false, must_change_password: true } },
      ],
      error: null,
    })
    authAdminMock.listUsers.mockResolvedValue({
      data: { users: [
        { id: 'U1', last_sign_in_at: '2024-04-01T00:00:00Z' },
        { id: 'U2', last_sign_in_at: null },  // Invited only
      ] },
      error: null,
    })
    const r = await listMembers(emptyRequest('GET'), ctxFor({ number: '0001' }))
    expect(r.status).toBe(200)
    const body = await r.json()
    const byId = Object.fromEntries(body.members.map((m: { user_id: string }) => [m.user_id, m])) as Record<string, { status: string; last_sign_in_at: string | null }>
    expect(byId.U1!.status).toBe('active')
    expect(byId.U1!.last_sign_in_at).toBe('2024-04-01T00:00:00Z')
    expect(byId.U2!.status).toBe('invited')
    expect(byId.U2!.last_sign_in_at).toBeNull()
  })
})

describe('POST /api/superadmin/tenants/[number]/members (invite)', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('rejects an invalid email with 400', async () => {
    const r = await inviteMember(jsonRequest('POST', { email: 'not-an-email', role: 'member' }), ctxFor({ number: '0001' }))
    expect(r.status).toBe(400)
  })

  it('rejects an invalid role with 400', async () => {
    const r = await inviteMember(jsonRequest('POST', { email: 'a@x.com', role: 'wizard' }), ctxFor({ number: '0001' }))
    expect(r.status).toBe(400)
  })

  it('returns 404 when the tenant does not exist', async () => {
    mockState.queue('tenants', { data: null, error: null })
    const r = await inviteMember(jsonRequest('POST', { email: 'a@x.com', role: 'member' }), ctxFor({ number: '9999' }))
    expect(r.status).toBe(404)
  })

  it('existing user: skips auth.createUser AND skips email send', async () => {
    mockState.queue('tenants',  { data: { id: 'T1', tenant_number: '0001', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: { id: 'U1', email: 'jane@x.com' }, error: null })
    mockState.queue('tenant_memberships', { data: null, error: null })  // insert succeeds
    const r = await inviteMember(jsonRequest('POST', { email: 'jane@x.com', role: 'member' }), ctxFor({ number: '0001' }))
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.alreadyExisted).toBe(true)
    expect(body.tempPassword).toBeUndefined()
    expect(authAdminMock.createUser).not.toHaveBeenCalled()
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('new user: creates auth row, patches profile, sends email, returns tempPassword', async () => {
    mockState.queue('tenants',  { data: { id: 'T1', tenant_number: '0001', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: null, error: null })
    authAdminMock.createUser.mockResolvedValue({
      data: { user: { id: 'NEW', email: 'jane@x.com' } },
      error: null,
    })
    mockState.queue('profiles', { data: null, error: null })             // profile patch
    mockState.queue('tenant_memberships', { data: null, error: null })   // membership insert
    const r = await inviteMember(jsonRequest('POST', { email: 'jane@x.com', role: 'member', full_name: 'Jane' }), ctxFor({ number: '0001' }))
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.alreadyExisted).toBe(false)
    expect(body.tempPassword).toBe('TempPass123!')
    expect(body.emailSent).toBe(true)
    expect(authAdminMock.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@x.com' }))
    expect(sendInviteEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to:           'jane@x.com',
      tenantName:   'Snak King',
      tempPassword: 'TempPass123!',
    }))
  })

  it('returns 409 when membership already exists (PG 23505 on insert)', async () => {
    mockState.queue('tenants',  { data: { id: 'T1', tenant_number: '0001', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: { id: 'U1', email: 'jane@x.com' }, error: null })
    mockState.queue('tenant_memberships', { data: null, error: { message: 'dup', code: '23505' } })
    const r = await inviteMember(jsonRequest('POST', { email: 'jane@x.com', role: 'member' }), ctxFor({ number: '0001' }))
    expect(r.status).toBe(409)
  })
})

describe('PATCH /api/superadmin/tenants/[number]/members/[user_id] (role change)', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('rejects an invalid role with 400', async () => {
    const r = await changeRole(jsonRequest('PATCH', { role: 'wizard' }), ctxFor({ number: '0001', user_id: 'U1' }))
    expect(r.status).toBe(400)
  })

  it('returns 404 when the membership does not exist', async () => {
    mockState.queue('tenants',            { data: { id: 'T1', tenant_number: '0001' }, error: null })
    mockState.queue('tenant_memberships', { data: null, error: null })  // membership lookup
    const r = await changeRole(jsonRequest('PATCH', { role: 'admin' }), ctxFor({ number: '0001', user_id: 'U1' }))
    expect(r.status).toBe(404)
  })

  it('refuses to demote the last owner with 409', async () => {
    mockState.queue('tenants',            { data: { id: 'T1', tenant_number: '0001' }, error: null })
    mockState.queue('tenant_memberships', { data: { user_id: 'U1', tenant_id: 'T1', role: 'owner' }, error: null })
    // ownerCount(): chain ends with .eq.eq → terminal. Queue count=1.
    mockState.queue('tenant_memberships', { data: null, count: 1, error: null })
    const r = await changeRole(jsonRequest('PATCH', { role: 'member' }), ctxFor({ number: '0001', user_id: 'U1' }))
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toMatch(/last owner/i)
  })

  it('happy path: updates the role and returns the new membership', async () => {
    mockState.queue('tenants',            { data: { id: 'T1', tenant_number: '0001' }, error: null })
    mockState.queue('tenant_memberships', { data: { user_id: 'U1', tenant_id: 'T1', role: 'member' }, error: null })
    mockState.queue('tenant_memberships', { data: { user_id: 'U1', tenant_id: 'T1', role: 'admin', created_at: '', updated_at: '' }, error: null })
    const r = await changeRole(jsonRequest('PATCH', { role: 'admin' }), ctxFor({ number: '0001', user_id: 'U1' }))
    expect(r.status).toBe(200)
    const update = mockState.updates[0]!.payload as Record<string, unknown>
    expect(update.role).toBe('admin')
  })

  it('no-op when the role is unchanged', async () => {
    mockState.queue('tenants',            { data: { id: 'T1', tenant_number: '0001' }, error: null })
    mockState.queue('tenant_memberships', { data: { user_id: 'U1', tenant_id: 'T1', role: 'member' }, error: null })
    const r = await changeRole(jsonRequest('PATCH', { role: 'member' }), ctxFor({ number: '0001', user_id: 'U1' }))
    expect(r.status).toBe(200)
    expect(mockState.updates).toHaveLength(0)  // never wrote
  })
})

describe('DELETE /api/superadmin/tenants/[number]/members/[user_id]', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('refuses to remove the last owner with 409', async () => {
    mockState.queue('tenants',            { data: { id: 'T1', tenant_number: '0001' }, error: null })
    mockState.queue('tenant_memberships', { data: { user_id: 'U1', tenant_id: 'T1', role: 'owner' }, error: null })
    mockState.queue('tenant_memberships', { data: null, count: 1, error: null })  // ownerCount
    const r = await removeMember(emptyRequest('DELETE'), ctxFor({ number: '0001', user_id: 'U1' }))
    expect(r.status).toBe(409)
  })

  it('happy path: deletes the membership only (auth.user untouched)', async () => {
    mockState.queue('tenants',            { data: { id: 'T1', tenant_number: '0001' }, error: null })
    mockState.queue('tenant_memberships', { data: { user_id: 'U1', tenant_id: 'T1', role: 'member' }, error: null })
    mockState.queue('tenant_memberships', { data: null, error: null })  // delete
    const r = await removeMember(emptyRequest('DELETE'), ctxFor({ number: '0001', user_id: 'U1' }))
    expect(r.status).toBe(200)
    expect(authAdminMock.deleteUser).not.toHaveBeenCalled()
    const body = await r.json()
    expect(body.userDeleted).toBe(false)
  })

  it('cancel-invite: deletes the auth.user when never-signed-in AND no other memberships', async () => {
    const url = new URL('http://x/api/superadmin/tenants/0001/members/U1')
    url.searchParams.set('cancel-invite', 'true')
    const req = new Request(url.toString(), { method: 'DELETE', headers: { Authorization: 'Bearer t' } })

    mockState.queue('tenants',            { data: { id: 'T1', tenant_number: '0001' }, error: null })
    mockState.queue('tenant_memberships', { data: { user_id: 'U1', tenant_id: 'T1', role: 'member' }, error: null })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: null } } })
    mockState.queue('tenant_memberships', { data: null, count: 0, error: null })  // other memberships
    mockState.queue('tenant_memberships', { data: null, error: null })  // delete
    authAdminMock.deleteUser.mockResolvedValue({ error: null })

    const r = await removeMember(req, ctxFor({ number: '0001', user_id: 'U1' }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.userDeleted).toBe(true)
    expect(authAdminMock.deleteUser).toHaveBeenCalledWith('U1')
  })

  it('cancel-invite: skips auth.user delete when the user has signed in elsewhere', async () => {
    const url = new URL('http://x/api/superadmin/tenants/0001/members/U1')
    url.searchParams.set('cancel-invite', 'true')
    const req = new Request(url.toString(), { method: 'DELETE', headers: { Authorization: 'Bearer t' } })

    mockState.queue('tenants',            { data: { id: 'T1', tenant_number: '0001' }, error: null })
    mockState.queue('tenant_memberships', { data: { user_id: 'U1', tenant_id: 'T1', role: 'member' }, error: null })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: '2024-01-01' } } })  // has signed in
    mockState.queue('tenant_memberships', { data: null, count: 0, error: null })
    mockState.queue('tenant_memberships', { data: null, error: null })  // delete

    const r = await removeMember(req, ctxFor({ number: '0001', user_id: 'U1' }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.userDeleted).toBe(false)
    expect(authAdminMock.deleteUser).not.toHaveBeenCalled()
  })
})
