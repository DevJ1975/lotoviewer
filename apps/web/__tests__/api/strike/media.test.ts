import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as issuePlaybackUrl } from '@/app/api/strike/[moduleId]/media/route'

// Integration tests for POST /api/strike/[moduleId]/media.
// Exercises:
//   - Auth gate + per-user rate limit
//   - Vimeo branch: embed URL + who-watched-what audit row
//   - "No video" branch: provider null, no audit row
//   - Tenant-scoped modules stay invisible across tenants

const { authGetUser, captured, queues, resetMockState, tableProxy } = vi.hoisted(() => {
  type ChainResult = { data?: unknown; error?: { message: string } | null }
  const queues = new Map<string, ChainResult[]>()
  const captured = {
    inserts: [] as Array<{ table: string; payload: unknown }>,
  }
  const authGetUser = vi.fn()
  function next(table: string): ChainResult {
    return queues.get(table)?.shift() ?? { data: null, error: null }
  }
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
  }
  return { authGetUser, captured, queues, resetMockState, tableProxy }
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
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_TENANT_ID = '99999999-9999-9999-9999-999999999999'
const MODULE_ID = '22222222-2222-2222-2222-222222222222'
const VERSION_ID = '33333333-3333-3333-3333-333333333333'
const VIMEO_ID = '123456789'
const VIMEO_HASH = 'abcdef0123'

function queue(table: string, ...rs: Array<{ data?: unknown; error?: { message: string } | null }>) {
  queues.set(table, [...(queues.get(table) ?? []), ...rs])
}

function req(body: unknown, opts: { auth?: boolean } = {}) {
  return new Request(`http://localhost/api/strike/${MODULE_ID}/media`, {
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
  // requireStrikeMember wraps requireTenantModuleMember, which resolves the
  // tenant's module map before the route runs. Without STRIKE enabled here
  // every request 403s well before the behaviour under test.
  queue('tenants', { data: { name: 'Test Tenant', modules: { strike: true }, settings: {}, disabled_at: null } })
}

function queueModuleAndVersion(versionOverrides: Record<string, unknown> = {}, moduleOverrides: Record<string, unknown> = {}) {
  queue('strike_modules', {
    data: { id: MODULE_ID, tenant_id: null, library_scope: 'global', status: 'published', ...moduleOverrides },
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
      video_external_id: VIMEO_ID,
      video_meta: { vimeo_hash: VIMEO_HASH },
      ...versionOverrides,
    },
  })
}

describe('POST /api/strike/[moduleId]/media', () => {
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
    const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }, { auth: false }), ctx())
    expect(res.status).toBe(401)
  })

  it('returns a Vimeo embed URL and writes an audit row', async () => {
    queueGate()
    queueModuleAndVersion()
    const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider).toBe('vimeo')
    expect(body.url).toBe(`https://player.vimeo.com/video/${VIMEO_ID}?h=${VIMEO_HASH}&dnt=1`)
    expect(body.expires_at).toBeNull()

    const audit = captured.inserts.find(i => i.table === 'strike_media_access')?.payload as Record<string, unknown>
    expect(audit).toMatchObject({
      tenant_id: TENANT_ID,
      user_id: 'learner-1',
      module_id: MODULE_ID,
      module_version_id: VERSION_ID,
      provider: 'vimeo',
      object_ref: VIMEO_ID,
    })
  })

  it('returns provider null and no audit row when the version has no video', async () => {
    queueGate()
    queueModuleAndVersion({ video_external_id: null, video_meta: {} })
    const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider).toBeNull()
    expect(body.url).toBeNull()
    expect(captured.inserts.find(i => i.table === 'strike_media_access')).toBeUndefined()
  })

  it('404 for tenant-scoped modules outside the caller tenant', async () => {
    queueGate()
    queueModuleAndVersion({}, { library_scope: 'tenant', tenant_id: OTHER_TENANT_ID })
    const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }), ctx())
    expect(res.status).toBe(404)
  })

  it('429 once the per-user playback rate limit is exhausted', async () => {
    for (let i = 0; i < 20; i++) {
      queueGate()
      queueModuleAndVersion()
      const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }), ctx())
      expect(res.status).toBe(200)
    }
    queueGate()
    const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }), ctx())
    expect(res.status).toBe(429)
  })
})
