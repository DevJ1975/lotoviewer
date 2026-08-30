// The review-links family must authorize through the SHARED tenant gate.
//
// These five routes each carried their own copy of requireTenantAdmin that
// checked the membership's role and nothing else. When lib/auth/tenantGate was
// hardened to mirror migration 190's RLS functions — rejecting a membership
// whose invite was cancelled, and any membership in a disabled tenant — the
// copies did not follow. A revoked admin kept working access to every route
// here, and because these routes query through the RLS-bypassing service-role
// client, the gate is the only access control on the path.
//
// The regression this pins is structural, so it is asserted structurally: the
// routes must delegate to the shared gate. A test that only exercised today's
// revocation rules would pass again the moment someone reintroduced a local
// copy that happened to implement them.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROUTES = [
  'app/api/admin/review-links/route.ts',
  'app/api/admin/review-links/[id]/route.ts',
  'app/api/admin/review-links/[id]/extend/route.ts',
  'app/api/admin/review-links/[id]/reconcile/route.ts',
  'app/api/admin/loto/review-queue/route.ts',
]

describe('review-links family — authorization is not reimplemented locally', () => {
  it.each(ROUTES)('%s imports the shared tenant gate', route => {
    const src = readFileSync(resolve(process.cwd(), route), 'utf8')
    expect(src).toContain("from '@/lib/auth/tenantGate'")
  })

  it.each(ROUTES)('%s defines no local gate of its own', route => {
    const src = readFileSync(resolve(process.cwd(), route), 'utf8')
    // A local definition is the exact shape that drifted from the shared one.
    expect(src).not.toMatch(/function\s+requireTenantAdmin/)
    // Resolving the JWT here means a hand-rolled gate came back with it.
    expect(src).not.toContain('auth.getUser(')
  })
})

// And the behaviour that drift cost us, asserted once through a real route.

const getUserMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (t: string) => getUserMock(t) } }),
}))

interface Result { data?: unknown; error?: unknown }
const queues = new Map<string, Result[]>()
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const next = (): Promise<Result> =>
        Promise.resolve(queues.get(table)?.shift() ?? { data: null, error: null })
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, order: () => chain,
        maybeSingle: next,
        then: (f: (v: Result) => unknown) => next().then(f),
      }
      return chain
    },
  }),
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/email/sendReviewLink', () => ({ sendReviewLinkEmail: vi.fn() }))

const TENANT = '00000000-0000-0000-0000-0000000000aa'

function queue(table: string, r: Result) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table)!.push(r)
}

function listRequest(): Request {
  return new Request('https://x/api/admin/review-links', {
    method: 'GET',
    headers: { authorization: 'Bearer tok', 'x-active-tenant': TENANT },
  })
}

beforeEach(() => {
  queues.clear()
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'U1', email: 'admin@x.com' } }, error: null })
  process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://project.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPERADMIN_EMAILS             = ''
})

describe('GET /api/admin/review-links honours revocation', () => {
  it.each([
    ['a cancelled invite',  { invite_cancelled_at: '2026-01-01T00:00:00Z', disabled_at: null }],
    ['a disabled tenant',   { invite_cancelled_at: null, disabled_at: '2026-01-01T00:00:00Z' }],
  ])('refuses an admin with %s', async (_label, state) => {
    const { GET } = await import('@/app/api/admin/review-links/route')
    queue('profiles', { data: { is_superadmin: false }, error: null })
    queue('tenant_memberships', {
      data: {
        role: 'admin',
        invite_cancelled_at: state.invite_cancelled_at,
        tenants: { disabled_at: state.disabled_at },
      },
      error: null,
    })

    const res = await GET(listRequest())
    expect(res.status).toBe(403)
  })

  it('still serves an admin in good standing', async () => {
    const { GET } = await import('@/app/api/admin/review-links/route')
    queue('profiles', { data: { is_superadmin: false }, error: null })
    queue('tenant_memberships', {
      data: { role: 'admin', invite_cancelled_at: null, tenants: { disabled_at: null } },
      error: null,
    })
    queue('loto_review_links', { data: [], error: null })

    const res = await GET(listRequest())
    expect(res.status).toBe(200)
  })
})
