// POST /api/admin/users/[userId]/resend-invite
//
// The tenant-admin escape hatch for invites that land in a junk folder:
// re-send the email, or mint the link and hand it back so the admin can
// share it themselves. Both paths mint a fresh single-use token.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authAdminMock,
  ctxFor,
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

import { POST as resendInvite } from '@/app/api/admin/users/[userId]/resend-invite/route'

const PENDING_USER = '11111111-2222-3333-4444-555555555555'

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

/** Membership lookup + the reactivate UPDATE both drain this table's queue. */
function queueMembership(row: Record<string, unknown> | null) {
  mockState.queue('tenant_memberships', { data: row, error: null })
  mockState.queue('tenant_memberships', { data: null, error: null })
}

function signedInNever(email: string | null = 'pending@example.com') {
  authAdminMock.getUserById.mockResolvedValue({
    data: { user: { id: PENDING_USER, email, last_sign_in_at: null } },
    error: null,
  })
}

describe('POST /api/admin/users/[userId]/resend-invite', () => {
  beforeEach(() => {
    resetMocks()
    // resetMocks() only knows about the superadmin gate; without this the
    // tenant gate's call history leaks between tests.
    requireTenantAdminMock.mockReset()
    tenantAdminOk()
    // The in-memory limiter is a module-level global; a shared bucket would
    // leak the previous test's call count into this one.
    ;(globalThis as { __soteriaMemoryRateLimits?: unknown }).__soteriaMemoryRateLimits = undefined
  })

  it('mints a fresh single-use link and emails it by default', async () => {
    queueMembership({ user_id: PENDING_USER, invite_cancelled_at: null })
    signedInNever()
    mockState.queue('tenants', { data: { id: 'T1', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: { full_name: 'Pending Person' }, error: null })

    const res = await resendInvite(jsonRequest('POST'), ctxFor({ userId: PENDING_USER }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inviteUrl).toContain('/accept-invite?token=')
    expect(body.emailSent).toBe(true)
    expect(body.email).toBe('pending@example.com')
    expect(body.expiresAt).toBeTruthy()

    const emailArgs = sendInviteEmailMock.mock.calls[0]![0] as Record<string, unknown>
    expect(emailArgs.to).toBe('pending@example.com')
    expect(emailArgs.inviteUrl).toBe(body.inviteUrl)
    expect(emailArgs.tenantName).toBe('Snak King')

    // Only the hash is stored, and the row records who re-issued it.
    const tokenInsert = mockState.inserts.find(i => i.table === 'invite_tokens')!
    const payload = tokenInsert.payload as Record<string, unknown>
    expect(payload).toMatchObject({ user_id: PENDING_USER, tenant_id: 'T1', created_by: 'admin-1' })
    const rawToken = (body.inviteUrl as string).split('token=')[1]!
    expect(payload.token_hash).not.toContain(rawToken)
  })

  it('sendEmail:false returns the link and sends nothing', async () => {
    queueMembership({ user_id: PENDING_USER, invite_cancelled_at: null })
    signedInNever()
    mockState.queue('tenants', { data: { id: 'T1', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: { full_name: 'Pending Person' }, error: null })

    const res = await resendInvite(
      jsonRequest('POST', { sendEmail: false }),
      ctxFor({ userId: PENDING_USER }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inviteUrl).toContain('/accept-invite?token=')
    expect(body.emailSent).toBe(false)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
    // The link is still real — a token row was written for it.
    expect(mockState.inserts.some(i => i.table === 'invite_tokens')).toBe(true)
  })

  it('reactivates a cron-cancelled invite so the fresh link does not dead-end', async () => {
    queueMembership({ user_id: PENDING_USER, invite_cancelled_at: '2026-01-01T00:00:00Z' })
    signedInNever()
    mockState.queue('tenants', { data: { id: 'T1', name: 'Snak King' }, error: null })
    mockState.queue('profiles', { data: { full_name: 'Pending Person' }, error: null })

    const res = await resendInvite(jsonRequest('POST'), ctxFor({ userId: PENDING_USER }))

    expect(res.status).toBe(200)
    const update = mockState.updates.find(u => u.table === 'tenant_memberships')!
    expect(update.payload).toMatchObject({
      invite_cancelled_at:     null,
      invite_cancelled_reason: null,
      invite_reminders_sent:   0,
    })
    // Anchored to now, not nulled — otherwise the daily cron would fire a
    // reminder the morning after the resend.
    expect((update.payload as { invite_last_reminder_at: string }).invite_last_reminder_at).toBeTruthy()
  })

  it('404s for a user who is not a member of the active tenant', async () => {
    queueMembership(null)

    const res = await resendInvite(jsonRequest('POST'), ctxFor({ userId: PENDING_USER }))

    expect(res.status).toBe(404)
    // Nothing was minted for a user outside the caller's tenant.
    expect(mockState.inserts.some(i => i.table === 'invite_tokens')).toBe(false)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('409s once the invitee has signed in — a new link would be a password reset', async () => {
    queueMembership({ user_id: PENDING_USER, invite_cancelled_at: null })
    authAdminMock.getUserById.mockResolvedValue({
      data: { user: { id: PENDING_USER, email: 'active@example.com', last_sign_in_at: '2026-07-01T00:00:00Z' } },
      error: null,
    })

    const res = await resendInvite(jsonRequest('POST'), ctxFor({ userId: PENDING_USER }))

    expect(res.status).toBe(409)
    expect(mockState.inserts.some(i => i.table === 'invite_tokens')).toBe(false)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('404s when the account has no email on file', async () => {
    queueMembership({ user_id: PENDING_USER, invite_cancelled_at: null })
    signedInNever(null)

    const res = await resendInvite(jsonRequest('POST'), ctxFor({ userId: PENDING_USER }))

    expect(res.status).toBe(404)
    expect(mockState.inserts.some(i => i.table === 'invite_tokens')).toBe(false)
  })

  it('rejects a malformed user id before doing any work', async () => {
    const res = await resendInvite(jsonRequest('POST'), ctxFor({ userId: 'not-a-uuid' }))

    expect(res.status).toBe(400)
    expect(requireTenantAdminMock).not.toHaveBeenCalled()
  })

  it('rate-limits repeated resends for the same person', async () => {
    for (let attempt = 0; attempt < 7; attempt++) {
      queueMembership({ user_id: PENDING_USER, invite_cancelled_at: null })
      mockState.queue('tenants', { data: { id: 'T1', name: 'Snak King' }, error: null })
      mockState.queue('profiles', { data: { full_name: 'Pending Person' }, error: null })
    }
    signedInNever()

    const statuses: number[] = []
    for (let attempt = 0; attempt < 7; attempt++) {
      const res = await resendInvite(jsonRequest('POST'), ctxFor({ userId: PENDING_USER }))
      statuses.push(res.status)
    }

    expect(statuses.slice(0, 6)).toEqual([200, 200, 200, 200, 200, 200])
    expect(statuses[6]).toBe(429)
  })
})
