// /api/cron/compliance-evaluations: the nightly scheduler for clause 9.1.2.
// It opens an evaluation for each environmental obligation whose cadence
// comes due within 30 days, only for tenants with the module on, assigns
// it to the obligation's owner while they are still a member, and emails
// whoever must do the work. Re-running it changes nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ADMIN_A, MEMBER_A, TENANT_A, TENANT_B,
  beforeNext, captureExceptionMock, failNext, resetStore, rowsIn, seed,
} from '../environmental/_emsHarness'

vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (_req: Request, run: () => Promise<Response>) => run(),
}))
const sendMock = vi.fn<(args: { to: string; evaluations: unknown[] }) => Promise<{ sent: boolean; providerId: string }>>(
  async () => ({ sent: true, providerId: 'p1' }))
vi.mock('@/lib/email/sendComplianceEvaluationDue', () => ({
  sendComplianceEvaluationDue: (args: { to: string; evaluations: unknown[] }) => sendMock(args),
}))
let suppressed = new Set<string>()
vi.mock('@/lib/email/suppression', () => ({ loadSuppressedEmails: async () => suppressed }))
vi.mock('@/lib/email/unsubscribe', () => ({ buildUnsubscribe: () => ({ url: 'https://app.test/unsubscribe' }) }))

import { GET } from '@/app/api/cron/compliance-evaluations/route'

const TODAY = '2026-10-02'
const FORMER_OWNER = '00000000-0000-4000-8000-0000000000f0'
const ORIG_ENV = process.env

function obligation(id: string, over: Record<string, unknown> = {}) {
  return {
    id, tenant_id: TENANT_A, facility_id: null, discipline: 'ems', status: 'open', title: `Obligation ${id}`,
    evaluation_cadence_days: 365, owner_user_id: MEMBER_A, ...over,
  }
}

function cron(secret = 'cron-secret') {
  return GET(new Request('https://app.test/api/cron/compliance-evaluations', { headers: { authorization: `Bearer ${secret}` } }))
}

const scheduled = () => rowsIn('ms_compliance_evaluations')

