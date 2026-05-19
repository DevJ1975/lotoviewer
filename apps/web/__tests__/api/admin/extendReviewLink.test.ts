import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as extendReviewLink } from '@/app/api/admin/review-links/[id]/extend/route'

// Integration tests for POST /api/admin/review-links/[id]/extend.
// Exercises:
//   - Auth gate (no token → 401; non-admin → 403)
//   - Body validation (no hours → 24 default; negative → 400; >168 → 400)
//   - Expiry compute: extend from greatest(expires_at, now())
//   - Audit columns: extension_count bumps, last_extended_at + by are set
//   - Revoked-link guard (cannot extend a revoked row → 409)

const { authGetUser, captured, queues, resetMockState, tableProxy } = vi.hoisted(() => {
  type ChainResult = { data?: unknown; error?: { message: string } | null }
  const queues = new Map<string, ChainResult[]>()
  const captured = {
    updates: [] as Array<{ table: string; payload: unknown }>,
    filters: [] as Array<{ table: string; method: string; args: unknown[] }>,
  }
  const authGetUser = vi.fn()
  function next(table: string): ChainResult {
    return queues.get(table)?.shift() ?? { data: null, error: null }
  }
  function tableProxy(table: string) {
    const chain: Record<string, unknown> = {
      select: (...args: unknown[]) => { captured.filters.push({ table, method: 'select', args }); return chain },
      eq:     (...args: unknown[]) => { captured.filters.push({ table, method: 'eq',     args }); return chain },
      maybeSingle: vi.fn(async () => next(table)),
      update: (payload: unknown) => {
        captured.updates.push({ table, payload })
        return chain
      },
    }
    return chain
  }
  function resetMockState() {
    queues.clear()
    captured.updates.length = 0
    captured.filters.length = 0
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

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const LINK_ID   = '22222222-2222-2222-2222-222222222222'

function queue(table: string, ...rs: Array<{ data?: unknown; error?: { message: string } | null }>) {
  queues.set(table, [...(queues.get(table) ?? []), ...rs])
}

function req(body: unknown, opts: { auth?: boolean; tenant?: boolean } = {}) {
  return new Request(`http://localhost/api/admin/review-links/${LINK_ID}/extend`, {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      ...(opts.auth !== false ? { Authorization: 'Bearer test' } : {}),
      ...(opts.tenant !== false ? { 'x-active-tenant': TENANT_ID } : {}),
    },
    body: JSON.stringify(body),
  })
}

function ctx() { return { params: Promise.resolve({ id: LINK_ID }) } }

describe('POST /api/admin/review-links/[id]/extend', () => {
  beforeEach(() => {
    resetMockState()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPERADMIN_EMAILS = 'admin@example.com'
    authGetUser.mockResolvedValue({
      data: { user: { id: 'admin-user', email: 'admin@example.com' } },
      error: null,
    })
    // Default: pass the superadmin gate so each test only has to queue
    // the link rows.
    queue('profiles', { data: { is_superadmin: true } })
  })

  it('401 when the bearer token is missing', async () => {
    const res = await extendReviewLink(req({ hours: 24 }, { auth: false }), ctx())
    expect(res.status).toBe(401)
  })

  it('403 when the caller is not an admin / owner', async () => {
    queues.clear()
    queue('profiles', { data: { is_superadmin: false } })
    queue('tenant_memberships', { data: { role: 'member' } })
    const res = await extendReviewLink(req({ hours: 24 }), ctx())
    expect(res.status).toBe(403)
  })

  it('400 when hours is zero', async () => {
    const res = await extendReviewLink(req({ hours: 0 }), ctx())
    expect(res.status).toBe(400)
  })

  it('400 when hours exceeds the one-week cap', async () => {
    const res = await extendReviewLink(req({ hours: 200 }), ctx())
    expect(res.status).toBe(400)
  })

  it('409 when the link is already revoked', async () => {
    queue('loto_review_links',
      { data: { id: LINK_ID, expires_at: '2099-01-01T00:00:00.000Z', revoked_at: '2026-01-01T00:00:00.000Z', extension_count: 0 } },
    )
    const res = await extendReviewLink(req({ hours: 24 }), ctx())
    expect(res.status).toBe(409)
  })

  it('404 when the link is not in the caller tenant', async () => {
    queue('loto_review_links', { data: null })
    const res = await extendReviewLink(req({ hours: 24 }), ctx())
    expect(res.status).toBe(404)
  })

  it('extends from greatest(expires_at, now()) when the link is fresh', async () => {
    // Link expires 48h from now → new expiry = old + 24h.
    const futureMs = Date.now() + 48 * 3_600_000
    queue('loto_review_links',
      { data: { id: LINK_ID, expires_at: new Date(futureMs).toISOString(), revoked_at: null, extension_count: 0 } },
    )
    queue('loto_review_links',
      { data: { id: LINK_ID, expires_at: new Date(futureMs + 24 * 3_600_000).toISOString(), extension_count: 1, last_extended_at: new Date().toISOString(), last_extended_by: 'admin-user' } },
    )

    const res = await extendReviewLink(req({ hours: 24 }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.link.extension_count).toBe(1)
    expect(captured.updates[0]?.payload).toMatchObject({ extension_count: 1, last_extended_by: 'admin-user' })
  })

  it('extends from now() when the link has already expired', async () => {
    // Stale link, expired 5 hours ago → 24h extension starts from now,
    // not from the stale timestamp.
    const pastMs = Date.now() - 5 * 3_600_000
    queue('loto_review_links',
      { data: { id: LINK_ID, expires_at: new Date(pastMs).toISOString(), revoked_at: null, extension_count: 3 } },
    )
    queue('loto_review_links',
      { data: { id: LINK_ID, expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(), extension_count: 4, last_extended_at: new Date().toISOString(), last_extended_by: 'admin-user' } },
    )

    const res = await extendReviewLink(req({ hours: 24 }), ctx())
    expect(res.status).toBe(200)
    const update = captured.updates[0]?.payload as Record<string, string | number>
    const newExpiryMs = Date.parse(update.expires_at as string)
    // New expiry must be in the future, NOT pastMs + 24h.
    expect(newExpiryMs).toBeGreaterThan(Date.now())
    // ...and must be no more than the requested 24h + a small drift.
    expect(newExpiryMs - Date.now()).toBeLessThan(24.5 * 3_600_000)
    expect(update.extension_count).toBe(4)
  })

  it('defaults to 24 hours when no hours is supplied', async () => {
    const futureMs = Date.now() + 24 * 3_600_000
    queue('loto_review_links',
      { data: { id: LINK_ID, expires_at: new Date(futureMs).toISOString(), revoked_at: null, extension_count: 0 } },
    )
    queue('loto_review_links', { data: { id: LINK_ID, extension_count: 1 } })
    const res = await extendReviewLink(req({}), ctx())
    expect(res.status).toBe(200)
    const update = captured.updates[0]?.payload as Record<string, string>
    const newExpiryMs = Date.parse(update.expires_at)
    // Old + 24h ≈ new expiry, within a few seconds for clock drift.
    expect(Math.abs(newExpiryMs - (futureMs + 24 * 3_600_000))).toBeLessThan(1000)
  })
})
