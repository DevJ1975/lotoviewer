// Pure decision logic for the invite-reminder lifecycle. No I/O, no DOM,
// no Node — safe to share between the web cron and any future caller.
//
// A user holding an unaccepted invite receives up to four weekly reminder
// emails. If they still have not signed in roughly a week after the fourth
// reminder, the invite is SOFT-CANCELLED: the membership row is retained
// (an admin can reactivate it) and nothing is deleted.
//
// "Unaccepted" is measured against the invite, not against the account's
// whole history: an access reset issues a fresh invite to someone who has
// signed in before, and that invite needs the same follow-up as a brand
// new one.
//
// The cron runs daily and calls planInviteAction() for each un-cancelled
// membership. The 7-day gates make the daily cadence settle into a weekly
// rhythm — a reminder sent today won't fire again until a week has passed.

export const INVITE_REMINDER_INTERVAL_DAYS = 7
export const INVITE_MAX_REMINDERS = 4

export interface InviteReminderState {
  /**
   * When the invite currently outstanding was issued — the newest
   * invite_tokens.created_at for this user, falling back to
   * tenant_memberships.created_at for rows that predate invite tokens.
   * An access reset moves this forward; the cadence follows it.
   */
  invitedAt: string | Date
  /**
   * auth.users.last_sign_in_at — null/undefined means never signed in.
   * Only ends the lifecycle when it is at or after `invitedAt`.
   */
  lastSignInAt: string | Date | null | undefined
  /**
   * True when the user has chosen their own password
   * (profiles.must_change_password === false).
   *
   * A SECOND liveness signal, because lastSignInAt alone is not the same
   * question. /api/invites/accept sets the password and clears the flag but
   * does not establish a session — the client signs in separately, and that
   * is what stamps last_sign_in_at. Between those two steps (and forever, if
   * the sign-in never lands) the user holds a working credential while
   * looking, to lastSignInAt, exactly like someone who never showed up.
   *
   * Undefined means "not looked up", which is treated as not-set: callers
   * that cannot resolve the flag get the old behaviour rather than a
   * silently different one.
   */
  passwordSet?: boolean
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
  | 'credential_already_set'
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
 * Cadence (invite issued on day 0, not accepted since):
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

  const invitedMs = toMs(state.invitedAt)
  if (invitedMs == null) {
    // Without an invite timestamp we can't reason about timing — do nothing
    // rather than guess.
    return { kind: 'none', reason: 'missing_invited_at' }
  }

  // Signed in SINCE this invite was issued → accepted; the lifecycle is over.
  //
  // The comparison is the whole point. Asking only "has this person ever
  // signed in?" silently excluded everyone whose access was reset after a
  // first successful sign-in: they hold a fresh invite they have not acted
  // on, but the cadence read them as settled and sent nothing. One missed
  // email then stranded them until an admin noticed by hand.
  const lastSignInMs = toMs(state.lastSignInAt)
  if (lastSignInMs != null && lastSignInMs >= invitedMs) {
    return { kind: 'none', reason: 'already_signed_in' }
  }

  // Password chosen but no completed sign-in yet → still accepted. Nagging
  // this person is wrong, and cancelling them is worse: the cancel is an
  // RLS-level access revocation (migration 190 puts `invite_cancelled_at is
  // null` inside current_user_tenant_ids()), so they would sign in with a
  // password that works and see an empty application.
  //
  // Checked after the sign-in comparison above, not before: an access reset
  // sets must_change_password back to true, so a reset member reads
  // passwordSet=false here and correctly falls through to the cadence. This
  // guard is for the invitee whose accept landed and whose session never did.
  if (state.passwordSet === true) {
    return { kind: 'none', reason: 'credential_already_set' }
  }

  // An unreadable counter must not fall through to the cancel branch below.
  // `NaN` is a legal `number`, and every comparison against it is false — so
  // `sent < INVITE_MAX_REMINDERS` failed and a corrupted or mistyped
  // invite_reminders_sent CANCELLED the invite. That is an access revocation
  // (migration 190 puts `invite_cancelled_at is null` inside
  // current_user_tenant_ids()), issued on the strength of a value we could not
  // read. Same posture as `missing_invited_at` above: when the state is
  // unreadable, do nothing rather than guess — here, by restarting the ladder
  // rather than ending it.
  const rawRemindersSent = Number(state.remindersSent ?? 0)
  const sent = Number.isFinite(rawRemindersSent) ? Math.max(0, Math.floor(rawRemindersSent)) : 0
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
