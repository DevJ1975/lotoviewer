// Regression: issuing access must restart the invite lifecycle, not just
// mint a token.
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

/** The membership update issued by restartInviteLifecycle, if any. */
function membershipUpdate() {
  return mockState.updates.find(u => u.table === 'tenant_memberships')
}

describe('issueAndSendInvite — restarts the invite lifecycle', () => {
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
    // Cleared, not stamped: planInviteAction falls back to the invite's own
    // timestamp when there is no prior reminder, and the token minted by
    // this very call is the honest anchor for a lifecycle starting over.
    expect(payload.invite_last_reminder_at).toBeNull()
  })

  // The reset-access route re-invites people who are NOT cancelled — the
  // worker who lost their phone, or whose password was rotated. Scoping the
  // restart to cancelled memberships left those invites carrying the old
  // reminder bookkeeping, so the cadence for the new invite was wrong from
  // the first run.
  it('restarts the lifecycle for a membership that was never cancelled', async () => {
    mockState.queue('invite_tokens', { data: { id: 'tok-1' }, error: null })

    await issueAndSendInvite(mockState.buildAdmin() as never, baseArgs('invite_link'))

    expect(membershipUpdate()!.payload).toMatchObject({
      invite_reminders_sent:   0,
      invite_last_reminder_at: null,
    })
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
