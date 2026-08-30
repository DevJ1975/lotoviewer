import { describe, it, expect, beforeEach, vi } from 'vitest'

// Locks the tenant-isolation contract of the QR sign-on flow. The route
// reads loto_training_records through the service-role client (RLS bypassed)
// and the §1910.146(g) gate matches workers by name — so the read MUST be
// scoped to the permit's own tenant. Without the filter, a same-named worker
// in another tenant could satisfy (or wrongly fail) this permit's gate.

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

// Records every .eq(column, value) per table so we can assert the training
// read was filtered by tenant_id; returns queued data for terminal awaits.
interface ChainResult { data?: unknown; error?: { message: string; code?: string } | null }
const queues = new Map<string, ChainResult[]>()
const eqCalls: Array<{ table: string; column: string; value: unknown }> = []

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
        eq:     (column: string, value: unknown) => { eqCalls.push({ table, column, value }); return chain },
        is:     () => chain,
        order:  () => chain,
        insert: () => chain,
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

const TOKEN = 'a'.repeat(32)
const TENANT = '33333333-3333-3333-3333-333333333333'

function lookup(): Request {
  return new Request('http://x/api/permit-signon', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'lookup', token: TOKEN }),
  })
}

beforeEach(() => {
  queues.clear()
  eqCalls.length = 0
})

describe('POST /api/permit-signon — training read tenant scoping', () => {
  it('filters loto_training_records by the permit tenant_id', async () => {
    // A permit in TENANT, signed and active, with one entrant.
    queue('loto_confined_space_permits', {
      data: {
        id: 'P1', tenant_id: TENANT, serial: 'CSP-1', space_id: 'S1', purpose: 'inspect',
        started_at: '2026-01-01T00:00:00Z', expires_at: '2999-01-01T00:00:00Z',
        canceled_at: null, entry_supervisor_signature_at: '2026-01-01T00:00:00Z',
        entrants: ['Alex'], attendants: [], signon_token: TOKEN,
      },
      error: null,
    })
    queue('loto_confined_space_entries', { data: [], error: null })
    queue('loto_training_records', { data: [], error: null })

    const res = await POST(lookup())
    expect(res.status).toBe(200)

    const trainingFilter = eqCalls.find(c => c.table === 'loto_training_records' && c.column === 'tenant_id')
    expect(trainingFilter).toBeDefined()
    expect(trainingFilter!.value).toBe(TENANT)
  })
})
