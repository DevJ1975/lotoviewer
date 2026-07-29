import { beforeEach, describe, expect, it, vi } from 'vitest'

// Contract tests for POST /api/insights/olap — the execution half of the
// semantic catalog. The properties under test are the ones that make this
// route safe to put behind an AI tool: it is gated, it reads as the USER
// (never the service role, so row-level security supplies the scoping), it
// only accepts vocabulary the catalog sanctions, and it refuses a metric it
// cannot report honestly instead of returning a plausible number.
//
// The planner's own logic is covered in packages/core; this stays a thin
// route-level test.

const { requireTenantMemberMock, rows, authedClient } = vi.hoisted(() => {
  const rows: Array<Record<string, string | null>> = []
  function chain(): Record<string, unknown> {
    const result = { data: rows, error: null }
    const c: Record<string, unknown> = {
      select: () => c,
      gte: () => c,
      lte: () => Promise.resolve(result),
      then: (onF: (v: typeof result) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onF, onR),
    }
    return c
  }
  return {
    requireTenantMemberMock: vi.fn(),
    rows,
    authedClient: { from: vi.fn(() => chain()) },
  }
})

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: (req: Request) => requireTenantMemberMock(req),
}))

import { POST } from '@/app/api/insights/olap/route'

function post(body: unknown): Request {
  return new Request('http://test/api/insights/olap', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const OK_GATE = {
  ok: true, userId: 'u1', userEmail: null, tenantId: 't1',
  facilityId: null, role: 'member', authedClient,
}

const RANGE = { from: '2026-01-01', to: '2026-06-30' }

beforeEach(() => {
  vi.clearAllMocks()
  rows.length = 0
  requireTenantMemberMock.mockResolvedValue(OK_GATE)
})

describe('POST /api/insights/olap', () => {
  it('refuses an unauthenticated caller with the gate status', async () => {
    requireTenantMemberMock.mockResolvedValue({ ok: false, status: 401, message: 'nope' })
    const res = await POST(post({ metricId: 'recordable_cases', ...RANGE }) as never)
    expect(res.status).toBe(401)
  })

  it('reads through the caller-scoped client, never the service role', async () => {
    await POST(post({ metricId: 'recordable_cases', dimensions: ['time'], ...RANGE }) as never)
    // Scoping must come from RLS on the user's own client. If this ever reads
    // through supabaseAdmin, facility isolation silently disappears.
    expect(authedClient.from).toHaveBeenCalledWith('incidents')
  })

  it('refuses a blocked metric with 422 and an explanation, not a number', async () => {
    const res = await POST(post({ metricId: 'trir', dimensions: ['time'], ...RANGE }) as never)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/hours worked/i)
    expect(body.availableMetrics.map((m: { id: string }) => m.id)).not.toContain('trir')
  })

  it('rejects a dimension outside the catalog vocabulary', async () => {
    const res = await POST(post({
      metricId: 'recordable_cases', dimensions: ['department'], ...RANGE,
    }) as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/unknown dimension/i)
  })

  it('rejects a malformed body', async () => {
    const bad = new Request('http://test/api/insights/olap', { method: 'POST', body: 'not json' })
    const res = await POST(bad as never)
    expect(res.status).toBe(400)
  })

  it('groups by period and returns an interval and a comparability flag per bucket', async () => {
    for (let i = 0; i < 12; i += 1) rows.push({ occurred_at: '2026-03-05T00:00:00Z' })
    for (let i = 0; i < 3; i += 1) rows.push({ occurred_at: '2026-04-05T00:00:00Z' })

    const res = await POST(post({
      metricId: 'recordable_cases', dimensions: ['time'], grain: 'month', ...RANGE,
    }) as never)
    expect(res.status).toBe(200)
    const body = await res.json()

    const march = body.results.find((r: { period: string }) => r.period === '2026-03')
    const april = body.results.find((r: { period: string }) => r.period === '2026-04')
    expect(march.n).toBe(12)
    expect(april.n).toBe(3)
    // A thin bucket still reports its count but declines to support comparison.
    expect(march.comparable).toBe(true)
    expect(april.comparable).toBe(false)
    expect(march.interval.lower).toBeLessThan(12)
    expect(march.interval.upper).toBeGreaterThan(12)
  })

  it('always returns the formula and the disclosures alongside the numbers', async () => {
    rows.push({ occurred_at: '2026-02-01T00:00:00Z' })
    const res = await POST(post({
      metricId: 'recordable_cases', dimensions: ['time'], ...RANGE,
    }) as never)
    const body = await res.json()
    expect(body.metric.formula).toContain('meets_recording_criteria')
    expect(body.disclosures.length).toBeGreaterThan(0)
    expect(body.window).toEqual({ from: RANGE.from, to: RANGE.to, grain: 'month' })
    expect(body.scope).toBe('tenant')
  })

  it('reports facility scope when the gate carries a facility', async () => {
    requireTenantMemberMock.mockResolvedValue({ ...OK_GATE, facilityId: 'f1' })
    rows.push({ occurred_at: '2026-02-01T00:00:00Z' })
    const res = await POST(post({
      metricId: 'recordable_cases', dimensions: ['time'], ...RANGE,
    }) as never)
    const body = await res.json()
    expect(body.scope).toBe('facility')
  })
})
