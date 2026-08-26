// The invite-reminder cron must never act on a member who already holds a
// working credential — and must never act at all on a partial user scan.
//
// The cancel it performs is not cosmetic: migration 190 put
// `invite_cancelled_at is null` inside current_user_tenant_ids() and
// current_user_admin_tenant_ids(), the security-definer functions every
// domain-table RLS policy consults. A wrongly-cancelled member signs in with
// a password that works, passes AuthGate, and sees an application with zero
// rows in it — recoverable only by an admin re-issuing the invite.
//
// Two ways the old code got there:
//   1. last_sign_in_at was resolved from a listUsers scan hard-capped at
//      50 pages x 200 = 10k users. Past that the loop exhausted MAX_PAGES and
//      returned a truncated map with no error, and step 3's `?? null` made an
//      absent user indistinguishable from one who never signed in.
//   2. last_sign_in_at was the ONLY liveness signal, but /api/invites/accept
//      sets the password without establishing a session — so a user who chose
//      a password and never completed a browser sign-in looked identical to
//      someone who never showed up.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (_req: Request, handler: () => Promise<Response>) => handler(),
}))

interface Result { data?: unknown; error?: { message: string } | null }

const queues = new Map<string, Result[]>()
const updates: Array<{ table: string; payload: unknown }> = []

function queue(table: string, ...results: Result[]) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table)!.push(...results)
}

const listUsersMock = vi.fn()

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => {
    const tableProxy = (table: string) => {
      const next = (): Promise<Result> =>
        Promise.resolve(queues.get(table)?.shift() ?? { data: [], error: null })
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        in:     () => chain,
        is:     () => chain,
        update: (payload: unknown) => { updates.push({ table, payload }); return chain },
        then:   (onFulfilled: (v: Result) => unknown) => next().then(onFulfilled),
      }
      return chain
    }
    return { from: tableProxy, auth: { admin: { listUsers: listUsersMock } } }
  },
}))

const sendInviteReminderMock = vi.fn(async () => ({ sent: true, providerId: 'id' }))
vi.mock('@/lib/email/sendInviteReminder', () => ({
  sendInviteReminder: () => sendInviteReminderMock(),
}))

const supersedeMock = vi.fn(async () => undefined)
vi.mock('@/lib/invites/tokens', () => ({
  buildInviteUrl:        () => 'https://app/accept-invite?token=x',
  issueInviteToken:      vi.fn(async () => ({ ok: true, raw: 'raw-token' })),
  supersedeInviteTokens: () => supersedeMock(),
}))

const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (e: unknown, c?: unknown) => captureExceptionMock(e, c),
  captureMessage:   vi.fn(),
}))

import { GET } from '@/app/api/cron/invite-reminders/route'

const USER = 'user-aaa'
const DAY = 24 * 60 * 60 * 1000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

/** A membership that planInviteAction would CANCEL: 4 reminders, last one 10 days ago. */
const dueForCancel = {
  user_id: USER, tenant_id: 'T1',
  created_at: iso(60 * DAY),
  invite_reminders_sent: 4,
  invite_last_reminder_at: iso(10 * DAY),
}

/** A membership that planInviteAction would REMIND: never reminded, invited 40 days ago. */
const dueForReminder = {
  user_id: USER, tenant_id: 'T1',
  created_at: iso(40 * DAY),
  invite_reminders_sent: 0,
  invite_last_reminder_at: null,
}

/** listUsers returns one short page → the scan is complete and USER is absent from it. */
function completeScanWithoutUser() {
  listUsersMock.mockResolvedValue({ data: { users: [{ id: 'someone-else', last_sign_in_at: null }] }, error: null })
}

const run = () => GET(new Request('https://x/api/cron/invite-reminders', {
  method: 'GET', headers: { authorization: 'Bearer cron-secret-value' },
}))

const ORIG = process.env.CRON_SECRET
beforeEach(() => {
  queues.clear(); updates.length = 0
  listUsersMock.mockReset(); sendInviteReminderMock.mockClear()
  supersedeMock.mockClear(); captureExceptionMock.mockClear()
  process.env.CRON_SECRET = 'cron-secret-value'
})
afterEach(() => { process.env.CRON_SECRET = ORIG })

describe('invite-reminders cron — never acts on a partial user scan', () => {
  it('aborts the whole run when listUsers truncates at the page cap', async () => {
    queue('tenant_memberships', { data: [dueForCancel], error: null })
    // Every page comes back full, so the loop never sees a short page.
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: `other-${i}`, last_sign_in_at: null }))
    listUsersMock.mockResolvedValue({ data: { users: fullPage }, error: null })

    const res = await run()

    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/scan incomplete/i)
    // The destructive write must not have happened.
    expect(updates).toHaveLength(0)
    expect(supersedeMock).not.toHaveBeenCalled()
    expect(sendInviteReminderMock).not.toHaveBeenCalled()
    // And it must be loud, not silent.
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/truncated/i) }),
      expect.objectContaining({ tags: expect.objectContaining({ stage: 'list-users-truncated' }) }),
    )
  })
})

describe('invite-reminders cron — never acts on a member who set a password', () => {
  it('does not cancel a membership whose profile says the password is set', async () => {
    queue('tenant_memberships', { data: [dueForCancel], error: null })
    completeScanWithoutUser()
    queue('profiles', { data: [{ id: USER, must_change_password: false }], error: null })

    const res = await run()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ invites_cancelled: 0, reminders_sent: 0 })
    expect(updates.find(u => u.table === 'tenant_memberships')).toBeUndefined()
    expect(supersedeMock).not.toHaveBeenCalled()
  })

  it('does not email a reminder to a member who set a password', async () => {
    queue('tenant_memberships', { data: [dueForReminder], error: null })
    completeScanWithoutUser()
    queue('profiles', { data: [{ id: USER, must_change_password: false }], error: null })

    const res = await run()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ reminders_sent: 0, invites_cancelled: 0 })
    expect(sendInviteReminderMock).not.toHaveBeenCalled()
  })

  it('still cancels a genuine pending invitee (flag true, never signed in)', async () => {
    queue('tenant_memberships', { data: [dueForCancel], error: null })
    completeScanWithoutUser()
    queue('profiles',           { data: [{ id: USER, must_change_password: true }], error: null })
    queue('tenant_memberships', { data: null, error: null })   // the cancel UPDATE

    const res = await run()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ invites_cancelled: 1 })
    expect(updates.find(u => u.table === 'tenant_memberships')?.payload).toMatchObject({
      invite_cancelled_reason: 'no_signup_after_max_reminders',
    })
    expect(supersedeMock).toHaveBeenCalled()
  })

  it('treats a missing profile row as a pending invite, not a set password', async () => {
    queue('tenant_memberships', { data: [dueForCancel], error: null })
    completeScanWithoutUser()
    queue('profiles',           { data: [], error: null })     // no row for USER
    queue('tenant_memberships', { data: null, error: null })

    const res = await run()

    expect(await res.json()).toMatchObject({ invites_cancelled: 1 })
  })
})
