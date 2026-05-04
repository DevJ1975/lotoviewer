// End-to-end-style invite flow test. Walks the full happy paths the
// user reported as flaky:
//   1. Invite a brand-new user → membership inserted, email sent with
//      temp password, response carries emailSent=true + tempPassword
//   2. Invite an existing user (already in profiles) → no createUser,
//      no temp password, but notification email STILL sent
//   3. Try to invite the same email twice → second attempt 409s with a
//      "already a member" error
//
// This is a complement to members.test.ts: that file tests each branch
// in isolation; this one verifies the branches compose end-to-end.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  authAdminMock, gateOk, mockState, resetMocks, sendInviteEmailMock,
  jsonRequest, ctxFor,
} from './_helpers'
import { POST as inviteMember } from '@/app/api/superadmin/tenants/[number]/members/route'

describe('Member invite flow — end-to-end happy paths', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('NEW USER: creates auth row → patches profile → inserts membership → emails invite with temp password', async () => {
    mockState.queue('tenants',  { data: { id: 'T1', tenant_number: '0001', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: null, error: null })  // no existing profile
    authAdminMock.createUser.mockResolvedValue({
      data: { user: { id: 'NEW-UUID', email: 'new@example.com' } },
      error: null,
    })
    mockState.queue('profiles',           { data: null, error: null })  // profile patch
    mockState.queue('tenant_memberships', { data: null, error: null })  // membership insert

    const r = await inviteMember(
      jsonRequest('POST', { email: 'new@example.com', role: 'member', full_name: 'New User' }),
      ctxFor({ number: '0001' }),
    )
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.alreadyExisted).toBe(false)
    expect(body.tempPassword).toBeTruthy()
    expect(body.emailSent).toBe(true)

    // Verify the side-effects fired in the right order with the right
    // payloads.
    expect(authAdminMock.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email:         'new@example.com',
      email_confirm: true,
      user_metadata: { full_name: 'New User' },
    }))
    expect(sendInviteEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to:           'new@example.com',
      tenantName:   'Snak King',
      tempPassword: 'TempPass123!',  // from generateTempPassword mock
    }))
    // Membership insert payload includes the inviter's user id.
    const membershipInsert = mockState.inserts.find(i => i.table === 'tenant_memberships')
    expect(membershipInsert).toBeTruthy()
    expect(membershipInsert!.payload).toMatchObject({
      user_id: 'NEW-UUID', tenant_id: 'T1', role: 'member', invited_by: 'super-1',
    })
  })

  it('EXISTING USER: skips createUser, sends notification email with empty password, returns alreadyExisted', async () => {
    mockState.queue('tenants',  { data: { id: 'T1', tenant_number: '0001', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: { id: 'EXISTING-UUID', email: 'jane@x.com' }, error: null })
    mockState.queue('tenant_memberships', { data: null, error: null })

    const r = await inviteMember(
      jsonRequest('POST', { email: 'jane@x.com', role: 'admin' }),
      ctxFor({ number: '0001' }),
    )
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.alreadyExisted).toBe(true)
    expect(body.tempPassword).toBeUndefined()
    expect(body.emailSent).toBe(true)

    expect(authAdminMock.createUser).not.toHaveBeenCalled()
    // The notification path: empty tempPassword triggers the
    // "you've been added to {tenant}" template.
    expect(sendInviteEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to:           'jane@x.com',
      tenantName:   'Snak King',
      tempPassword: '',
    }))
  })

  it('DUPLICATE: same email invited twice → second attempt returns 409', async () => {
    // First call — succeeds.
    mockState.queue('tenants',  { data: { id: 'T1', tenant_number: '0001', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: { id: 'U1', email: 'jane@x.com' }, error: null })
    mockState.queue('tenant_memberships', { data: null, error: null })  // first insert ok

    const r1 = await inviteMember(
      jsonRequest('POST', { email: 'jane@x.com', role: 'member' }),
      ctxFor({ number: '0001' }),
    )
    expect(r1.status).toBe(201)

    // Second call — same email, PG raises 23505 unique_violation on the
    // (user_id, tenant_id) PK.
    mockState.queue('tenants',  { data: { id: 'T1', tenant_number: '0001', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: { id: 'U1', email: 'jane@x.com' }, error: null })
    mockState.queue('tenant_memberships', {
      data: null, error: { message: 'duplicate key', code: '23505' },
    })

    const r2 = await inviteMember(
      jsonRequest('POST', { email: 'jane@x.com', role: 'member' }),
      ctxFor({ number: '0001' }),
    )
    expect(r2.status).toBe(409)
    const body = await r2.json()
    expect(body.error).toMatch(/already a member/i)
  })
})
