import { describe, it, expect, beforeEach } from 'vitest'
import {
  authAdminMock, gateOk, generateLinkOk, mockState, resetMocks,
  sendVerifyInviteEmailMock, emptyRequest, ctxFor,
} from './_helpers'
import { POST as resendInvite } from '@/app/api/superadmin/tenants/[number]/members/[user_id]/resend-invite/route'

const USER = '00000000-0000-0000-0000-0000000000aa'

function seedTenantAndMembership() {
  mockState.queue('tenants', { data: { id: 'T1', tenant_number: '0001', name: 'Snak King' }, error: null })
  mockState.queue('tenant_memberships', { data: { user_id: USER }, error: null })
}

describe('POST .../members/[user_id]/resend-invite', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('re-issues a fresh verify link (no password rotation) for a user still onboarding', async () => {
    seedTenantAndMembership()
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { email: 'pending@x.com' } } })
    mockState.queue('profiles', { data: { full_name: 'Pending User', must_change_password: true }, error: null })
    generateLinkOk(USER, 'pending@x.com', 'https://supabase.test/verify?token=fresh')
    mockState.queue('profiles', { data: null, error: null })  // must_change_password re-assert

    const r = await resendInvite(emptyRequest('POST'), ctxFor({ number: '0001', user_id: USER }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ ok: true, email: 'pending@x.com', emailSent: true })
    expect(body.tempPassword).toBeUndefined()

    // No secret is rotated — the link is the credential.
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
    expect(authAdminMock.generateLink).toHaveBeenCalledWith(expect.objectContaining({ email: 'pending@x.com' }))
    expect(sendVerifyInviteEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'pending@x.com', tenantName: 'Snak King', verifyUrl: 'https://supabase.test/verify?token=fresh',
    }))
  })

  it('refuses with 409 when the user already chose their own password', async () => {
    seedTenantAndMembership()
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { email: 'active@x.com' } } })
    mockState.queue('profiles', { data: { full_name: 'Active User', must_change_password: false }, error: null })

    const r = await resendInvite(emptyRequest('POST'), ctxFor({ number: '0001', user_id: USER }))
    expect(r.status).toBe(409)
    expect((await r.json()).error).toMatch(/already activated/i)
    expect(authAdminMock.generateLink).not.toHaveBeenCalled()
    expect(sendVerifyInviteEmailMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the auth user has no email on file', async () => {
    seedTenantAndMembership()
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { email: null } } })

    const r = await resendInvite(emptyRequest('POST'), ctxFor({ number: '0001', user_id: USER }))
    expect(r.status).toBe(404)
    expect(authAdminMock.generateLink).not.toHaveBeenCalled()
  })
})
