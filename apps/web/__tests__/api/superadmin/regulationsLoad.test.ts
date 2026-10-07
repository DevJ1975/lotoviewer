import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/superadmin/regulations/load and the recent-jobs half of
// GET /api/superadmin/regulation-status. A real load spends embedding credits and
// changes what every tenant's assistant cites, so: superadmin only, a dry run
// unless the caller says otherwise, and never a stale dry-run in place of a load.

const m = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(),
  enqueue: vi.fn(),
  results: {} as Record<string, unknown>,
  filters: [] as Array<[string, unknown[]]>,
}))

vi.mock('@/lib/auth/superadmin', () => ({ requireSuperadmin: m.requireSuperadmin }))
vi.mock('@/lib/serviceJobs', () => ({ enqueueServiceJob: m.enqueue }))
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      for (const name of ['select', 'eq', 'order', 'limit']) {
        q[name] = (...args: unknown[]) => { m.filters.push([`${table}.${name}`, args]); return q }
      }
      q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(m.results[table]).then(resolve, reject)
      return q
    },
  }),
}))

const post = (body: unknown) =>
  new Request('http://localhost/api/superadmin/regulations/load', {
    method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  m.filters.length = 0
  for (const k of Object.keys(m.results)) delete m.results[k]
  m.requireSuperadmin.mockResolvedValue({ ok: true, userId: 'su-1', email: 'su@example.com' })
  m.enqueue.mockResolvedValue({ jobId: 'job-1' })
})

describe('POST /api/superadmin/regulations/load', () => {
  const call = async (body: unknown) => (await import('@/app/api/superadmin/regulations/load/route')).POST(post(body))

  it('is for superadmins only', async () => {
    m.requireSuperadmin.mockResolvedValue({ ok: false, status: 403, message: 'Not a superadmin' })
    const res = await call({ source: 'epa-40-cfr-262', date: '2026-05-07' })
    expect(res.status).toBe(403)
    expect(m.enqueue).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown source', { source: 'nope', date: '2026-05-07' }],
    ['no source', { date: '2026-05-07' }],
    ['no date', { source: 'epa-40-cfr-262' }],
    ['a malformed date', { source: 'epa-40-cfr-262', date: '5/7/2026' }],
    ['a non-string date', { source: 'epa-40-cfr-262', date: 20260507 }],
  ])('rejects %s', async (_name, body) => {
    expect((await call(body)).status).toBe(400)
    expect(m.enqueue).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON', async () => {
    expect((await call('{nope')).status).toBe(400)
  })

  it('queues a DRY RUN unless told otherwise', async () => {
    const res = await call({ source: 'epa-40-cfr-262', date: '2026-05-07' })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ job_id: 'job-1', dry_run: true })
    expect(m.enqueue.mock.calls[0][0].payload).toEqual({ source: 'epa-40-cfr-262', date: '2026-05-07', dry_run: true })
  })

  it.each([['"false"', 'false'], ['0', 0], ['null', null], ['undefined-ish', undefined]])(
    'only an explicit boolean false starts a real load (not %s)', async (_label, value) => {
      const res = await call({ source: 'epa-40-cfr-262', date: '2026-05-07', dry_run: value })
      expect((await res.json()).dry_run).toBe(true)
    })

  it('queues a real load on an explicit false, as a platform job with the requester recorded', async () => {
    const res = await call({ source: 'epa-40-cfr-262', date: '2026-05-07', dry_run: false })
    expect((await res.json()).dry_run).toBe(false)
    const args = m.enqueue.mock.calls[0][0]
    expect(args.kind).toBe('regulation_ingest')
    expect(args.tenantId).toBeUndefined()
    expect(args.requestedBy).toBe('su-1')
  })

  it('keeps a live dry run from standing in for the real load someone just asked for', async () => {
    await call({ source: 'epa-40-cfr-262', date: '2026-05-07', dry_run: true })
    await call({ source: 'epa-40-cfr-262', date: '2026-05-07', dry_run: false })
    await call({ source: 'epa-40-cfr-262', date: '2026-06-01', dry_run: false })
    const keys = m.enqueue.mock.calls.map(c => c[0].dedupeKey)
    expect(new Set(keys).size).toBe(3)
  })

  it('ignores a client-supplied payload field it does not know', async () => {
    await call({ source: 'epa-40-cfr-262', date: '2026-05-07', payload: { source: 'x' }, tenant_id: 'forged' })
    expect(m.enqueue.mock.calls[0][0].payload.source).toBe('epa-40-cfr-262')
    expect(m.enqueue.mock.calls[0][0].tenantId).toBeUndefined()
  })

  it('says what to check when the service will not take the job', async () => {
    m.enqueue.mockResolvedValue(null)
    const res = await call({ source: 'epa-40-cfr-262', date: '2026-05-07' })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/SERVICE_JOBS_ENABLED/)
  })
})

describe('GET /api/superadmin/regulation-status — recent loads', () => {
  const call = async () => (await import('@/app/api/superadmin/regulation-status/route')).GET(
    new Request('http://localhost/api/superadmin/regulation-status', { headers: { authorization: 'Bearer t' } }),
  )

  it('returns the tracked parts with the most recent regulation loads', async () => {
    m.results.regulation_update_checks = { data: [{ source: 'epa-40-cfr-262' }], error: null }
    m.results.service_jobs = { data: [{ id: 'j1', status: 'succeeded' }], error: null }
    const body = await (await call()).json()
    expect(body).toEqual({ rows: [{ source: 'epa-40-cfr-262' }], jobs: [{ id: 'j1', status: 'succeeded' }] })
    expect(m.filters).toEqual(expect.arrayContaining([
      ['service_jobs.eq', ['kind', 'regulation_ingest']],
      ['service_jobs.limit', [20]],
    ]))
  })

  it.each(['42P01', 'PGRST205'])('shows no loads, not an error, before the queue exists (%s)', async (code) => {
    m.results.regulation_update_checks = { data: [], error: null }
    m.results.service_jobs = { data: null, error: { code, message: 'relation does not exist' } }
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).jobs).toEqual([])
  })

  it('still reports a real failure reading the queue', async () => {
    m.results.regulation_update_checks = { data: [], error: null }
    m.results.service_jobs = { data: null, error: { code: '57014', message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  it('is for superadmins only', async () => {
    m.requireSuperadmin.mockResolvedValue({ ok: false, status: 401, message: 'Missing bearer token' })
    expect((await call()).status).toBe(401)
  })
})
