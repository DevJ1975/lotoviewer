// /api/cron/environmental-permits: the nightly permit job (Phase 2 plan D6-D10, Q2).
// Renewal notices at 180, 90 and 30 days and once passed; condition reminders 14 days
// ahead and once overdue; each sent once however often it runs; to the owner or the
// admins, plus the Compliance obligations holder for a business-critical permit; released
// when nobody could be told; and unfinalized direct uploads swept after 24 hours.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ADMIN_A, MEMBER_A, TENANT_A, TENANT_B,
  captureExceptionMock, failNext, objectCreatedAt, objects, resetStore, rowsIn, seed, writes,
} from '../environmental/_emsHarness'

vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (_req: Request, run: () => Promise<Response>) => run(),
}))
interface SendArgs { to: string; renewals: { permitTitle: string; tier: unknown }[]; conditions: { conditionTitle: string; stage: string }[] }
const sendMock = vi.fn<(args: SendArgs) => Promise<{ sent: boolean; providerId: string }>>(async () => ({ sent: true, providerId: 'p1' }))
vi.mock('@/lib/email/sendPermitsDue', () => ({ sendPermitsDue: (args: SendArgs) => sendMock(args) }))
let suppressed = new Set<string>()
vi.mock('@/lib/email/suppression', () => ({ loadSuppressedEmails: async () => suppressed }))
vi.mock('@/lib/email/unsubscribe', () => ({ buildUnsubscribe: () => ({ url: 'https://app.test/unsubscribe' }) }))

import { GET, POST } from '@/app/api/cron/environmental-permits/route'
import { addCalendarDays } from '@soteria/core/managementSystem'

const TODAY = '2026-10-02'
const inDays = (days: number) => addCalendarDays(TODAY, days)
const OBLIGATIONS_HOLDER = '00000000-0000-4000-8000-0000000000c0'
const FORMER_OWNER = '00000000-0000-4000-8000-0000000000f0'
const ORIG_ENV = process.env

function permit(id: string, over: Record<string, unknown> = {}) {
  return {
    id, tenant_id: TENANT_A, title: `Permit ${id}`, agency: 'City of Northfield', permit_number: null, expires_on: inDays(400),
    renewal_application_due_on: null, renewal_submitted_on: null, business_critical: false, owner_user_id: MEMBER_A,
    retired_at: null, ...over,
  }
}
function condition(id: string, over: Record<string, unknown> = {}) {
  return {
    id, tenant_id: TENANT_A, permit_id: 'p-air', title: `Condition ${id}`, next_due_at: inDays(200), status: 'open',
    owner_user_id: MEMBER_A, ...over,
  }
}

const cron = (secret = 'cron-secret') =>
  GET(new Request('https://app.test/api/cron/environmental-permits', { headers: { authorization: `Bearer ${secret}` } }))
const log = () => rowsIn('ms_notification_log').map(row => `${row.subject_id}:${row.notice_key}`)
const mailTo = (email: string) => sendMock.mock.calls.map(([args]) => args).filter(args => args.to === email)

