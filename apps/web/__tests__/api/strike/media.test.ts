import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as issuePlaybackUrl } from '@/app/api/strike/[moduleId]/media/route'

// Integration tests for POST /api/strike/[moduleId]/media.
// Exercises:
//   - Auth gate + per-user rate limit
//   - Storage branch: 10-minute signed URL + audit row
//   - Stream branch: token-bearing HLS URL; 503 when Stream env is absent
//   - Tenant-scoped modules stay invisible across tenants

const { authGetUser, captured, createSignedUrl, queues, resetMockState, tableProxy } = vi.hoisted(() => {
  type ChainResult = { data?: unknown; error?: { message: string } | null }
  const queues = new Map<string, ChainResult[]>()
  const captured = {
    inserts: [] as Array<{ table: string; payload: unknown }>,
  }
  const authGetUser = vi.fn()
  const createSignedUrl = vi.fn()
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
    createSignedUrl.mockReset()
  }
  return { authGetUser, captured, createSignedUrl, queues, resetMockState, tableProxy }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: authGetUser },
  }),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => tableProxy(t),
    storage: { from: () => ({ createSignedUrl }) },
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
const STREAM_UID = 'c'.repeat(32)

const CF_ENV_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_STREAM_API_TOKEN',
  'CLOUDFLARE_STREAM_SIGNING_KEY_ID',
  'CLOUDFLARE_STREAM_SIGNING_KEY_PEM',
  'CLOUDFLARE_STREAM_CUSTOMER_DOMAIN',
] as const

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

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
  queue('tenant_memberships', { data: { role: 'member' } })
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
      video_provider: 'storage',
      video_external_id: null,
      video_path: 'global/loto/refresher.mp4',
      captions_path: null,
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
    for (const key of CF_ENV_KEYS) delete process.env[key]
    authGetUser.mockResolvedValue({
      data: { user: { id: 'learner-1', email: 'learner@example.com' } },
      error: null,
    })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://example.supabase.co/signed/video' }, error: null })
  })

  it('401 when the bearer token is missing', async () => {
    const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }, { auth: false }), ctx())
    expect(res.status).toBe(401)
  })

  it('signs a 10-minute storage URL and writes an audit row', async () => {
    queueGate()
    queueModuleAndVersion()
    const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider).toBe('storage')
    expect(body.url).toBe('https://example.supabase.co/signed/video')
    expect(createSignedUrl).toHaveBeenCalledWith('global/loto/refresher.mp4', 600)

    const audit = captured.inserts.find(i => i.table === 'strike_media_access')?.payload as Record<string, unknown>
    expect(audit).toMatchObject({
      tenant_id: TENANT_ID,
      user_id: 'learner-1',
      module_id: MODULE_ID,
      module_version_id: VERSION_ID,
      provider: 'storage',
      object_ref: 'global/loto/refresher.mp4',
      token_ttl_seconds: 600,
    })
  })

  it('404 for tenant-scoped modules outside the caller tenant', async () => {
    queueGate()
    queueModuleAndVersion({}, { library_scope: 'tenant', tenant_id: OTHER_TENANT_ID })
    const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }), ctx())
    expect(res.status).toBe(404)
  })

  it('503 for stream versions while Cloudflare env is not configured', async () => {
    queueGate()
    queueModuleAndVersion({ video_provider: 'cloudflare', video_external_id: STREAM_UID })
    const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }), ctx())
    expect(res.status).toBe(503)
  })

  it('returns a token-bearing HLS URL for stream versions', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct'
    process.env.CLOUDFLARE_STREAM_API_TOKEN = 'token'
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID = 'key-id-1'
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM = PRIVATE_PEM
    process.env.CLOUDFLARE_STREAM_CUSTOMER_DOMAIN = 'customer-test.cloudflarestream.com'

    queueGate()
    queueModuleAndVersion({ video_provider: 'cloudflare', video_external_id: STREAM_UID })
    const res = await issuePlaybackUrl(req({ module_version_id: VERSION_ID }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider).toBe('cloudflare')
    expect(body.url).toMatch(/^https:\/\/customer-test\.cloudflarestream\.com\/.+\/manifest\/video\.m3u8$/)
    // The path segment is the signed JWT, not the raw video UID.
    expect(body.url).not.toContain(STREAM_UID)

    const audit = captured.inserts.find(i => i.table === 'strike_media_access')?.payload as Record<string, unknown>
    expect(audit).toMatchObject({ provider: 'cloudflare', object_ref: STREAM_UID })
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
