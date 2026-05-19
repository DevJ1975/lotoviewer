import { beforeEach, describe, expect, it, vi } from 'vitest'

// End-to-end scenario test for the LOTO supervisor review flow.
//
// "E2E" in a vitest harness can't drive a real browser; it CAN string
// the API routes together in the same order a real user would hit
// them and assert on the cumulative state. That's what this test does:
//
//   1. Admin mints a tenant-wide public link.
//   2. Supervisor opens /review/<token>, marks an equipment item for
//      review with a typed name.
//   3. Admin opens /admin/loto/review-queue (the data is on
//      loto_equipment, read with RLS — we exercise the read by query
//      and the clear action via /api/admin/loto/review-queue).
//   4. Admin extends the link's expiry by +24h.
//
// The whole flow is stitched through the same mocked Supabase the
// individual route tests use; the value here is catching breaks in
// the seams between routes that unit tests don't surface.

import { POST as createReviewLinks } from '@/app/api/admin/review-links/route'
import { POST as publicReviewAction } from '@/app/api/review/[token]/route'
import { POST as reviewQueueAction }  from '@/app/api/admin/loto/review-queue/route'
import { POST as extendReviewLink }   from '@/app/api/admin/review-links/[id]/extend/route'

const { authGetUser, captured, queues, resetMockState, tableProxy } = vi.hoisted(() => {
  type ChainResult = { data?: unknown; error?: { message: string } | null }
  const queues = new Map<string, ChainResult[]>()
  const captured = {
    inserts: [] as Array<{ table: string; payload: unknown }>,
    updates: [] as Array<{ table: string; payload: unknown }>,
  }
  const authGetUser = vi.fn()
  function next(table: string): ChainResult {
    return queues.get(table)?.shift() ?? { data: null, error: null }
  }
  function tableProxy(table: string) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      in:     () => chain,
      order:  () => chain,
      single: vi.fn(async () => next(table)),
      maybeSingle: vi.fn(async () => next(table)),
      insert: (payload: unknown) => {
        captured.inserts.push({ table, payload })
        return chain
      },
      update: (payload: unknown) => {
        captured.updates.push({ table, payload })
        return chain
      },
    }
    return chain
  }
  function resetMockState() {
    queues.clear()
    captured.inserts.length = 0
    captured.updates.length = 0
    authGetUser.mockReset()
  }
  return { authGetUser, captured, queues, resetMockState, tableProxy }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: authGetUser } }),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => tableProxy(t),
  }),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const LINK_ID   = '22222222-2222-2222-2222-222222222222'
const TOKEN     = '0123456789abcdef0123456789abcdef'

function queue(table: string, ...rs: Array<{ data?: unknown; error?: { message: string } | null }>) {
  queues.set(table, [...(queues.get(table) ?? []), ...rs])
}

function adminReq(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      Authorization:     'Bearer test',
      'Content-Type':    'application/json',
      'x-active-tenant': TENANT_ID,
    },
    body: JSON.stringify(body),
  })
}

function publicReq(body: unknown) {
  return new Request('http://localhost/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function tokenCtx() { return { params: Promise.resolve({ token: TOKEN }) } }
function linkCtx()  { return { params: Promise.resolve({ id: LINK_ID }) } }

describe('LOTO supervisor review flow — end-to-end scenario', () => {
  beforeEach(() => {
    resetMockState()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPERADMIN_EMAILS = 'admin@example.com'
    authGetUser.mockResolvedValue({
      data: { user: { id: 'admin-user', email: 'admin@example.com' } },
      error: null,
    })
  })

  it('admin mints → supervisor flags → admin clears → admin extends', async () => {
    // ── Step 1: admin mints the public link ──────────────────────────────
    queue('profiles', { data: { is_superadmin: true } })
    queue('loto_review_links', { data: null })          // no active link yet
    const futureMs = Date.now() + 72 * 3_600_000
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        token: TOKEN,
        expires_at: new Date(futureMs).toISOString(),
        extension_count: 0,
        last_extended_at: null,
        created_at: new Date().toISOString(),
      },
    })
    const mintRes = await createReviewLinks(adminReq('/api/admin/review-links', { is_public: true }))
    expect(mintRes.status).toBe(201)
    const minted = await mintRes.json()
    expect(minted.link.token).toBe(TOKEN)
    expect(minted.link.review_url).toContain(`/review/${TOKEN}`)

    // ── Step 2: supervisor flags an equipment row ────────────────────────
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        tenant_id: TENANT_ID,
        department: null,
        is_public: true,
        expires_at: new Date(futureMs).toISOString(),
        revoked_at: null,
        first_viewed_at: null,
        signed_off_at: null,
      },
    })
    // Tenant-match lookup before update
    queue('loto_equipment', { data: { equipment_id: 'EQ-FLAG-1' } })

    const flagRes = await publicReviewAction(publicReq({
      action:        'mark-for-review',
      equipment_id:  'EQ-FLAG-1',
      reviewer_name: 'Sam Supervisor',
      reason:        'Photo looks faded; please verify.',
    }), tokenCtx())
    expect(flagRes.status).toBe(200)

    const flagUpdate = captured.updates.find(u => u.table === 'loto_equipment')
    expect(flagUpdate).toBeTruthy()
    expect(flagUpdate?.payload).toMatchObject({
      flagged_for_review_by:  'Sam Supervisor',
      flagged_for_review_via: 'public-link',
    })

    // ── Step 3: admin clears the flag through the queue API ──────────────
    queue('profiles', { data: { is_superadmin: true } })
    queue('loto_equipment', { data: { equipment_id: 'EQ-FLAG-1', flagged_for_review_at: null } })

    const clearRes = await reviewQueueAction(adminReq('/api/admin/loto/review-queue', {
      equipment_id: 'EQ-FLAG-1',
      action:       'clear',
    }))
    expect(clearRes.status).toBe(200)

    const clearUpdate = captured.updates.find(u =>
      u.table === 'loto_equipment'
      && (u.payload as Record<string, unknown>).flagged_for_review_at === null,
    )
    expect(clearUpdate).toBeTruthy()

    // ── Step 4: admin extends the link by 24h ────────────────────────────
    queue('profiles', { data: { is_superadmin: true } })
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        expires_at: new Date(futureMs).toISOString(),
        revoked_at: null,
        extension_count: 0,
      },
    })
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        expires_at: new Date(futureMs + 24 * 3_600_000).toISOString(),
        extension_count: 1,
        last_extended_at: new Date().toISOString(),
        last_extended_by: 'admin-user',
      },
    })

    const extendRes = await extendReviewLink(adminReq(`/api/admin/review-links/${LINK_ID}/extend`, { hours: 24 }), linkCtx())
    expect(extendRes.status).toBe(200)
    const extendBody = await extendRes.json()
    expect(extendBody.link.extension_count).toBe(1)
  })

  it('non-admin supervisor on the public link cannot mint or extend', async () => {
    // No is_superadmin, no tenant_membership row
    queue('profiles', { data: { is_superadmin: false } })
    queue('tenant_memberships', { data: null })
    const mintRes = await createReviewLinks(adminReq('/api/admin/review-links', { is_public: true }))
    expect(mintRes.status).toBe(403)

    queue('profiles', { data: { is_superadmin: false } })
    queue('tenant_memberships', { data: null })
    const extendRes = await extendReviewLink(adminReq(`/api/admin/review-links/${LINK_ID}/extend`, { hours: 24 }), linkCtx())
    expect(extendRes.status).toBe(403)
  })
})
