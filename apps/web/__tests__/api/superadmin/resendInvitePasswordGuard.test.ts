// Resend Invite must never rotate a password the user already chose.
//
// The route's guard used to test `last_sign_in_at` alone. That is not the
// same question as "does this person have a working password":
// /api/invites/accept sets the password and clears must_change_password but
// does NOT establish a session — the client signs in separately afterwards,
// and that is what stamps last_sign_in_at. So a user whose accept succeeded
// and whose follow-up sign-in did not has a WORKING password and a null
// last_sign_in_at, and the superadmin UI lists them as "Invited".
//
// On the old guard, resending at that row silently rotated their password
// and set must_change_password back to true — the exact "a set password
// stopped working" outcome the product forbids.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  authAdminMock, gateOk, mockState, resetMocks, jsonRequest, ctxFor,
} from './_helpers'
import { POST as resendInvite } from '@/app/api/superadmin/tenants/[number]/members/[user_id]/resend-invite/route'

const USER_ID = '11111111-2222-3333-4444-555555555555'

/** Queue the two reads every call makes before the guard is reached. */
function seedTenantAndMembership() {
  mockState.queue('tenants',            { data: { id: 'T1', tenant_number: '0001', name: 'Snak King' }, error: null })
  mockState.queue('tenant_memberships', { data: { user_id: USER_ID }, error: null })
}

function authRow(lastSignInAt: string | null) {
  authAdminMock.getUserById.mockResolvedValue({
    data: { user: { id: USER_ID, email: 'member@example.com', last_sign_in_at: lastSignInAt } },
    error: null,
  })
}

const call = () => resendInvite(jsonRequest('POST'), ctxFor({ number: '0001', user_id: USER_ID }))

describe('resend-invite — refuses to rotate a password the user already set', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('409s when must_change_password is false, even with a null last_sign_in_at', async () => {
    seedTenantAndMembership()
    authRow(null)                     // never completed a browser sign-in...
    mockState.queue('profiles', { data: { full_name: 'Ann Ng', must_change_password: false }, error: null })  // ...but chose a password

    const r = await call()

    expect(r.status).toBe(409)
    expect((await r.json()).error).toMatch(/already set their password/i)
    // The two writes that would break their login must not have happened.
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
    expect(mockState.updates.find(u => u.table === 'profiles')).toBeUndefined()
  })

  it('still 409s on the original signal — a completed sign-in', async () => {
    seedTenantAndMembership()
    authRow('2026-08-01T10:00:00Z')
    mockState.queue('profiles', { data: { full_name: 'Bob Ng', must_change_password: true }, error: null })

    const r = await call()

    expect(r.status).toBe(409)
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('proceeds for a genuine pending invitee (flag true, never signed in)', async () => {
    seedTenantAndMembership()
    authRow(null)
    mockState.queue('profiles', { data: { full_name: 'Cy Ng', must_change_password: true }, error: null })
    authAdminMock.updateUserById.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })

    const r = await call()

    expect(r.status).toBe(200)
    expect(authAdminMock.updateUserById).toHaveBeenCalledWith(USER_ID, { password: 'TempPass123!' })
    expect(mockState.updates.find(u => u.table === 'profiles')?.payload)
      .toMatchObject({ must_change_password: true })
  })

  it('proceeds when the profile row is missing — setup never completed', async () => {
    seedTenantAndMembership()
    authRow(null)
    mockState.queue('profiles', { data: null, error: null })
    authAdminMock.updateUserById.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })

    const r = await call()

    expect(r.status).toBe(200)
    expect(authAdminMock.updateUserById).toHaveBeenCalled()
  })

  it('proceeds when the flag is null — a drifted row is still a pending invite', async () => {
    seedTenantAndMembership()
    authRow(null)
    mockState.queue('profiles', { data: { full_name: 'Dee Ng', must_change_password: null }, error: null })
    authAdminMock.updateUserById.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })

    const r = await call()

    expect(r.status).toBe(200)
    expect(authAdminMock.updateUserById).toHaveBeenCalled()
  })
})
