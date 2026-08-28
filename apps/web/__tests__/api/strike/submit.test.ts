import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as submitStrikeQuiz } from '@/app/api/strike/[moduleId]/submit/route'

// Integration tests for POST /api/strike/[moduleId]/submit.
// Exercises:
//   - Auth gate (no token → 401)
//   - Per-user rate limit (11th call inside a minute → 429)
//   - retake_limit enforcement (at the limit → 409; null limit → unbounded)
//   - Tenant watch gate (below require_watch_percent → 422; recorded as
//     client-claimed evidence when supplied)
//   - 500s stay generic — internal DB error text must not leak to clients

const { authGetUser, captured, queues, resetMockState, tableProxy, sentryCaptureException } = vi.hoisted(() => {
  type ChainResult = { data?: unknown; error?: { message: string } | null; count?: number | null }
  const queues = new Map<string, ChainResult[]>()
  const captured = {
    inserts: [] as Array<{ table: string; payload: unknown }>,
  }
  const authGetUser = vi.fn()
  const sentryCaptureException = vi.fn()
  function next(table: string): ChainResult {
    return queues.get(table)?.shift() ?? { data: null, error: null }
  }
  // Chain mock: filter/build methods return the chain; maybeSingle/single
  // resolve the next queued result; the chain itself is thenable so
  // `await admin.from(t).select(...).eq(...)` (count + list queries) works.
  function tableProxy(table: string) {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'not', 'order', 'limit']) {
      chain[method] = () => chain
    }
    chain.insert = (payload: unknown) => {
      captured.inserts.push({ table, payload })
      return chain
    }
    chain.maybeSingle = async () => next(table)
    chain.single = async () => next(table)
    chain.then = (resolve: (value: ChainResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(next(table)).then(resolve, reject)
    return chain
  }
  function resetMockState() {
    queues.clear()
    captured.inserts.length = 0
    authGetUser.mockReset()
    sentryCaptureException.mockReset()
  }
  return { authGetUser, captured, queues, resetMockState, tableProxy, sentryCaptureException }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: authGetUser },
  }),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => tableProxy(t),
  }),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: sentryCaptureException,
  captureMessage: vi.fn(),
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const MODULE_ID = '22222222-2222-2222-2222-222222222222'
const VERSION_ID = '33333333-3333-3333-3333-333333333333'

function queue(table: string, ...rs: Array<{ data?: unknown; error?: { message: string } | null; count?: number | null }>) {
  queues.set(table, [...(queues.get(table) ?? []), ...rs])
}