beforeEach(() => {
  resetStore()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T14:00:00Z`))
  process.env = { ...ORIG_ENV, CRON_SECRET: 'cron-secret', NEXT_PUBLIC_APP_URL: 'https://app.test' }
  sendMock.mockClear()
  sendMock.mockImplementation(async () => ({ sent: true, providerId: 'p1' }))
  suppressed = new Set()
  seed('tenants', [
    { id: TENANT_A, name: 'Northfield Forge & Finish', modules: { environmental: true }, disabled_at: null },
    { id: TENANT_B, name: 'Module off', modules: {}, disabled_at: null },
  ])
  seed('tenant_memberships', [
    { tenant_id: TENANT_A, user_id: ADMIN_A, role: 'admin', invite_cancelled_at: null },
    { tenant_id: TENANT_A, user_id: MEMBER_A, role: 'member', invite_cancelled_at: null },
    { tenant_id: TENANT_A, user_id: OBLIGATIONS_HOLDER, role: 'member', invite_cancelled_at: null },
  ])
  seed('profiles', [
    { id: ADMIN_A, email: 'ehs.manager@example.test', full_name: 'EHS Manager' },
    { id: MEMBER_A, email: 'permit.owner@example.test', full_name: 'Permit Owner' },
    { id: OBLIGATIONS_HOLDER, email: 'obligations@example.test', full_name: 'Obligations Holder' },
    { id: FORMER_OWNER, email: 'gone@example.test', full_name: 'Former Owner' },
  ])
})

afterEach(() => {
  vi.useRealTimers()
  process.env = ORIG_ENV
})

describe('authorization', () => {
  it('refuses a request without the secret, on both methods', async () => {
    expect((await cron('wrong')).status).toBe(401)
    expect((await POST(new Request('https://app.test/x', { method: 'POST' }))).status).toBe(401)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('accepts the internal secret', async () => {
    process.env.INTERNAL_PUSH_SECRET = 'internal'
    const res = await GET(new Request('https://app.test/x', { headers: { 'x-internal-secret': 'internal' } }))
    expect(res.status).toBe(200)
  })
})

describe('renewal notices', () => {
  it('tells the owner once for the tier a permit is in, and records it', async () => {
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(29), permit_number: 'DEMO-1' })])
    const body = await (await cron()).json()
    expect(body).toMatchObject({ tenantsScanned: 1, renewalNotices: 1, emailsSent: 1, released: 0 })
    expect(mailTo('permit.owner@example.test')).toHaveLength(1)
    expect(mailTo('permit.owner@example.test')[0].renewals).toMatchObject([{ permitTitle: 'Permit p-air', tier: 30 }])
    expect(log()).toEqual([`p-air:renewal:30:${inDays(29)}`])
    expect(rowsIn('ms_notification_log')[0]).toMatchObject({ tenant_id: TENANT_A, subject_type: 'environmental_permit', recipients: 1 })
  })

  it('sends nothing a second time, however often it runs', async () => {
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(29) })])
    await cron()
    sendMock.mockClear()
    writes.length = 0
    const again = await (await cron()).json()
    expect(again).toMatchObject({ renewalNotices: 0, emailsSent: 0, alreadySent: 0 })
    expect(sendMock).not.toHaveBeenCalled()
    expect(log()).toHaveLength(1)
    // It reads what was sent, so it does not even try to claim a notice again: the unique key
    // is the second line of defence against two overlapping runs, not the first.
    expect(writes.filter(write => write.table === 'ms_notification_log')).toEqual([])
  })

  it('moves to the next tier as the deadline nears, and starts over when the permit is renewed', async () => {
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(95) })])
    await cron()
    vi.setSystemTime(new Date(`${inDays(10)}T14:00:00Z`))     // now 85 days out: the 90 tier
    await cron()
    expect(log()).toEqual([`p-air:renewal:180:${inDays(95)}`, `p-air:renewal:90:${inDays(95)}`])

    rowsIn('environmental_permits')[0].expires_on = inDays(1000)       // renewed: a new term
    rowsIn('environmental_permits')[0].renewal_application_due_on = inDays(210)   // 200 days out from now: nothing yet
    sendMock.mockClear()
    await cron()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('counts to the renewal application date when the permit gives one', async () => {
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(300), renewal_application_due_on: inDays(85) })])
    await cron()
    expect(log()).toEqual([`p-air:renewal:90:${inDays(85)}`])
  })

  it('stops for a submitted renewal, a retired permit, a permit with no term, and a deadline over 180 days away', async () => {
    seed('environmental_permits', [
      permit('submitted', { expires_on: inDays(20), renewal_submitted_on: inDays(-3) }),
      permit('retired', { expires_on: inDays(20), retired_at: '2026-01-01T00:00:00Z' }),
      permit('by-rule', { expires_on: null }),
      permit('far', { expires_on: inDays(181) }),
    ])
    await cron()
    expect(sendMock).not.toHaveBeenCalled()
    expect(log()).toEqual([])
  })

  it('tells the owner when the deadline has passed, and says so', async () => {
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(-4) })])
    await cron()
    expect(mailTo('permit.owner@example.test')[0].renewals).toMatchObject([{ tier: 'passed' }])
  })

  it('ignores another tenant\'s permits and a tenant with the module off', async () => {
    seed('environmental_permits', [permit('theirs', { tenant_id: TENANT_B, expires_on: inDays(10) })])
    expect(await (await cron()).json()).toMatchObject({ tenantsScanned: 1, renewalNotices: 0 })
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('who hears about a renewal', () => {
  it('goes to the tenant\'s admins when the permit has no owner, or the owner has left', async () => {
    seed('environmental_permits', [
      permit('no-owner', { expires_on: inDays(29), owner_user_id: null }),
      permit('left', { expires_on: inDays(29), owner_user_id: FORMER_OWNER }),
    ])
    await cron()
    expect(mailTo('ehs.manager@example.test')).toHaveLength(1)                 // one digest listing both
    expect(mailTo('ehs.manager@example.test')[0].renewals.map(r => r.permitTitle).sort()).toEqual(['Permit left', 'Permit no-owner'])
    expect(mailTo('gone@example.test')).toEqual([])
  })

  it('adds the Compliance obligations holder for a business-critical permit, at any tier', async () => {
    seed('ms_responsibilities', [{ tenant_id: TENANT_A, discipline: 'ems', responsibility_key: 'obligations', owner_user_id: OBLIGATIONS_HOLDER }])
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(120), business_critical: true })])
    await cron()
    expect(sendMock.mock.calls.map(([a]) => a.to).sort()).toEqual(['obligations@example.test', 'permit.owner@example.test'])
  })

  it('also reaches every owner and admin at 30 days, and once passed, for a business-critical permit only', async () => {
    seed('environmental_permits', [
      permit('critical', { expires_on: inDays(29), business_critical: true }),
      permit('ordinary', { expires_on: inDays(29), business_critical: false, title: 'Ordinary permit' }),
    ])
    await cron()
    expect(mailTo('ehs.manager@example.test')[0].renewals.map(r => r.permitTitle)).toEqual(['Permit critical'])
    expect(mailTo('permit.owner@example.test')[0].renewals.map(r => r.permitTitle)).toEqual(['Permit critical', 'Ordinary permit'])
  })

  it('sends one digest per person for everything owed to them', async () => {
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(29) }), permit('p-water', { expires_on: inDays(60) })])
    seed('compliance_calendar_obligations', [condition('c1', { next_due_at: inDays(5) })])
    await cron()
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      to: 'permit.owner@example.test',
      renewals: [{ permitTitle: 'Permit p-air' }, { permitTitle: 'Permit p-water' }],
      conditions: [{ conditionTitle: 'Condition c1', stage: 'due_soon' }],
    })
  })
})

describe('condition reminders', () => {
  it('reminds 14 days ahead, not 15, and once more when overdue', async () => {
    seed('compliance_calendar_obligations', [
      condition('c14', { next_due_at: inDays(14) }), condition('c15', { next_due_at: inDays(15) }),
      condition('late', { next_due_at: inDays(-3) }),
    ])
    const body = await (await cron()).json()
    expect(body.conditionReminders).toBe(2)
    expect(log().sort()).toEqual([
      `c14:condition:due_soon:${inDays(14)}`, `late:condition:overdue:${inDays(-3)}`,
    ].sort())
    expect(rowsIn('ms_notification_log').every(row => row.subject_type === 'compliance_obligation')).toBe(true)
  })

  it('never repeats a reminder, and starts the next cycle when the condition is done and its date moves on', async () => {
    seed('compliance_calendar_obligations', [condition('c1', { next_due_at: inDays(10) })])
    await cron()
    sendMock.mockClear()
    await cron()
    expect(sendMock).not.toHaveBeenCalled()
    rowsIn('compliance_calendar_obligations')[0].next_due_at = inDays(10 + 90)   // done; a quarter on
    vi.setSystemTime(new Date(`${inDays(80)}T14:00:00Z`))                        // 20 days before it: nothing
    await cron()
    expect(sendMock).not.toHaveBeenCalled()
    vi.setSystemTime(new Date(`${inDays(90)}T14:00:00Z`))                        // 10 days before it
    await cron()
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('skips a completed condition and one with no permit', async () => {
    seed('compliance_calendar_obligations', [
      condition('done', { status: 'completed', next_due_at: inDays(-2) }),
      condition('no-permit', { permit_id: null, next_due_at: inDays(-2) }),
    ])
    await cron()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('goes to the admins when the condition has no owner', async () => {
    seed('compliance_calendar_obligations', [condition('c1', { owner_user_id: null, next_due_at: inDays(3) })])
    await cron()
    expect(sendMock.mock.calls.map(([a]) => a.to)).toEqual(['ehs.manager@example.test'])
  })
})

describe('when nobody can be told', () => {
  it('counts a recipient who opted out as told, and keeps the notice', async () => {
    suppressed = new Set(['permit.owner@example.test'])
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(29) })])
    expect(await (await cron()).json()).toMatchObject({ renewalNotices: 1, emailsSkipped: 1, released: 0 })
    expect(sendMock).not.toHaveBeenCalled()
    expect(log()).toHaveLength(1)
  })

  it('releases a notice whose email failed, so tomorrow\'s run tries again', async () => {
    sendMock.mockImplementation(async () => ({ sent: false, providerId: '' }))
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(29) })])
    expect(await (await cron()).json()).toMatchObject({ renewalNotices: 0, released: 1, emailsSkipped: 1 })
    expect(log()).toEqual([])

    sendMock.mockImplementation(async () => ({ sent: true, providerId: 'p1' }))
    expect(await (await cron()).json()).toMatchObject({ renewalNotices: 1, emailsSent: 1 })
    expect(log()).toHaveLength(1)
  })

  it('releases a notice when there is no one to tell: no owner and no admins', async () => {
    rowsIn('tenant_memberships').splice(0, rowsIn('tenant_memberships').length)
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(29), owner_user_id: null })])
    expect(await (await cron()).json()).toMatchObject({ renewalNotices: 0, released: 1 })
    expect(log()).toEqual([])
  })

  it('keeps a notice when at least one of its recipients was told', async () => {
    seed('ms_responsibilities', [{ tenant_id: TENANT_A, discipline: 'ems', responsibility_key: 'obligations', owner_user_id: OBLIGATIONS_HOLDER }])
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(120), business_critical: true })])
    sendMock.mockImplementation(async args => ({ sent: args.to === 'obligations@example.test', providerId: 'p' }))
    expect(await (await cron()).json()).toMatchObject({ renewalNotices: 1, released: 0, emailsSent: 1, emailsSkipped: 1 })
    expect(log()).toHaveLength(1)
  })
})

describe('claiming and failing', () => {
  it('does not send a notice another run claimed first', async () => {
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(29) })])
    // The other run's claim lands between this run reading the log and claiming.
    const { beforeNext } = await import('../environmental/_emsHarness')
    beforeNext('ms_notification_log', 'insert', () => {
      seed('ms_notification_log', [{ tenant_id: TENANT_A, subject_type: 'environmental_permit', subject_id: 'p-air', notice_key: `renewal:30:${inDays(29)}` }])
    })
    expect(await (await cron()).json()).toMatchObject({ alreadySent: 1, renewalNotices: 0 })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sends nothing for a notice it could not claim, and reports the failure', async () => {
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(29) })])
    failNext('ms_notification_log', { code: '08006', message: 'connection lost' }, 'insert')
    expect(await (await cron()).json()).toMatchObject({ failed: 1, renewalNotices: 0 })
    expect(sendMock).not.toHaveBeenCalled()
    expect(captureExceptionMock).toHaveBeenCalled()
  })

  it('answers 500 naming the stage when a register cannot be read', async () => {
    failNext('environmental_permits', { code: '08006', message: 'connection lost' }, 'select')
    const res = await cron()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed while reading permits')
  })
})

describe('unfinalized direct uploads', () => {
  const age = (key: string, hoursAgo: number) => objectCreatedAt.set(`ms-evidence/${key}`, new Date(Date.now() - hoursAgo * 3_600_000).toISOString())
  const put = (path: string, hoursAgo: number) => { objects.set(`ms-evidence/${path}`, new Uint8Array([1])); age(path, hoursAgo) }

  it('removes pending uploads older than 24 hours, and keeps newer ones and everything filed', async () => {
    put(`pending/${TENANT_A}/${ADMIN_A}--11111111-1111-4111-8111-111111111111`, 25)
    put(`pending/${TENANT_A}/${ADMIN_A}--22222222-2222-4222-8222-222222222222`, 2)
    put(`pending/${TENANT_B}/${ADMIN_A}--33333333-3333-4333-8333-333333333333`, 48)
    put(`${TENANT_A}/environmental_permit/p-air/${'a'.repeat(64)}.pdf`, 500)
    const body = await (await cron()).json()
    expect(body.pendingUploadsSwept).toBe(2)
    expect([...objects.keys()].sort()).toEqual([
      `ms-evidence/${TENANT_A}/environmental_permit/p-air/${'a'.repeat(64)}.pdf`,
      `ms-evidence/pending/${TENANT_A}/${ADMIN_A}--22222222-2222-4222-8222-222222222222`,
    ])
  })

  it('sweeps even when no notice was due, and when no tenant has the module on', async () => {
    rowsIn('tenants')[0].modules = {}
    put(`pending/${TENANT_A}/${ADMIN_A}--11111111-1111-4111-8111-111111111111`, 30)
    expect((await (await cron()).json()).pendingUploadsSwept).toBe(1)
  })

  it('does not let a failed sweep fail the notices', async () => {
    seed('environmental_permits', [permit('p-air', { expires_on: inDays(29) })])
    const storage = await import('@/lib/supabaseAdmin')
    const spy = vi.spyOn(storage.supabaseAdmin().storage, 'from').mockImplementation(() => { throw new Error('storage down') })
    const body = await (await cron()).json()
    spy.mockRestore()
    expect(body).toMatchObject({ renewalNotices: 1, pendingUploadsSwept: 0 })
  })
})
