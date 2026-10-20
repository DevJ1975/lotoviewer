import { beforeEach, describe, expect, it, vi } from 'vitest'

// Block modules: the attempt opened by /start is the unit of evidence, and
// /submit refuses a pass until every required block has been reached. These
// tests pin the server-side half of that contract (the player is untrusted).

const { authGetUser, captured, queues, resetMockState, tableProxy } = vi.hoisted(() => {
  type ChainResult = { data?: unknown; error?: { message: string } | null; count?: number | null }
  const queues = new Map<string, ChainResult[]>()
  const captured = {
    inserts: [] as Array<{ table: string; payload: unknown }>,
    upserts: [] as Array<{ table: string; payload: unknown }>,
    updates: [] as Array<{ table: string; payload: unknown }>,
  }
  const authGetUser = vi.fn()
  function next(table: string): ChainResult {
    return queues.get(table)?.shift() ?? { data: null, error: null }
  }
  function tableProxy(table: string) {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'not', 'is', 'gte', 'order', 'limit']) chain[method] = () => chain
    chain.insert = (payload: unknown) => { captured.inserts.push({ table, payload }); return chain }
    chain.upsert = (payload: unknown) => { captured.upserts.push({ table, payload }); return chain }
    chain.update = (payload: unknown) => { captured.updates.push({ table, payload }); return chain }
    chain.maybeSingle = async () => next(table)
    chain.single = async () => next(table)
    chain.then = (resolve: (v: ChainResult) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(next(table)).then(resolve, reject)
    return chain
  }
  function resetMockState() {
    queues.clear()
    captured.inserts.length = 0
    captured.upserts.length = 0
    captured.updates.length = 0
    authGetUser.mockReset()
  }
  return { authGetUser, captured, queues, resetMockState, tableProxy }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: authGetUser } }) }))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tableProxy(t) }) }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const MODULE_ID = '22222222-2222-2222-2222-222222222222'
const VERSION_ID = '33333333-3333-3333-3333-333333333333'
const ATTEMPT_ID = '44444444-4444-4444-4444-444444444444'
const USER_ID = '55555555-5555-5555-5555-555555555555'
const MEMBER_ID = '66666666-6666-6666-6666-666666666666'

const CONTENT = {
  blocks: [
    { key: 'scene', kind: 'motion_scene', title: 'Why', script: 's', beats: [], image: null,
      narration: { audio_path: 'a.mp3', captions_path: 'a.vtt', transcript: 's', duration_ms: 1000 } },
    { key: 'sort', kind: 'drag_sort', prompt: 'Order', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] },
  ],
}

function queue(table: string, ...rs: Array<{ data?: unknown; error?: { message: string } | null; count?: number | null }>) {
  queues.set(table, [...(queues.get(table) ?? []), ...rs])
}

function queueGateAndVersion(versionOverrides: Record<string, unknown> = {}) {
  authGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: 'w@example.com' } }, error: null })
  queue('profiles', { data: { is_superadmin: false } })
  queue('tenant_memberships', { data: { role: 'member', invite_cancelled_at: null, tenants: { disabled_at: null } } })
  queue('tenants', { data: { name: 'T', modules: { strike: true }, settings: {}, disabled_at: null } })
  queue('strike_modules', { data: { id: MODULE_ID, tenant_id: null, library_scope: 'global', status: 'published' } })
  queue('strike_module_versions', {
    data: {
      id: VERSION_ID, module_id: MODULE_ID, tenant_id: null, library_scope: 'global', status: 'published',
      passing_score: 80, retake_limit: null, video_external_id: null, video_meta: null,
      content: CONTENT, validity_days: 365, download_path: null, ...versionOverrides,
    },
  })
  queue('members', { data: { id: MEMBER_ID } })
}

