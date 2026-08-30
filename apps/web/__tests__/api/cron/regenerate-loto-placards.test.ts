// Tests for /api/cron/regenerate-loto-placards: the auth gate plus the
// batch/marking behaviour that makes the backfill resumable and crash-safe
// — each placard rendered once, failures isolated and left for retry, and a
// tenant's logo loaded a single time across its fleet.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cronLogMock = vi.fn(async (_req: Request, handler: () => Promise<Response>) => handler())
vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (req: Request, handler: () => Promise<Response>) => cronLogMock(req, handler),
}))

// In-memory loto_equipment. `done` mirrors placard_qr_backfilled; the
// pending query serves !done rows (ordered) and a successful mark flips it.
type Row = { tenant_id: string; equipment_id: string; done: boolean }
let rows: Row[] = []
const pendingRows = () =>
  rows
    .filter(r => !r.done)
    .sort((a, b) =>
      a.tenant_id.localeCompare(b.tenant_id) || a.equipment_id.localeCompare(b.equipment_id))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: (_cols: string, opts?: { head?: boolean }) => {
        if (opts?.head) {
          const countBuilder = {
            eq: () => countBuilder,
            or: () => countBuilder,
            then: (resolve: (v: { count: number; error: null }) => void) =>
              resolve({ count: pendingRows().length, error: null }),
          }
          return countBuilder
        }
        const builder = {
          eq: () => builder,
          or: () => builder,
          order: () => builder,
          limit: (n: number) =>
            Promise.resolve({
              data: pendingRows()
                .slice(0, n)
                .map(r => ({ tenant_id: r.tenant_id, equipment_id: r.equipment_id })),
              error: null,
            }),
        }
        return builder
      },
      update: (payload: { placard_qr_backfilled?: boolean }) => ({
        eq: (_c1: string, v1: string) => ({
          eq: (_c2: string, v2: string) => {
            const row = rows.find(r => r.tenant_id === v1 && r.equipment_id === v2)
            if (row && payload.placard_qr_backfilled === true) row.done = true
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }),
  }),
}))

// Typed with their real parameters: `vi.fn(async () => …)` infers a zero-arg
// signature, so the call sites below and the mockImplementation that reads
// equipmentId both fail tsc even though they run fine.
const loadLogoMock = vi.fn(async (_admin: unknown, _tenantId: string): Promise<Uint8Array | null> => null)
const regenMock = vi.fn(
  async (_admin: unknown, _tenantId: string, _equipmentId: string): Promise<{ placardUrl: string }> =>
    ({ placardUrl: 'https://x/p.pdf?v=1' }),
)
vi.mock('@/lib/loto/regeneratePlacard', () => ({
  loadTenantLogoPng: (admin: unknown, tenantId: string) => loadLogoMock(admin, tenantId),
  regenerateAndUploadPlacard: (admin: unknown, t: string, e: string) => regenMock(admin, t, e),
}))

const captureMock = vi.hoisted(() => vi.fn())
vi.mock('@sentry/nextjs', () => ({ captureException: captureMock, captureMessage: vi.fn() }))

import { GET, POST } from '@/app/api/cron/regenerate-loto-placards/route'

const ORIG_CRON_SECRET = process.env.CRON_SECRET

beforeEach(() => {
  cronLogMock.mockClear()
  loadLogoMock.mockClear()
  regenMock.mockClear()
  regenMock.mockImplementation(async () => ({ placardUrl: 'https://x/p.pdf?v=1' }))
  captureMock.mockClear()
  rows = []
  process.env.CRON_SECRET = 'cron-secret-value'
})

afterEach(() => {
  process.env.CRON_SECRET = ORIG_CRON_SECRET
})

const authed = (method: 'GET' | 'POST' = 'POST'): Request =>
  new Request('https://example.com/api/cron/regenerate-loto-placards', {
    method,
    headers: { authorization: 'Bearer cron-secret-value' },
  })

describe('/api/cron/regenerate-loto-placards auth', () => {
  it('rejects a request with no credentials', async () => {
    const res = await GET(
      new Request('https://example.com/api/cron/regenerate-loto-placards', { method: 'GET' }),
    )
    expect(res.status).toBe(401)
    expect(cronLogMock).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer token', async () => {
    const res = await POST(
      new Request('https://example.com/api/cron/regenerate-loto-placards', {
        method: 'POST',
        headers: { authorization: 'Bearer nope' },
      }),
    )
    expect(res.status).toBe(401)
  })
})

describe('/api/cron/regenerate-loto-placards backfill', () => {
  it('regenerates every pending placard, marks them, and drains to zero', async () => {
    rows = [
      { tenant_id: 't1', equipment_id: 'EQ-A', done: false },
      { tenant_id: 't1', equipment_id: 'EQ-B', done: false },
      { tenant_id: 't2', equipment_id: 'EQ-C', done: false },
    ]

    const res = await POST(authed())
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body).toMatchObject({ ok: true, succeeded: 3, failed: 0, remaining: 0 })
    expect(regenMock).toHaveBeenCalledTimes(3)
    expect(rows.every(r => r.done)).toBe(true)
  })

  it('loads each tenant logo once across its fleet', async () => {
    rows = [
      { tenant_id: 't1', equipment_id: 'EQ-A', done: false },
      { tenant_id: 't1', equipment_id: 'EQ-B', done: false },
      { tenant_id: 't2', equipment_id: 'EQ-C', done: false },
    ]

    await POST(authed())

    expect(loadLogoMock).toHaveBeenCalledTimes(2)
    const tenantsLoaded = loadLogoMock.mock.calls.map(c => c[1]).sort()
    expect(tenantsLoaded).toEqual(['t1', 't2'])
  })

  it('isolates a per-row failure: others succeed, the bad row stays pending, no spin', async () => {
    rows = [
      { tenant_id: 't1', equipment_id: 'EQ-A', done: false },
      { tenant_id: 't1', equipment_id: 'EQ-FAIL', done: false },
      { tenant_id: 't2', equipment_id: 'EQ-C', done: false },
    ]
    regenMock.mockImplementation(async (_a, _t, equipmentId) => {
      if (equipmentId === 'EQ-FAIL') throw new Error('render boom')
      return { placardUrl: 'https://x/p.pdf?v=1' }
    })

    const res = await POST(authed())
    const body = await res.json()

    expect(body).toMatchObject({ ok: true, succeeded: 2, failed: 1, remaining: 1 })
    expect(body.failedKeys).toContain('t1/EQ-FAIL')
    expect(captureMock).toHaveBeenCalledTimes(1)
    expect(rows.find(r => r.equipment_id === 'EQ-FAIL')!.done).toBe(false)
    expect(rows.find(r => r.equipment_id === 'EQ-A')!.done).toBe(true)
    expect(rows.find(r => r.equipment_id === 'EQ-C')!.done).toBe(true)
  })

  it('returns zero work when nothing is pending', async () => {
    rows = [{ tenant_id: 't1', equipment_id: 'EQ-A', done: true }]
    const res = await POST(authed())
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, succeeded: 0, failed: 0, remaining: 0 })
    expect(regenMock).not.toHaveBeenCalled()
  })
})
