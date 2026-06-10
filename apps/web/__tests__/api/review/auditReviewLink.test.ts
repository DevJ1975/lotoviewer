// Public audit-review API (/api/review/audit/[token]). The URL token is the
// auth, so the token-format gate, the link-kind gate, and the sign-off lock are
// all security boundaries. We mock supabaseAdmin with a per-table queue + a
// capture log, mirroring the review-link-business-rules harness.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/review/audit/[token]/route'

const { captured, queues, resetMockState, tableProxy } = vi.hoisted(() => {
  type ChainResult = { data?: unknown; error?: { message: string; code?: string } | null }

  const queues = new Map<string, ChainResult[]>()
  const captured = {
    updates: [] as Array<{ table: string; payload: unknown }>,
    filters: [] as Array<{ table: string; method: string; args: unknown[] }>,
  }

  function next(table: string): ChainResult {
    return queues.get(table)?.shift() ?? { data: null, error: null }
  }

  function tableProxy(table: string) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (...args: unknown[]) => { captured.filters.push({ table, method: 'eq', args }); return chain },
      is: (...args: unknown[]) => { captured.filters.push({ table, method: 'is', args }); return chain },
      in: (...args: unknown[]) => { captured.filters.push({ table, method: 'in', args }); return chain },
      order: () => chain,
      maybeSingle: () => Promise.resolve(next(table)),
      single: () => Promise.resolve(next(table)),
      update: (payload: unknown) => { captured.updates.push({ table, payload }); return chain },
      // Terminal: awaiting the chain (e.g. after .select('id')) resolves a queued result.
      then: (onF: (v: ChainResult) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(next(table)).then(onF, onR),
    }
    return chain
  }

  function resetMockState() {
    queues.clear()
    captured.updates.length = 0
    captured.filters.length = 0
  }

  return { captured, queues, resetMockState, tableProxy }
})

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({ from: (table: string) => tableProxy(table) }),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

const VALID_TOKEN = '0123456789abcdef0123456789abcdef'
const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const LINK_ID = '22222222-2222-2222-2222-222222222222'
const RUN_ID = '33333333-3333-3333-3333-333333333333'
const CHANGE_ID = '44444444-4444-4444-4444-444444444444'

function queue(table: string, ...results: Array<{ data?: unknown; error?: { message: string } | null }>) {
  queues.set(table, [...(queues.get(table) ?? []), ...results])
}

function ctx(token = VALID_TOKEN) {
  return { params: Promise.resolve({ token }) }
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/review/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// A valid, active, not-signed-off audit link row as returned by the lookup.
function activeAuditLink(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: LINK_ID,
      tenant_id: TENANT_ID,
      kind: 'audit',
      audit_run_id: RUN_ID,
      expires_at: '2099-01-01T00:00:00.000Z',
      revoked_at: null,
      first_viewed_at: '2026-05-19T00:00:00.000Z',
      signed_off_at: null,
      ...overrides,
    },
    error: null,
  }
}

beforeEach(() => {
  resetMockState()
})

describe('POST /api/review/audit/[token] — link gates', () => {
  it('400s on an invalid token format (never hits the DB)', async () => {
    const res = await POST(jsonRequest({ action: 'view-ack' }), ctx('not-a-valid-token'))
    expect(res.status).toBe(400)
    // Token never validated → no lookup query ran.
    expect(captured.filters).toHaveLength(0)
  })

  it('404s when the link is not an audit link (wrong kind)', async () => {
    queue('loto_review_links', {
      data: { id: LINK_ID, tenant_id: TENANT_ID, kind: 'placard', audit_run_id: null,
              expires_at: '2099-01-01T00:00:00.000Z', revoked_at: null, first_viewed_at: null, signed_off_at: null },
      error: null,
    })

    const res = await POST(jsonRequest({ action: 'decide-change', change_id: CHANGE_ID, decision: 'approved' }), ctx())
    expect(res.status).toBe(404)
  })

  it('404s when no link exists for the token', async () => {
    queue('loto_review_links', { data: null, error: null })
    const res = await POST(jsonRequest({ action: 'view-ack' }), ctx())
    expect(res.status).toBe(404)
  })
})

