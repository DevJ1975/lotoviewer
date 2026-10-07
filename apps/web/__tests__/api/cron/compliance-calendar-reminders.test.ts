import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase } from '../environmental/_fakeSupabase'

// The planning rules (who hears about what, and when) are covered in core's reminders
// tests. Here: the route's auth, which tenants it reaches, and that a deadline is only
// stamped as reminded once an email carrying it was really sent.

const cronLog = vi.fn(async (_req: Request, handler: () => Promise<Response>) => handler())
vi.mock('@/lib/cronInstrumentation', () => ({ withCronLogging: (req: Request, h: () => Promise<Response>) => cronLog(req, h) }))

let db: ReturnType<typeof fakeSupabase>
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => db.client }))

const send = vi.fn()
vi.mock('@/lib/email/sendComplianceReminder', () => ({ sendComplianceReminder: (a: unknown) => send(a) }))
const suppressed = new Set<string>()
vi.mock('@/lib/email/suppression', () => ({ loadSuppressedEmails: async () => suppressed }))
vi.mock('@/lib/email/unsubscribe', () => ({ buildUnsubscribe: () => ({ url: 'https://app.test/unsub' }) }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { GET, POST } from '@/app/api/cron/compliance-calendar-reminders/route'

const ORIG = { cron: process.env.CRON_SECRET, internal: process.env.INTERNAL_PUSH_SECRET, app: process.env.NEXT_PUBLIC_APP_URL }
beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'; process.env.INTERNAL_PUSH_SECRET = 'internal-secret'; process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
  send.mockReset(); send.mockResolvedValue({ sent: true, providerId: 'p1' }); cronLog.mockClear(); suppressed.clear()
})
afterEach(() => { process.env.CRON_SECRET = ORIG.cron; process.env.INTERNAL_PUSH_SECRET = ORIG.internal; process.env.NEXT_PUBLIC_APP_URL = ORIG.app })

const call = (method: 'GET' | 'POST' = 'GET', headers: Record<string, string> = { authorization: 'Bearer cron-secret' }) =>
  (method === 'GET' ? GET : POST)(new Request('https://app.test/api/cron/compliance-calendar-reminders', { method, headers }))

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const ob = (over: Record<string, unknown> = {}) => ({
  id: 'o1', tenant_id: 't1', facility_id: 'f1', title: 'Quarterly inspection', regulatory_ref: 'IGP', status: 'open',
  next_due_at: daysFromNow(5), lead_days: 30, last_reminded_on: null, owner_user_id: null, ...over,
})

function world(over: { obligations?: unknown[]; tenants?: unknown[]; memberships?: unknown[]; profiles?: unknown[] } = {}) {
  db = fakeSupabase({
    compliance_calendar_obligations: call => call.ops.some(o => o.method === 'update') ? { data: null } : { data: over.obligations ?? [ob()] },
    tenants: [{ data: over.tenants ?? [{ id: 't1', name: 'Acme', modules: { environmental: true }, disabled_at: null }] }],
    tenant_memberships: [{ data: over.memberships ?? [
      { tenant_id: 't1', user_id: 'admin1', role: 'admin', invite_cancelled_at: null },
      { tenant_id: 't1', user_id: 'pat', role: 'member', invite_cancelled_at: null },
    ] }],
    profiles: [{ data: over.profiles ?? [{ id: 'admin1', email: 'admin@acme.test', full_name: 'Alex Admin' }, { id: 'pat', email: 'pat@acme.test', full_name: 'Pat' }] }],
    facilities: [{ data: [{ id: 'f1', name: 'Anaheim Plant' }] }],
  })
}
const stamps = () => db.calls.filter(c => c.table === 'compliance_calendar_obligations' && c.ops.some(o => o.method === 'update'))