function req(body: unknown, opts: { auth?: boolean } = {}) {
  return new Request(`http://localhost/api/strike/${MODULE_ID}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.auth !== false ? { Authorization: 'Bearer test' } : {}),
      'x-active-tenant': TENANT_ID,
    },
    body: JSON.stringify(body),
  })
}

function ctx() { return { params: Promise.resolve({ moduleId: MODULE_ID }) } }

function queueGate() {
  queue('profiles', { data: { is_superadmin: false } })
  // Shape matches the gate's select: the embedded tenant is what proves the
  // tenant is not disabled. tenantGate fails closed without it.
  queue('tenant_memberships', {
    data: { role: 'member', invite_cancelled_at: null, tenants: { disabled_at: null } },
  })
}

function queueModuleAndVersion(versionOverrides: Record<string, unknown> = {}) {
  queue('strike_modules', {
    data: { id: MODULE_ID, tenant_id: null, library_scope: 'global', status: 'published' },
  })
  queue('strike_module_versions', {
    data: {
      id: VERSION_ID,
      module_id: MODULE_ID,
      tenant_id: null,
      library_scope: 'global',
      status: 'published',
      passing_score: 80,
      retake_limit: null,
      video_external_id: '123456789',
      video_meta: { vimeo_hash: 'abcdef0123' },
      ...versionOverrides,
    },
  })
}

function baseBody(extra: Record<string, unknown> = {}) {
  return { module_version_id: VERSION_ID, answers: { acknowledgement: true }, ...extra }
}

describe('POST /api/strike/[moduleId]/submit', () => {
  beforeEach(() => {
    resetMockState()
    globalThis.__soteriaMemoryRateLimits = new Map()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPERADMIN_EMAILS = ''
    authGetUser.mockResolvedValue({
      data: { user: { id: 'learner-1', email: 'learner@example.com' } },
      error: null,
    })
  })

  it('401 when the bearer token is missing', async () => {
    const res = await submitStrikeQuiz(req(baseBody(), { auth: false }), ctx())
    expect(res.status).toBe(401)
  })

  it('429 once the per-user submit rate limit is exhausted', async () => {
    for (let i = 0; i < 10; i++) {
      queueGate()
      queueModuleAndVersion()
      queue('strike_tenant_settings', { data: null })
      queue('strike_attempts', { data: { id: `attempt-${i}` } })
      const res = await submitStrikeQuiz(req(baseBody()), ctx())
      expect(res.status).toBe(201)
    }

    queueGate()
    const res = await submitStrikeQuiz(req(baseBody()), ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
  })

  it('409 when the retake limit for the version is reached', async () => {
    queueGate()
    queueModuleAndVersion({ retake_limit: 2 })
    queue('strike_attempts', { count: 2 })
    const res = await submitStrikeQuiz(req(baseBody()), ctx())
    expect(res.status).toBe(409)
  })

  it('accepts submissions under the retake limit', async () => {
    queueGate()
    queueModuleAndVersion({ retake_limit: 2 })
    queue('strike_attempts', { count: 1 })
    queue('strike_tenant_settings', { data: null })
    queue('strike_attempts', { data: { id: 'attempt-1' } })
    const res = await submitStrikeQuiz(req(baseBody()), ctx())
    expect(res.status).toBe(201)
  })

  it('422 when the tenant requires watch progress and the claim falls short', async () => {
    queueGate()
    queueModuleAndVersion()
    queue('strike_tenant_settings', { data: { require_watch_percent: 80 } })
    const res = await submitStrikeQuiz(
      req(baseBody({ watch: { percent_watched: 40, max_position_seconds: 60, duration_seconds: 150 } })),
      ctx(),
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('80%')
  })

  it('skips the watch gate when the module has no video', async () => {
    queueGate()
    queueModuleAndVersion({ video_external_id: null })
    queue('strike_attempts', { data: { id: 'attempt-1' } })
    const res = await submitStrikeQuiz(req(baseBody()), ctx())
    expect(res.status).toBe(201)
  })

  it('records watch progress as client-claimed evidence on the attempt', async () => {
    queueGate()
    queueModuleAndVersion()
    queue('strike_tenant_settings', { data: { require_watch_percent: 80 } })
    queue('strike_attempts', { data: { id: 'attempt-1' } })
    const res = await submitStrikeQuiz(
      req(baseBody({ watch: { percent_watched: 95, max_position_seconds: 140, duration_seconds: 150 } })),
      ctx(),
    )
    expect(res.status).toBe(201)

    const attemptInsert = captured.inserts.find(i => i.table === 'strike_attempts')?.payload as {
      client_context: { watch?: { percent_watched: number }; watch_evidence?: string }
    }
    expect(attemptInsert.client_context.watch?.percent_watched).toBe(95)
    expect(attemptInsert.client_context.watch_evidence).toBe('client_claimed')
  })

  it('returns a generic 500 without leaking internal error details', async () => {
    queueGate()
    queue('strike_modules', { error: { message: 'relation "secret_internal_table" does not exist' } })
    const res = await submitStrikeQuiz(req(baseBody()), ctx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Something went wrong. Please try again.')
    expect(JSON.stringify(body)).not.toContain('secret_internal_table')
    expect(sentryCaptureException).toHaveBeenCalled()
  })
})
