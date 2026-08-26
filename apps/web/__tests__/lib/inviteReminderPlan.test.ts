import { describe, it, expect } from 'vitest'
import {
  planInviteAction,
  INVITE_MAX_REMINDERS,
  INVITE_REMINDER_INTERVAL_DAYS,
  type InviteReminderState,
} from '@soteria/core/inviteReminderPlan'

const NOW = new Date('2026-06-01T09:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY).toISOString()
}

function state(overrides: Partial<InviteReminderState> = {}): InviteReminderState {
  return {
    invitedAt:      daysAgo(0),
    lastSignInAt:   null,
    remindersSent:  0,
    lastReminderAt: null,
    cancelledAt:    null,
    ...overrides,
  }
}

describe('planInviteAction — terminal states', () => {
  it('does nothing when already cancelled', () => {
    const a = planInviteAction(state({ cancelledAt: daysAgo(1), invitedAt: daysAgo(60), remindersSent: 4 }), NOW)
    expect(a).toEqual({ kind: 'none', reason: 'already_cancelled' })
  })

  it('does nothing when the invitee has signed in', () => {
    const a = planInviteAction(state({ lastSignInAt: daysAgo(2), invitedAt: daysAgo(40) }), NOW)
    expect(a).toEqual({ kind: 'none', reason: 'already_signed_in' })
  })

  it('signed-in takes priority even when a reminder would otherwise be due', () => {
    const a = planInviteAction(state({ lastSignInAt: daysAgo(1), invitedAt: daysAgo(10) }), NOW)
    expect(a.kind).toBe('none')
  })

  it('does nothing when the invite timestamp is unparseable', () => {
    const a = planInviteAction(state({ invitedAt: 'not-a-date' }), NOW)
    expect(a).toEqual({ kind: 'none', reason: 'missing_invited_at' })
  })
})

describe('planInviteAction — reminder cadence', () => {
  it('is too soon before the first interval elapses', () => {
    const a = planInviteAction(state({ invitedAt: daysAgo(INVITE_REMINDER_INTERVAL_DAYS - 1) }), NOW)
    expect(a).toEqual({ kind: 'none', reason: 'too_soon' })
  })

  it('sends reminder #1 once a full interval has passed since the invite', () => {
    const a = planInviteAction(state({ invitedAt: daysAgo(INVITE_REMINDER_INTERVAL_DAYS) }), NOW)
    expect(a).toEqual({ kind: 'send_reminder', reminderNumber: 1 })
  })

  it('sends reminder #2 a week after reminder #1', () => {
    const a = planInviteAction(state({
      invitedAt:      daysAgo(14),
      remindersSent:  1,
      lastReminderAt: daysAgo(INVITE_REMINDER_INTERVAL_DAYS),
    }), NOW)
    expect(a).toEqual({ kind: 'send_reminder', reminderNumber: 2 })
  })

  it('does not re-send within the same week', () => {
    const a = planInviteAction(state({
      invitedAt:      daysAgo(10),
      remindersSent:  1,
      lastReminderAt: daysAgo(3),
    }), NOW)
    expect(a).toEqual({ kind: 'none', reason: 'too_soon' })
  })

  it('sends the final reminder (#4) on schedule', () => {
    const a = planInviteAction(state({
      invitedAt:      daysAgo(28),
      remindersSent:  INVITE_MAX_REMINDERS - 1,
      lastReminderAt: daysAgo(INVITE_REMINDER_INTERVAL_DAYS),
    }), NOW)
    expect(a).toEqual({ kind: 'send_reminder', reminderNumber: 4 })
  })
})

describe('planInviteAction — cancellation', () => {
  it('cancels a week after the fourth reminder when still not signed in', () => {
    const a = planInviteAction(state({
      invitedAt:      daysAgo(35),
      remindersSent:  INVITE_MAX_REMINDERS,
      lastReminderAt: daysAgo(INVITE_REMINDER_INTERVAL_DAYS),
    }), NOW)
    expect(a).toEqual({ kind: 'cancel', reason: 'no_signup_after_max_reminders' })
  })

  it('does not cancel until a full interval after the fourth reminder', () => {
    const a = planInviteAction(state({
      invitedAt:      daysAgo(31),
      remindersSent:  INVITE_MAX_REMINDERS,
      lastReminderAt: daysAgo(3),
    }), NOW)
    expect(a).toEqual({ kind: 'none', reason: 'too_soon' })
  })
})

describe('planInviteAction — full lifecycle', () => {
  it('walks invite → 4 reminders → cancel over five weeks', () => {
    const invitedAt = daysAgo(0)
    let remindersSent = 0
    let lastReminderAt: string | null = null
    const observed: string[] = []

    // Simulate a daily run for 40 days; record each non-"none" action and
    // advance the bookkeeping the way the cron does.
    for (let day = 1; day <= 40; day++) {
      const at = new Date(NOW.getTime() + day * DAY)
      const action = planInviteAction(
        { invitedAt, lastSignInAt: null, remindersSent, lastReminderAt, cancelledAt: null },
        at,
      )
      if (action.kind === 'send_reminder') {
        observed.push(`reminder:${action.reminderNumber}`)
        remindersSent = action.reminderNumber
        lastReminderAt = at.toISOString()
      } else if (action.kind === 'cancel') {
        observed.push('cancel')
        break
      }
    }

    expect(observed).toEqual(['reminder:1', 'reminder:2', 'reminder:3', 'reminder:4', 'cancel'])
  })
})


describe('planInviteAction — passwordSet is a second liveness signal', () => {
  const DAY_MS = 24 * 60 * 60 * 1000
  const invitedAt = new Date(Date.now() - 60 * DAY_MS).toISOString()
  const at        = new Date()

  // Would otherwise CANCEL: four reminders sent, the last one 10 days ago.
  const dueForCancel = {
    invitedAt,
    lastSignInAt:   null,
    remindersSent:  4,
    lastReminderAt: new Date(Date.now() - 10 * DAY_MS).toISOString(),
    cancelledAt:    null,
  }

  it('short-circuits when the user has chosen a password but never signed in', () => {
    // This is the state /api/invites/accept leaves behind when the client's
    // follow-up signInWithPassword never lands: a working credential and a
    // null last_sign_in_at.
    expect(planInviteAction({ ...dueForCancel, passwordSet: true }, at))
      .toEqual({ kind: 'none', reason: 'credential_already_set' })
  })

  it('blocks the reminder path too, not just the cancel', () => {
    const dueForReminder = { ...dueForCancel, remindersSent: 0, lastReminderAt: null }
    expect(planInviteAction({ ...dueForReminder, passwordSet: true }, at))
      .toEqual({ kind: 'none', reason: 'credential_already_set' })
  })

  it('leaves the decision unchanged when the flag is false or absent', () => {
    // Absent means "not looked up" — callers that cannot resolve the flag
    // keep the previous behaviour rather than a silently different one.
    expect(planInviteAction({ ...dueForCancel, passwordSet: false }, at).kind).toBe('cancel')
    expect(planInviteAction(dueForCancel, at).kind).toBe('cancel')
  })

  it('already_signed_in still wins — it is checked first', () => {
    expect(planInviteAction({ ...dueForCancel, lastSignInAt: at.toISOString(), passwordSet: true }, at))
      .toEqual({ kind: 'none', reason: 'already_signed_in' })
  })
})