beforeEach(() => {
  resetStore()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T14:00:00Z`))
  process.env = { ...ORIG_ENV, CRON_SECRET: 'cron-secret', NEXT_PUBLIC_APP_URL: 'https://app.test' }
  sendMock.mockClear()
  suppressed = new Set()
  seed('tenants', [
    { id: TENANT_A, name: 'Northfield Forge & Finish', modules: { environmental: true }, disabled_at: null },
    { id: TENANT_B, name: 'Module off', modules: {}, disabled_at: null },
  ])
  seed('tenant_memberships', [
    { tenant_id: TENANT_A, user_id: ADMIN_A, role: 'admin', invite_cancelled_at: null },
    { tenant_id: TENANT_A, user_id: MEMBER_A, role: 'member', invite_cancelled_at: null },
  ])
  seed('profiles', [
    { id: ADMIN_A, email: 'ehs.manager@example.test', full_name: 'EHS Manager' },
    { id: MEMBER_A, email: 'permit.owner@example.test', full_name: 'Permit Owner' },
    { id: FORMER_OWNER, email: 'gone@example.test', full_name: 'Former Owner' },
  ])
})

afterEach(() => {
  vi.useRealTimers()
  process.env = ORIG_ENV
})

describe('/api/cron/compliance-evaluations', () => {
  it('refuses a caller without the cron secret', async () => {
    expect((await cron('wrong')).status).toBe(401)
    expect(scheduled()).toEqual([])
  })

  it('schedules a never-evaluated obligation for today, assigned to its owner, and emails them', async () => {
    seed('compliance_calendar_obligations', [obligation('o1', { facility_id: 'f1', discipline: 'integrated' })])
    const res = await cron()
    expect(await res.json()).toEqual({
      tenantsScanned: 1, scheduled: 1, alreadyScheduled: 0, failed: 0, emailsSent: 1, emailsSkipped: 0,
    })
    expect(scheduled()).toEqual([expect.objectContaining({
      tenant_id: TENANT_A, obligation_id: 'o1', facility_id: 'f1', discipline: 'integrated',
      scheduled_for: TODAY, assigned_to: MEMBER_A,
    })])
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'permit.owner@example.test',
      tenantName: 'Northfield Forge & Finish',
      evaluations: [{ obligationTitle: 'Obligation o1', scheduledFor: TODAY, url: 'https://app.test/environmental/obligations/o1' }],
    }))
  })

  it('schedules ahead when the next evaluation falls due within 30 days', async () => {
    seed('compliance_calendar_obligations', [obligation('soon'), obligation('later')])
    seed('ms_compliance_evaluations', [
      { id: 'e1', tenant_id: TENANT_A, obligation_id: 'soon',  completed_at: '2025-10-17T09:00:00Z', result: 'compliant' },
      { id: 'e2', tenant_id: TENANT_A, obligation_id: 'later', completed_at: '2026-06-01T09:00:00Z', result: 'compliant' },
    ])
    await cron()
    expect(scheduled().filter(e => e.completed_at == null)).toEqual([
      expect.objectContaining({ obligation_id: 'soon', scheduled_for: '2026-10-17' }),
    ])
  })

  it('leaves alone what is not its to schedule', async () => {
    seed('compliance_calendar_obligations', [
      obligation('open-already'),
      obligation('dismissed', { status: 'dismissed' }),
      obligation('one-off-done', { status: 'completed' }),
      obligation('ohs', { discipline: 'ohs' }),
      obligation('no-cadence', { evaluation_cadence_days: null }),
      obligation('module-off', { tenant_id: TENANT_B }),
    ])
    seed('ms_compliance_evaluations', [
      { id: 'e-open', tenant_id: TENANT_A, obligation_id: 'open-already', completed_at: null, scheduled_for: '2026-09-30' },
    ])
    const body = await (await cron()).json()
    expect(body).toMatchObject({ tenantsScanned: 1, scheduled: 0, emailsSent: 0 })
    expect(scheduled()).toHaveLength(1)
  })

  it('changes nothing when run twice', async () => {
    seed('compliance_calendar_obligations', [obligation('o1')])
    await cron()
    const again = await (await cron()).json()
    expect(again).toMatchObject({ scheduled: 0, alreadyScheduled: 0 })
    expect(scheduled()).toHaveLength(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('counts an evaluation another run opened first, without failing', async () => {
    seed('compliance_calendar_obligations', [obligation('o1')])
    beforeNext('ms_compliance_evaluations', 'insert', () => seed('ms_compliance_evaluations', [
      { id: 'raced', tenant_id: TENANT_A, obligation_id: 'o1', completed_at: null },
    ]))
    expect(await (await cron()).json()).toMatchObject({ scheduled: 0, alreadyScheduled: 1, failed: 0, emailsSent: 0 })
  })

  it('gives a departed owner\'s evaluation to the tenant\'s admins, never emailing the former member', async () => {
    seed('compliance_calendar_obligations', [obligation('o1', { owner_user_id: FORMER_OWNER })])
    await cron()
    expect(scheduled()[0].assigned_to).toBeNull()
    expect(sendMock.mock.calls.map(([args]) => args.to)).toEqual(['ehs.manager@example.test'])
  })

  it('sends one email per person, listing all of theirs', async () => {
    seed('compliance_calendar_obligations', [obligation('o1'), obligation('o2'), obligation('o3', { owner_user_id: null })])
    await cron()
    const byRecipient = Object.fromEntries(sendMock.mock.calls.map(([args]) => [args.to, args.evaluations.length]))
    expect(byRecipient).toEqual({ 'permit.owner@example.test': 2, 'ehs.manager@example.test': 1 })
  })

  it('respects an opt-out from reminder emails', async () => {
    suppressed = new Set(['permit.owner@example.test'])
    seed('compliance_calendar_obligations', [obligation('o1')])
    expect(await (await cron()).json()).toMatchObject({ scheduled: 1, emailsSent: 0, emailsSkipped: 1 })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('reports a failed insert and carries on with the rest', async () => {
    seed('compliance_calendar_obligations', [obligation('o1'), obligation('o2')])
    failNext('ms_compliance_evaluations', { code: 'XX000', message: 'boom' }, 'insert')
    expect(await (await cron()).json()).toMatchObject({ scheduled: 1, failed: 1 })
    expect(captureExceptionMock).toHaveBeenCalled()
  })
})
