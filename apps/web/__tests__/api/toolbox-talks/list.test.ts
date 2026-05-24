import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requireTenantModuleMemberMock } = vi.hoisted(() => ({
  requireTenantModuleMemberMock: vi.fn(),
}))

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantModuleMember: (req: Request, moduleId: string) => requireTenantModuleMemberMock(req, moduleId),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { GET } from '@/app/api/toolbox-talks/route'

interface Row { id: string; talk_date: string; title: string; topic_id: string; generated_at: string }

// A chainable, awaitable stand-in for a PostgREST query builder. Every
// filter method returns the same object; awaiting it resolves to the
// injected result. `selectArgs` records each select() call so a test can
// assert what columns were requested.
function thenableChain(result: { data: unknown; error: unknown }, selectArgs: string[]) {
  const chain: Record<string, unknown> = {}
  for (const method of ['eq', 'gte', 'lte', 'lt', 'order', 'limit', 'in'] as const) {
    chain[method] = () => chain
  }
  chain.select = (cols: string) => { selectArgs.push(cols); return chain }
  chain.then = (
    onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
  return chain
}

// The list route issues, in order: from('toolbox_talks') for upcoming,
// from('toolbox_talks') for past, then (only when past is non-empty)
// from('toolbox_talk_signatures') for the attendance tally.
function authedClientFor(
  data: { upcoming: Row[]; past: Row[]; signatures: Array<{ talk_id: string }> },
  selectArgs: string[],
  fromTables: string[],
) {
  let talksCall = 0
  return {
    from(table: string) {
      fromTables.push(table)
      if (table === 'toolbox_talk_signatures') {
        return thenableChain({ data: data.signatures, error: null }, selectArgs)
      }
      talksCall += 1
      const rows = talksCall === 1 ? data.upcoming : data.past
      return thenableChain({ data: rows, error: null }, selectArgs)
    },
  }
}

function gateWith(authedClient: unknown) {
  return {
    ok: true,
    tenantId: 'tenant-1',
    userId: 'user-1',
    userEmail: 'worker@example.com',
    role: 'member',
    tenantName: 'Fixture Manufacturing',
    tenantModules: { 'toolbox-talks': true },
    tenantSettings: { toolbox_time_zone: 'America/Los_Angeles' },
    authedClient,
  }
}

function request() {
  return new Request('http://x/api/toolbox-talks', {
    headers: { authorization: 'Bearer test' },
  })
}

const pastTalk = (id: string, talk_date: string, title: string): Row => ({
  id, talk_date, title, topic_id: 'topic-1', generated_at: `${talk_date}T12:00:00.000Z`,
})

describe('GET /api/toolbox-talks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-24T16:00:00.000Z'))
    requireTenantModuleMemberMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enforces the toolbox-talks module gate before reading any data', async () => {
    requireTenantModuleMemberMock.mockResolvedValue({
      ok: false,
      status: 403,
      message: 'Module is not enabled for this tenant',
    })

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(requireTenantModuleMemberMock).toHaveBeenCalledWith(expect.any(Request), 'toolbox-talks')
  })

  it('tallies sign-ins from a talk_id-only read, never the embedded count or signature image', async () => {
    const selectArgs: string[] = []
    const fromTables: string[] = []
    requireTenantModuleMemberMock.mockResolvedValue(
      gateWith(authedClientFor(
        {
          upcoming: [],
          past: [pastTalk('t1', '2026-05-23', 'PPE Basics'), pastTalk('t2', '2026-05-22', 'Ladder Safety')],
          signatures: [{ talk_id: 't1' }, { talk_id: 't1' }, { talk_id: 't2' }],
        },
        selectArgs,
        fromTables,
      )),
    )

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    // The frontend reads `t.toolbox_talk_signatures[0].count`.
    const counts = Object.fromEntries(
      body.past.map((t: { id: string; toolbox_talk_signatures: Array<{ count: number }> }) =>
        [t.id, t.toolbox_talk_signatures[0].count]),
    )
    expect(counts).toEqual({ t1: 2, t2: 1 })

    // Regression guard for migration 137's column-level grant: the
    // signatures table must be read by the thin talk_id column only —
    // never via PostgREST's embedded `(count)` (which reads the row
    // whole) and never touching the protected signature_data image.
    expect(fromTables).toContain('toolbox_talk_signatures')
    expect(selectArgs).toContain('talk_id')
    expect(selectArgs.join('|')).not.toContain('toolbox_talk_signatures(count)')
    expect(selectArgs.join('|')).not.toContain('signature_data')
  })

  it('skips the signatures read entirely when there are no past talks', async () => {
    const selectArgs: string[] = []
    const fromTables: string[] = []
    requireTenantModuleMemberMock.mockResolvedValue(
      gateWith(authedClientFor(
        { upcoming: [], past: [], signatures: [] },
        selectArgs,
        fromTables,
      )),
    )

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.past).toEqual([])
    expect(fromTables).not.toContain('toolbox_talk_signatures')
  })
})