describe('POST /api/review/audit/[token] — decide-change', () => {
  it('flips a staged change scoped to the link run + tenant', async () => {
    queue('loto_review_links', activeAuditLink())
    // The update terminal returns one updated row id → success.
    queue('loto_audit_changes', { data: [{ id: CHANGE_ID }], error: null })

    const res = await POST(
      jsonRequest({ action: 'decide-change', change_id: CHANGE_ID, decision: 'approved', reviewer_name: 'Jo', note: 'ok' }),
      ctx(),
    )

    expect(res.status).toBe(200)
    // The update sets the decision and decided metadata.
    const update = captured.updates.find(u => u.table === 'loto_audit_changes')
    expect(update?.payload).toMatchObject({ status: 'approved', decided_by: 'Jo', decided_note: 'ok' })

    // Scoping: it filters by run_id and tenant_id from the link (not from the request body).
    const changeFilters = captured.filters.filter(f => f.table === 'loto_audit_changes')
    expect(changeFilters).toEqual(expect.arrayContaining([
      { table: 'loto_audit_changes', method: 'eq', args: ['run_id', RUN_ID] },
      { table: 'loto_audit_changes', method: 'eq', args: ['tenant_id', TENANT_ID] },
    ]))
    // Only non-terminal rows can flip.
    expect(changeFilters.some(f => f.method === 'in' && (f.args[1] as string[]).includes('pending'))).toBe(true)
  })

  it('409s when the change matches nothing (already applied / wrong run)', async () => {
    queue('loto_review_links', activeAuditLink())
    queue('loto_audit_changes', { data: [], error: null }) // no row updated

    const res = await POST(
      jsonRequest({ action: 'decide-change', change_id: CHANGE_ID, decision: 'rejected', reviewer_name: 'Jo' }),
      ctx(),
    )

    expect(res.status).toBe(409)
  })

  it('400s when decision is neither approved nor rejected', async () => {
    queue('loto_review_links', activeAuditLink())

    const res = await POST(
      jsonRequest({ action: 'decide-change', change_id: CHANGE_ID, decision: 'maybe' }),
      ctx(),
    )

    expect(res.status).toBe(400)
    // No update attempted on a malformed decision.
    expect(captured.updates).toHaveLength(0)
  })

  it('409s once the link is already signed off — no decision allowed', async () => {
    queue('loto_review_links', activeAuditLink({ signed_off_at: '2026-05-20T00:00:00.000Z' }))

    const res = await POST(
      jsonRequest({ action: 'decide-change', change_id: CHANGE_ID, decision: 'approved', reviewer_name: 'Jo' }),
      ctx(),
    )

    expect(res.status).toBe(409)
    // The sign-off lock blocks before any change update fires.
    expect(captured.updates.some(u => u.table === 'loto_audit_changes')).toBe(false)
  })
})

describe('POST /api/review/audit/[token] — signoff is one-shot', () => {
  it('200s on the first sign-off', async () => {
    queue('loto_review_links', activeAuditLink())
    // The conditional update (.is signed_off_at null) returns the row → won.
    queue('loto_review_links', { data: [{ id: LINK_ID }], error: null })

    const res = await POST(
      jsonRequest({ action: 'signoff', typed_name: 'Jo Reviewer', approved: true, notes: 'looks good' }),
      ctx(),
    )

    expect(res.status).toBe(200)
    const update = captured.updates.find(u => u.table === 'loto_review_links')
    expect(update?.payload).toMatchObject({ signoff_approved: true, signoff_typed_name: 'Jo Reviewer' })
  })

  it('409s when already signed off (lock checked before the signoff branch)', async () => {
    queue('loto_review_links', activeAuditLink({ signed_off_at: '2026-05-20T00:00:00.000Z' }))

    const res = await POST(
      jsonRequest({ action: 'signoff', typed_name: 'Jo Reviewer', approved: true }),
      ctx(),
    )

    expect(res.status).toBe(409)
  })
})
