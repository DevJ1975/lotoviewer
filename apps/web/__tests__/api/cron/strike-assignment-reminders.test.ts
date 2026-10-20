import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/cron/strike-assignment-reminders: auth gate, and that one learner gets
// one email listing their due-soon work while completed and unreleased work
// is left out. Cadence itself is pinned by strikeReminderFor's unit tests.

const { queues, tableProxy, sendMock } = vi.hoisted(() => {
  type Result = { data?: unknown; error?: { message: string } | null }
  const queues = new Map<string, Result[]>()
  const sendMock = vi.fn<(args: unknown) => Promise<boolean>>(async () => true)
  function tableProxy(table: string) {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'not', 'is', 'limit', 'order']) chain[m] = () => chain
    chain.maybeSingle = async () => queues.get(table)?.shift() ?? { data: null, error: null }
    chain.then = (resolve: (v: Result) => unknown) => Promise.resolve(queues.get(table)?.shift() ?? { data: [], error: null }).then(resolve)
    return chain
  }
  return { queues, tableProxy, sendMock }
})

vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (_req: Request, handler: () => Promise<Response>) => handler(),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tableProxy(t) }) }))
vi.mock('@/lib/email/suppression', () => ({ loadSuppressedEmails: async () => new Set<string>() }))
vi.mock('@/lib/email/unsubscribe', () => ({ buildUnsubscribe: () => null }))
vi.mock('@/lib/email/sendStrikeAssignmentReminder', () => ({ sendStrikeAssignmentReminder: (a: unknown) => sendMock(a) }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))

import { GET } from '@/app/api/cron/strike-assignment-reminders/route'

const TENANT = 't1'
const DAY = 86_400_000

function queue(table: string, data: unknown) {
  queues.set(table, [...(queues.get(table) ?? []), { data, error: null }])
}

function authed() {
  return new Request('http://localhost/api/cron/strike-assignment-reminders', { headers: { authorization: 'Bearer cron-secret' } })
}

beforeEach(() => {
  queues.clear()
  sendMock.mockClear()
  process.env.CRON_SECRET = 'cron-secret'
  process.env.INTERNAL_PUSH_SECRET = ''
})

describe('GET /api/cron/strike-assignment-reminders', () => {
  it('rejects calls without the cron secret', async () => {
    const res = await GET(new Request('http://localhost/api/cron/strike-assignment-reminders'))
    expect(res.status).toBe(401)
  })

  it('emails each learner once, listing only released, incomplete work hitting a reminder day', async () => {
    const inThreeDays = new Date(Date.now() + 3 * DAY - 60_000).toISOString()
    queue('strike_assignments', [
      { id: 'a-loto', tenant_id: TENANT, module_id: 'loto', target_type: 'tenant', target_id: null, starts_at: null, due_at: inThreeDays },
      { id: 'a-cse', tenant_id: TENANT, module_id: 'cse', target_type: 'tenant', target_id: null, starts_at: null, due_at: inThreeDays },
      { id: 'a-later', tenant_id: TENANT, module_id: 'heights', target_type: 'tenant', target_id: null, starts_at: new Date(Date.now() + 10 * DAY).toISOString(), due_at: inThreeDays },
    ])
    queue('tenants', { name: 'Snak King', modules: { strike: true }, disabled_at: null })
    queue('members', [
      { id: 'm-ana', display_name: 'Ana Ruiz', preferred_name: null, email: 'ana@example.com', profile_id: 'u-ana', department: null, site_label: null },
      { id: 'm-ben', display_name: 'Ben Ode', preferred_name: null, email: null, profile_id: null, department: null, site_label: null },
    ])
    queue('tenant_memberships', [])
    queue('strike_modules', [
      { id: 'loto', title: 'LOTO 101', slug: 'loto-101', estimated_minutes: 5 },
      { id: 'cse', title: 'Confined Space', slug: 'cse', estimated_minutes: 5 },
    ])
    queue('strike_module_versions', [
      { id: 'v-loto', module_id: 'loto', version_number: 1, supersedes_completions: false },
      { id: 'v-cse', module_id: 'cse', version_number: 1, supersedes_completions: false },
    ])
    queue('strike_completions', [
      { module_id: 'cse', module_version_id: 'v-cse', member_id: 'm-ana', user_id: null, completed_at: new Date().toISOString(), expires_at: null },
    ])

    const res = await GET(authed())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenants: 1, emails_sent: 1 })
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      to: 'ana@example.com',
      items: [expect.objectContaining({ title: 'LOTO 101', kind: 'due_soon' })],
    }))
  })

  it('skips tenants that have STRIKE switched off', async () => {
    queue('strike_assignments', [
      { id: 'a', tenant_id: TENANT, module_id: 'loto', target_type: 'tenant', target_id: null, starts_at: null, due_at: new Date(Date.now() + DAY).toISOString() },
    ])
    queue('tenants', { name: 'T', modules: { strike: false }, disabled_at: null })
    const res = await GET(authed())
    expect(await res.json()).toEqual({ tenants: 1, emails_sent: 0 })
    expect(sendMock).not.toHaveBeenCalled()
  })
})