function post(route: string, body: unknown) {
  return new Request(`http://localhost/api/strike/${MODULE_ID}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t', 'x-active-tenant': TENANT_ID },
    body: JSON.stringify(body),
  })
}

const ctx = () => ({ params: Promise.resolve({ moduleId: MODULE_ID }) })
const ownedOpenAttempt = { id: ATTEMPT_ID, tenant_id: TENANT_ID, user_id: USER_ID, member_id: MEMBER_ID, module_version_id: VERSION_ID, submitted_at: null }

beforeEach(() => {
  resetMockState()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPERADMIN_EMAILS = ''
})

describe('POST /api/strike/[moduleId]/events', () => {
  it('rejects events for a block key the version does not contain', async () => {
    const { POST } = await import('@/app/api/strike/[moduleId]/events/route')
    queueGateAndVersion()
    queue('strike_attempts', { data: ownedOpenAttempt })
    const res = await POST(post('events', { module_version_id: VERSION_ID, attempt_id: ATTEMPT_ID, events: [{ block_key: 'ghost', event: 'seen' }] }), ctx())
    expect(res.status).toBe(400)
    expect(captured.upserts).toHaveLength(0)
  })

  it("hides another learner's attempt as not found", async () => {
    const { POST } = await import('@/app/api/strike/[moduleId]/events/route')
    queueGateAndVersion()
    queue('strike_attempts', { data: { ...ownedOpenAttempt, user_id: 'someone-else' } })
    const res = await POST(post('events', { module_version_id: VERSION_ID, attempt_id: ATTEMPT_ID, events: [{ block_key: 'scene', event: 'seen' }] }), ctx())
    expect(res.status).toBe(404)
  })

  it('upserts valid events idempotently against the attempt', async () => {
    const { POST } = await import('@/app/api/strike/[moduleId]/events/route')
    queueGateAndVersion()
    queue('strike_attempts', { data: ownedOpenAttempt })
    const res = await POST(post('events', {
      module_version_id: VERSION_ID, attempt_id: ATTEMPT_ID,
      events: [{ block_key: 'scene', event: 'completed', dwell_ms: 31_000 }],
    }), ctx())
    expect(res.status).toBe(200)
    expect(captured.upserts[0].payload).toEqual([
      expect.objectContaining({ tenant_id: TENANT_ID, attempt_id: ATTEMPT_ID, block_key: 'scene', event: 'completed', dwell_ms: 31_000 }),
    ])
  })

  it('refuses malformed or oversized batches before touching the database', async () => {
    const { POST } = await import('@/app/api/strike/[moduleId]/events/route')
    queueGateAndVersion()
    const tooMany = Array.from({ length: 51 }, () => ({ block_key: 'scene', event: 'seen' }))
    expect((await POST(post('events', { module_version_id: VERSION_ID, attempt_id: ATTEMPT_ID, events: tooMany }), ctx())).status).toBe(400)
  })
})

describe('POST /api/strike/[moduleId]/submit for a block module', () => {
  it('requires the attempt opened by /start', async () => {
    const { POST } = await import('@/app/api/strike/[moduleId]/submit/route')
    queueGateAndVersion()
    const res = await POST(post('submit', { module_version_id: VERSION_ID, answers: {} }), ctx())
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/Start the module/)
  })

  it('refuses the knowledge check until every required block is reached', async () => {
    const { POST } = await import('@/app/api/strike/[moduleId]/submit/route')
    queueGateAndVersion()
    queue('strike_attempts', { data: ownedOpenAttempt })
    queue('strike_block_events', { data: [{ block_key: 'scene', event: 'seen' }] })
    const res = await POST(post('submit', { module_version_id: VERSION_ID, attempt_id: ATTEMPT_ID, answers: {} }), ctx())
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/2 remaining/)
    expect(captured.inserts.filter(i => i.table === 'strike_completions')).toHaveLength(0)
  })

  it('grades a finished attempt and records a member-keyed completion that expires per validity_days', async () => {
    const { POST } = await import('@/app/api/strike/[moduleId]/submit/route')
    queueGateAndVersion()
    queue('strike_attempts', { data: ownedOpenAttempt })
    queue('strike_block_events', { data: [{ block_key: 'scene', event: 'completed' }, { block_key: 'sort', event: 'completed' }] })
    queue('strike_quiz_questions', { data: [{ id: 'q1', question_type: 'multiple_choice', required: true, points: 1, explanation: null, graded: true }] })
    queue('strike_quiz_answers', { data: [{ id: 'a1', question_id: 'q1', is_correct: true }] })
    queue('strike_attempts', { data: { id: ATTEMPT_ID } })

    const before = Date.now()
    const res = await POST(post('submit', { module_version_id: VERSION_ID, attempt_id: ATTEMPT_ID, answers: { q1: 'a1' } }), ctx())
    expect(res.status).toBe(201)
    expect(captured.updates.find(u => u.table === 'strike_attempts')?.payload).toEqual(expect.objectContaining({ passed: true, score_percent: 100 }))

    const completion = captured.inserts.find(i => i.table === 'strike_completions')?.payload as Record<string, unknown>
    expect(completion).toEqual(expect.objectContaining({ user_id: USER_ID, member_id: MEMBER_ID, attempt_id: ATTEMPT_ID, passed: true }))
    const expiresInDays = (new Date(completion.expires_at as string).getTime() - before) / 86_400_000
    expect(expiresInDays).toBeGreaterThan(364.9)
    expect(expiresInDays).toBeLessThan(365.1)
  })
})

describe('POST /api/strike/[moduleId]/start', () => {
  it('resumes an open attempt and returns the blocks already reached', async () => {
    const { POST } = await import('@/app/api/strike/[moduleId]/start/route')
    queueGateAndVersion()
    queue('strike_attempts', { data: { id: ATTEMPT_ID } })
    queue('strike_block_events', { data: [{ block_key: 'scene', event: 'completed' }] })
    const res = await POST(post('start', { module_version_id: VERSION_ID }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ attempt_id: ATTEMPT_ID, reached: [{ block_key: 'scene', event: 'completed' }], resumed: true })
    expect(captured.inserts).toHaveLength(0)
  })

  it('opens a new attempt bound to the learner and their roster entry', async () => {
    const { POST } = await import('@/app/api/strike/[moduleId]/start/route')
    queueGateAndVersion()
    queue('strike_attempts', { data: null }, { data: { id: ATTEMPT_ID } })
    const res = await POST(post('start', { module_version_id: VERSION_ID }), ctx())
    expect(res.status).toBe(201)
    expect(captured.inserts[0]).toEqual({
      table: 'strike_attempts',
      payload: expect.objectContaining({ user_id: USER_ID, member_id: MEMBER_ID, module_version_id: VERSION_ID }),
    })
  })
})
