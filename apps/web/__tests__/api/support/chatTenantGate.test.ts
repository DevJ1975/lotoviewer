// Regression guard for the support-chat cross-tenant fix.
//
// authedReporter() must NEVER trust the x-active-tenant header on its own: the
// active tenant scopes RLS-bypassing service-role reads (the support data
// tools), selects the tenant's stored Anthropic key, and stamps every row the
// route writes. A member of tenant A who sends x-active-tenant: <tenant B>
// must resolve to a null tenant (tenantless: general KB, env key, no data
// tools), not to tenant B. The verification is delegated to requireTenantMember.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── getUser (identity) ────────────────────────────────────────────────────
const getUserMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}))

// ── profiles lookup (display name) ────────────────────────────────────────
const maybeSingleMock = vi.fn().mockResolvedValue({ data: { full_name: 'Jane Doe' } })
const adminChain = {
  select: () => adminChain,
  eq:     () => adminChain,
  maybeSingle: maybeSingleMock,
}
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({ from: () => adminChain }) }))

// ── the tenant gate (the authority we must delegate to) ───────────────────
const requireTenantMemberMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: (req: Request) => requireTenantMemberMock(req),
}))

// ── heavy siblings the route imports at module load — stub to no-ops ───────
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('resend', () => ({ Resend: class { emails = { send: vi.fn() } } }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }))

const TENANT_B = '00000000-0000-0000-0000-0000000000b0'

function reqWith(headers: Record<string, string>): Request {
  return new Request('http://x/api/support/chat', { method: 'POST', headers, body: '{}' })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-a', email: 'a@example.com' } }, error: null })
  maybeSingleMock.mockResolvedValue({ data: { full_name: 'Jane Doe' } })
})

describe('support/chat authedReporter — tenant verification', () => {
  it('returns tenantId=null when no x-active-tenant header is present (tenantless)', async () => {
    const { authedReporter } = await import('@/app/api/support/chat/route')
    const reporter = await authedReporter(reqWith({ authorization: 'Bearer t' }))
    expect(reporter?.id).toBe('user-a')
    expect(reporter?.tenantId).toBeNull()
    expect(requireTenantMemberMock).not.toHaveBeenCalled()
  })

  it('does NOT trust the header when the user is not a member (degrades to tenantless)', async () => {
    requireTenantMemberMock.mockResolvedValue({ ok: false, status: 403, message: 'Not a member of this tenant' })
    const { authedReporter } = await import('@/app/api/support/chat/route')
    const reporter = await authedReporter(reqWith({ authorization: 'Bearer t', 'x-active-tenant': TENANT_B }))
    // The attacker-supplied tenant must NOT leak through.
    expect(reporter?.tenantId).toBeNull()
    expect(requireTenantMemberMock).toHaveBeenCalledOnce()
  })

  it('honours the header only after the gate verifies membership', async () => {
    requireTenantMemberMock.mockResolvedValue({ ok: true, tenantId: TENANT_B, userId: 'user-a', role: 'member' })
    const { authedReporter } = await import('@/app/api/support/chat/route')
    const reporter = await authedReporter(reqWith({ authorization: 'Bearer t', 'x-active-tenant': TENANT_B }))
    expect(reporter?.tenantId).toBe(TENANT_B)
  })

  it('returns null for a missing/invalid bearer token', async () => {
    const { authedReporter } = await import('@/app/api/support/chat/route')
    expect(await authedReporter(reqWith({}))).toBeNull()
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad token' } })
    expect(await authedReporter(reqWith({ authorization: 'Bearer bad' }))).toBeNull()
  })
})
