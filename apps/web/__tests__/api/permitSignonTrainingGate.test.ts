// The §1910.146(g) / §1910.147(c)(7) training gate must FAIL CLOSED.
//
// The route reads loto_training_records through the service-role client and
// used to guard the gate with `if (!trainingErr && ...)`. That treated every
// error — statement timeout, connection reset, revoked grant — the same as
// "table not migrated yet", which default-PASSES. A 3-second PostgREST blip at
// shift change was enough to let a worker with expired confined-space training
// sign in and enter a permit-required space, shown green on the roster.
//
// Only 42P01 / PGRST205 ("the table isn't in the schema") may default-pass.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

interface ChainResult { data?: unknown; error?: { message: string; code?: string } | null }
const queues = new Map<string, ChainResult[]>()
const inserts: Array<{ table: string }> = []

function queue(table: string, ...results: ChainResult[]) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table)!.push(...results)
}
function nextFor(table: string): ChainResult {
  const q = queues.get(table)
  return q && q.length ? q.shift()! : { data: null, error: null }
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const result = () => Promise.resolve(nextFor(table))
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        is:     () => chain,
        order:  () => chain,
        insert: () => { inserts.push({ table }); return chain },
        update: () => chain,
        single: result,
        maybeSingle: result,
        then: (onFulfilled: (v: ChainResult) => unknown) => Promise.resolve(nextFor(table)).then(onFulfilled),
      }
      return chain
    },
  }),
}))

import { POST } from '@/app/api/permit-signon/route'

const TOKEN  = 'b'.repeat(32)
const TENANT = '44444444-4444-4444-4444-444444444444'

function req(body: Record<string, unknown>): Request {
  return new Request('http://x/api/permit-signon', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token: TOKEN, ...body }),
  })
}

/** An active, supervisor-signed permit with one entrant. */
function queueActivePermit() {
  queue('loto_confined_space_permits', {
    data: {
      id: 'P1', tenant_id: TENANT, serial: 'CSP-1', space_id: 'S1', purpose: 'inspect',
      started_at: '2026-01-01T00:00:00Z', expires_at: '2999-01-01T00:00:00Z',
      canceled_at: null, entry_supervisor_signature_at: '2026-01-01T00:00:00Z',
      entrants: ['Alex'], attendants: [], signon_token: TOKEN,
    },
    error: null,
  })
}

beforeEach(() => {
  queues.clear()
  inserts.length = 0
})

describe('POST /api/permit-signon — training gate fails closed', () => {
  it('refuses sign-in with 503 when the training read errors', async () => {
    queueActivePermit()
    queue('loto_confined_space_entries', { data: [], error: null })
    queue('loto_training_records', { data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } })

    const res  = await POST(req({ action: 'sign-in', name: 'Alex' }))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toMatch(/verify training/i)
    // The entry must NOT have been recorded.
    expect(inserts.find(i => i.table === 'loto_confined_space_entries')).toBeUndefined()
  })

  it('refuses sign-in when the read fails with no error code at all', async () => {
    queueActivePermit()
    queue('loto_confined_space_entries', { data: [], error: null })
    queue('loto_training_records', { data: null, error: { message: 'fetch failed' } })

    const res = await POST(req({ action: 'sign-in', name: 'Alex' }))

    expect(res.status).toBe(503)
    expect(inserts.find(i => i.table === 'loto_confined_space_entries')).toBeUndefined()
  })

  // The one case that legitimately default-passes: a deployment that predates
  // migration 017 has no training table, and every worker would otherwise be
  // permanently locked out of QR sign-on.
  it('still allows sign-in when the table is genuinely not migrated (42P01)', async () => {
    queueActivePermit()
    queue('loto_confined_space_entries', { data: [], error: null })
    queue('loto_training_records', { data: null, error: { message: 'relation "loto_training_records" does not exist', code: '42P01' } })
    queue('loto_confined_space_entries', { data: { id: 'E1' }, error: null })

    const res = await POST(req({ action: 'sign-in', name: 'Alex' }))

    expect(res.status).toBe(200)
  })

  it('treats a PostgREST schema-cache miss (PGRST205) the same way', async () => {
    queueActivePermit()
    queue('loto_confined_space_entries', { data: [], error: null })
    queue('loto_training_records', { data: null, error: { message: 'Could not find the table', code: 'PGRST205' } })
    queue('loto_confined_space_entries', { data: { id: 'E1' }, error: null })

    const res = await POST(req({ action: 'sign-in', name: 'Alex' }))

    expect(res.status).toBe(200)
  })

  // Rendering the roster off a failed read would show every worker green —
  // the same fail-open, one screen earlier.
  it('does not render a roster when the training read errors', async () => {
    queueActivePermit()
    queue('loto_confined_space_entries', { data: [], error: null })
    queue('loto_training_records', { data: null, error: { message: 'connection reset by peer', code: '08006' } })

    const res = await POST(req({ action: 'lookup' }))

    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})
