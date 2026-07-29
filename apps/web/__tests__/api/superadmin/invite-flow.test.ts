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
  authAdminMock, gateOk, generateLinkOk, mockState, resetMocks,
  sendInviteEmailMock, sendVerifyInviteEmailMock, jsonRequest, ctxFor,
} from './_helpers'
import { POST as inviteMember } from '@/app/api/superadmin/tenants/[number]/members/route'

describe('Member invite flow — end-to-end happy paths', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('NEW USER: generates a verify link → upserts profile → inserts membership → emails the link (no temp password)', async () => {
    mockState.queue('tenants',  { data: { id: 'T1', tenant_number: '0001', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: null, error: null })  // no existing profile
    generateLinkOk('NEW-UUID', 'new@example.com', 'https://supabase.test/verify?token=abc')
    mockState.queue('profiles',           { data: null, error: null })  // profile upsert
    mockState.queue('tenant_memberships', { data: null, error: null })  // membership insert

    const r = await inviteMember(
      jsonRequest('POST', { email: 'new@example.com', role: 'member', full_name: 'New User' }),
      ctxFor({ number: '0001' }),
    )
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.alreadyExisted).toBe(false)
    expect(body.emailSent).toBe(true)
    // No credential ever leaves the server in the response.
    expect(body.tempPassword).toBeUndefined()

    // We never mint a pre-confirmed account — verification is via the link.
    expect(authAdminMock.createUser).not.toHaveBeenCalled()
    expect(authAdminMock.generateLink).toHaveBeenCalledWith(expect.objectContaining({
      type:    'invite',
      email:   'new@example.com',
      options: expect.objectContaining({
        data:       { full_name: 'New User' },
        redirectTo: 'https://soteriafield.app/welcome',
      }),
    }))
    // The verify link is emailed; the temp-password sender is NOT used here.
    expect(sendVerifyInviteEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to:         'new@example.com',
      tenantName: 'Snak King',
      verifyUrl:  'https://supabase.test/verify?token=abc',
    }))
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
    // Profile is upserted with the onboarding flag set.
    const profileUpsert = mockState.upserts.find(u => u.table === 'profiles')
    expect(profileUpsert!.payload).toMatchObject({ id: 'NEW-UUID', must_change_password: true })
    // Membership insert payload includes the inviter's user id.
    const membershipInsert = mockState.inserts.find(i => i.table === 'tenant_memberships')
    expect(membershipInsert).toBeTruthy()
    expect(membershipInsert!.payload).toMatchObject({
      user_id: 'NEW-UUID', tenant_id: 'T1', role: 'member', invited_by: 'super-1',
    })
  })

  it('EXISTING USER: skips the verify link, sends the "added to tenant" notification, returns alreadyExisted', async () => {
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
    expect(authAdminMock.generateLink).not.toHaveBeenCalled()
    expect(sendVerifyInviteEmailMock).not.toHaveBeenCalled()
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
