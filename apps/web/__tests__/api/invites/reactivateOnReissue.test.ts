// Regression: a soft-cancelled invite must be reactivated when an admin
// re-issues access.
//
// The bug this locks down was live in production. The invite-reminders cron
// stamps `invite_cancelled_at` after four ignored reminders, and
// /api/invites/{validate,accept,refresh} all refuse a cancelled membership.
// No code path cleared that stamp, so an admin could grant access, mint a
// perfectly valid token, email it — and the invitee still hit "this
// invitation was cancelled", permanently, with no recovery short of editing
// the database by hand.

import { beforeEach, describe, expect, it } from 'vitest'
import { authAdminMock, mockState, resetMocks, sendInviteEmailMock } from '../superadmin/_helpers'

import { issueAndSendInvite } from '@/lib/invites/provision'

const TENANT = '00000000-0000-0000-0000-0000000000aa'
const USER   = '00000000-0000-0000-0000-0000000000bb'

function req(): Request {
  return new Request('https://soteriafield.app/api/x', { method: 'POST' })
}

function baseArgs(emailMode: 'invite_link' | 'added_notification') {
  return {
    userId:     USER,
    email:      'worker@example.com',
    fullName:   'Worker One',
    tenantId:   TENANT,
    tenantName: 'Snak King',
    createdBy:  'admin-1',
    req:        req(),
    emailMode,
  }
}

/** The membership update issued by reactivateInvite, if any. */
function membershipUpdate() {
  return mockState.updates.find(u => u.table === 'tenant_memberships')
}

describe('issueAndSendInvite — reactivates a cancelled invite', () => {
  beforeEach(() => {
    resetMocks()
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { id: USER } }, error: null })
  })

  it('clears the cancel stamp when issuing a fresh invite link', async () => {
    mockState.queue('invite_tokens', { data: { id: 'tok-1' }, error: null })

    await issueAndSendInvite(mockState.buildAdmin() as never, baseArgs('invite_link'))

    const update = membershipUpdate()
    expect(update).toBeDefined()
    expect(update!.payload).toMatchObject({
      invite_cancelled_at:     null,
      invite_cancelled_reason: null,
    })
  })

  // Leaving the counter at the maximum means the very next cron run walks
  // straight past send_reminder into cancel again — reviving the invite for
  // less than a day.
  it('resets the reminder counter so the cron cannot immediately re-cancel', async () => {
    mockState.queue('invite_tokens', { data: { id: 'tok-1' }, error: null })

    await issueAndSendInvite(mockState.buildAdmin() as never, baseArgs('invite_link'))

    const payload = membershipUpdate()!.payload as Record<string, unknown>
    expect(payload.invite_reminders_sent).toBe(0)
    // Anchors planInviteAction's cadence, so the first nudge is a full
    // interval away rather than firing on the next run.
    expect(typeof payload.invite_last_reminder_at).toBe('string')
  })

  it('also reactivates on the added_notification path', async () => {
    await issueAndSendInvite(mockState.buildAdmin() as never, baseArgs('added_notification'))

    expect(membershipUpdate()).toBeDefined()
    expect(membershipUpdate()!.payload).toMatchObject({ invite_cancelled_at: null })
  })

  // The invite is already valid at this point; a failed flag-clear must not
  // sink the request and strand the admin with no link at all.
  it('still sends the invite when the reactivation write fails', async () => {
    mockState.queue('tenant_memberships', { data: null, error: { message: 'db down' } })
    mockState.queue('invite_tokens', { data: { id: 'tok-1' }, error: null })

    const result = await issueAndSendInvite(mockState.buildAdmin() as never, baseArgs('invite_link'))

    expect(result.inviteUrl).toContain('/accept-invite?token=')
    expect(sendInviteEmailMock).toHaveBeenCalled()
  })
})
