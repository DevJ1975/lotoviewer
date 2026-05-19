import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as reviewQueueAction } from '@/app/api/admin/loto/review-queue/route'

// Integration tests for POST /api/admin/loto/review-queue. The clear
// action zeros the flag columns; the flag action sets them with
// via='admin'. Tenant + admin role are enforced by the gate.

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

function queue(table: string, ...rs: Array<{ data?: unknown; error?: { message: string } | null }>) {
  queues.set(table, [...(queues.get(table) ?? []), ...rs])
}

function req(body: unknown) {
  return new Request('http://localhost/api/admin/loto/review-queue', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      Authorization:     'Bearer test',
      'x-active-tenant': TENANT_ID,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/loto/review-queue', () => {
  beforeEach(() => {
    resetMockState()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPERADMIN_EMAILS = 'admin@example.com'
    authGetUser.mockResolvedValue({
      data: { user: { id: 'admin-user', email: 'admin@example.com' } },
      error: null,
    })
    queue('profiles', { data: { is_superadmin: true } })
  })

  it('400 when equipment_id is missing', async () => {
    const res = await reviewQueueAction(req({ action: 'clear' }))
    expect(res.status).toBe(400)
  })

  it('400 when action is unsupported', async () => {
    const res = await reviewQueueAction(req({ equipment_id: 'EQ-1', action: 'reflagulate' }))
    expect(res.status).toBe(400)
  })

  it('clear nulls every flag column', async () => {
    queue('loto_equipment', { data: { equipment_id: 'EQ-1', flagged_for_review_at: null } })

    const res = await reviewQueueAction(req({ equipment_id: 'EQ-1', action: 'clear' }))
    expect(res.status).toBe(200)
    expect(captured.updates[0]?.payload).toMatchObject({
      flagged_for_review_at:   null,
      flagged_for_review_by:   null,
      flagged_for_review_via:  null,
      flagged_for_review_note: null,
    })
  })

  it('flag sets via=admin and stamps the caller', async () => {
    queue('loto_equipment', { data: { equipment_id: 'EQ-1', flagged_for_review_at: new Date().toISOString() } })

    const res = await reviewQueueAction(req({ equipment_id: 'EQ-1', action: 'flag', reason: 'inconsistent labels' }))
    expect(res.status).toBe(200)
    const payload = captured.updates[0]?.payload as Record<string, unknown>
    expect(payload).toMatchObject({
      flagged_for_review_via:  'admin',
      flagged_for_review_by:   'admin@example.com',
      flagged_for_review_note: 'inconsistent labels',
    })
    expect(payload.flagged_for_review_at).toBeTruthy()
  })

  it('404 when the equipment is not found in the tenant', async () => {
    queue('loto_equipment', { data: null })
    const res = await reviewQueueAction(req({ equipment_id: 'EQ-UNKNOWN', action: 'clear' }))
    expect(res.status).toBe(404)
  })
})