describe('auth', () => {
  it('refuses a request without the cron secret, for both methods', async () => {
    world()
    for (const method of ['GET', 'POST'] as const) {
      expect((await call(method, {})).status).toBe(401)
      expect((await call(method, { authorization: 'Bearer wrong' })).status).toBe(401)
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('accepts the cron secret and the internal secret', async () => {
    world()
    expect((await call('GET', { authorization: 'Bearer cron-secret' })).status).toBe(200)
    expect((await call('POST', { 'x-internal-secret': 'internal-secret' })).status).toBe(200)
  })

  it('runs inside the cron logger', async () => {
    world(); await call()
    expect(cronLog).toHaveBeenCalledTimes(1)
  })
})

describe('reminding', () => {
  it('emails the admins about an unassigned deadline, naming the site, and stamps it as reminded', async () => {
    world()
    const body = await (await call()).json()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: 'admin@acme.test', tenantName: 'Acme', calendarUrl: 'https://app.test/environmental/compliance/calendar',
      items: [{ title: 'Quarterly inspection', site: 'Anaheim Plant', overdue: false, days: 5 }],
    })
    expect(body).toMatchObject({ emails_sent: 1, deadlines_stamped: 1 })
    expect(stamps()).toHaveLength(1)
    expect(stamps()[0]!.ops.find(o => o.method === 'update')!.args[0]).toEqual({ last_reminded_on: new Date().toISOString().slice(0, 10) })
    expect(stamps()[0]!.ops).toContainEqual({ method: 'in', args: ['id', ['o1']] })
  })

  it('emails an assigned deadline to its owner only', async () => {
    world({ obligations: [ob({ owner_user_id: 'pat' })] })
    await call()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toMatchObject({ to: 'pat@acme.test', recipientName: 'Pat' })
  })

  it('does NOT stamp a deadline whose email failed, so it is tried again tomorrow', async () => {
    world()
    send.mockResolvedValue({ sent: false, providerId: null })
    const body = await (await call()).json()
    expect(body).toMatchObject({ emails_sent: 0, emails_failed: 1, deadlines_stamped: 0 })
    expect(stamps()).toEqual([])
  })

  it('does not email an address that has unsubscribed, or a person with no email, and says so', async () => {
    suppressed.add('admin@acme.test')
    world()
    const body = await (await call()).json()
    expect(send).not.toHaveBeenCalled()
    expect(body.skipped_no_email_or_suppressed).toBe(1)
    expect(stamps()).toEqual([])
  })

  it('leaves out tenants that switched the module off or are disabled', async () => {
    world({ tenants: [{ id: 't1', name: 'Acme', modules: { environmental: false }, disabled_at: null }] })
    await call()
    expect(send).not.toHaveBeenCalled()
    world({ tenants: [{ id: 't1', name: 'Acme', modules: { environmental: true }, disabled_at: '2026-01-01T00:00:00Z' }] })
    await call()
    expect(send).not.toHaveBeenCalled()
  })

  it('reminds nobody about a deadline reminded this week or not yet in its window', async () => {
    world({ obligations: [ob({ last_reminded_on: daysFromNow(-2) }), ob({ id: 'o2', next_due_at: daysFromNow(200) })] })
    const body = await (await call()).json()
    expect(send).not.toHaveBeenCalled()
    expect(body.message).toMatch(/Nothing is due a reminder/)
  })

  it('reports plainly when there is nothing open at all', async () => {
    world({ obligations: [] })
    const body = await (await call()).json()
    expect(body.message).toMatch(/No open environmental deadlines/)
  })

  it('only looks at open environmental deadlines, most urgent first', async () => {
    world(); await call()
    const read = db.calls.find(c => c.table === 'compliance_calendar_obligations')!
    expect(read.ops).toContainEqual({ method: 'eq', args: ['status', 'open'] })
    expect(read.ops).toContainEqual({ method: 'eq', args: ['category', 'environmental'] })
    expect(read.ops).toContainEqual({ method: 'order', args: ['next_due_at', { ascending: true }] })
  })

  it('answers 500 when the read fails', async () => {
    db = fakeSupabase({ compliance_calendar_obligations: [{ error: { message: 'secret detail' } }] })
    const res = await call()
    expect(res.status).toBe(500)
  })
})
