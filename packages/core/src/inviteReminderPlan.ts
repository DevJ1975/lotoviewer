// Pure decision logic for the invite-reminder lifecycle. No I/O, no DOM,
// no Node — safe to share between the web cron and any future caller.
//
// An invited user who has never signed in receives up to four weekly
// reminder emails. If they still have not signed in roughly a week after
// the fourth reminder, the invite is SOFT-CANCELLED: the membership row is
// retained (an admin can reactivate it) and nothing is deleted.
//
// The cron runs daily and calls planInviteAction() for each un-cancelled
// membership. The 7-day gates make the daily cadence settle into a weekly
// rhythm — a reminder sent today won't fire again until a week has passed.

export const INVITE_REMINDER_INTERVAL_DAYS = 7
export const INVITE_MAX_REMINDERS = 4

export interface InviteReminderState {
  /** tenant_memberships.created_at — when the invite was issued. */
  invitedAt: string | Date
  /** auth.users.last_sign_in_at — null/undefined means never signed in. */
  lastSignInAt: string | Date | null | undefined
  /** tenant_memberships.invite_reminders_sent. */
  remindersSent: number
  /** tenant_memberships.invite_last_reminder_at. */
  lastReminderAt: string | Date | null | undefined
  /** tenant_memberships.invite_cancelled_at — non-null = already cancelled. */
  cancelledAt: string | Date | null | undefined
}

export type InviteReminderAction =
  | { kind: 'none'; reason: NoneReason }
  | { kind: 'send_reminder'; reminderNumber: number }
  | { kind: 'cancel'; reason: 'no_signup_after_max_reminders' }

export type NoneReason =
  | 'already_cancelled'
  | 'already_signed_in'
  | 'missing_invited_at'
  | 'too_soon'

const DAY_MS = 24 * 60 * 60 * 1000

function toMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Decide what the cron should do with a single pending invite.
 *
 * Cadence (invite issued on day 0, never signed in):
 *   day  7 → send_reminder #1
 *   day 14 → send_reminder #2
 *   day 21 → send_reminder #3
 *   day 28 → send_reminder #4
 *   day 35 → cancel  (a full interval after the 4th reminder)
 */
export function planInviteAction(
  state: InviteReminderState,
  now: Date = new Date(),
): InviteReminderAction {
  // Already cancelled → terminal.
  if (toMs(state.cancelledAt) != null) {
    return { kind: 'none', reason: 'already_cancelled' }
  }

  // Signed in → invite accepted; the lifecycle is over.
  if (toMs(state.lastSignInAt) != null) {
    return { kind: 'none', reason: 'already_signed_in' }
  }

  const invitedMs = toMs(state.invitedAt)
  if (invitedMs == null) {
    // Without an invite timestamp we can't reason about timing — do nothing
    // rather than guess.
    return { kind: 'none', reason: 'missing_invited_at' }
  }

  const sent = Math.max(0, Math.floor(state.remindersSent ?? 0))
  const lastReminderMs = toMs(state.lastReminderAt)

  // "Is the next step due yet?" is measured from the last reminder once one
  // has been sent, otherwise from the invite date.
  const anchorMs = lastReminderMs ?? invitedMs
  const daysSinceAnchor = (now.getTime() - anchorMs) / DAY_MS

  if (daysSinceAnchor < INVITE_REMINDER_INTERVAL_DAYS) {
    return { kind: 'none', reason: 'too_soon' }
  }

  if (sent < INVITE_MAX_REMINDERS) {
    return { kind: 'send_reminder', reminderNumber: sent + 1 }
  }

  return { kind: 'cancel', reason: 'no_signup_after_max_reminders' }
}
