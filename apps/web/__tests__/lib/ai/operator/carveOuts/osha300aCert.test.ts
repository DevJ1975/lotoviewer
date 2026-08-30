import { describe, it, expect, vi, beforeEach } from 'vitest'

// FIFO-scripted supabaseAdmin mock that records each query's table / op /
// payload / filters, so we can assert the conditional-update guards on the
// osha_annual_summaries table. Mirrors the carveOutAppliers test harness.
interface Call { table: string; op: 'select' | 'insert' | 'update'; payload?: Record<string, unknown>; filters: Record<string, unknown> }
let results: Array<{ data?: unknown; error?: { message: string } | null }>
let calls: Call[]

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: {} }
  const b: Record<string, unknown> = {}
  const ret = () => b
  b.select = ret
  b.order = ret
  b.eq = (c: string, v: unknown) => { call.filters[c] = v; return b }
  b.is = (c: string, v: unknown) => { call.filters[`is_${c}`] = v; return b }
  b.not = (c: string, _o: string, v: unknown) => { call.filters[`not_${c}`] = v; return b }
  b.insert = (p: Record<string, unknown>) => { call.op = 'insert'; call.payload = p; return b }
  b.update = (p: Record<string, unknown>) => { call.op = 'update'; call.payload = p; return b }
  const settle = () => { calls.push(call); return Promise.resolve(results.shift() ?? { data: null, error: null }) }
  b.maybeSingle = settle
  b.single = settle
  b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => settle().then(onF, onR)
  return b
}

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }))

import { certifyOsha300a, osha300aCertApplier } from '@/lib/ai/operator/carveOuts/osha300aCert'
import { isRegulatedTool } from '@/lib/ai/operator/types'

const ctx = { tenantId: 'tenant-A', userId: 'approver-1' }
const EST = '11111111-1111-4111-8111-111111111111'
const YEAR = 2025
const APPROVER = '22222222-2222-4222-8222-222222222222'

beforeEach(() => { results = []; calls = [] })

describe('certify_osha_300a — stage', () => {
  if (!isRegulatedTool(certifyOsha300a)) throw new Error('certifyOsha300a must be a regulated tool')
  const stage = certifyOsha300a.stage

  it('stages an uncertified 300A with an establishment-named summary line', async () => {
    results = [
      { data: { id: 'sum-1', certified_at: null, osha_establishments: { establishment_name: 'Plant 7' } }, error: null },
    ]
    const out = await stage({ establishment_id: EST, year: YEAR }, ctx as never)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.payload).toEqual({ establishment_id: EST, year: YEAR })
    expect(out.summary).toBe('Certify the OSHA 300A annual summary for Plant 7 2025')

    // Read is tenant-scoped on the natural (establishment_id, year) key.
    const read = calls[0]
    expect(read.table).toBe('osha_annual_summaries')
    expect(read.filters).toMatchObject({ tenant_id: 'tenant-A', establishment_id: EST, year: YEAR })
  })

  it('refuses when no 300A summary exists for that establishment + year', async () => {
    results = [{ data: null, error: null }]
    const out = await stage({ establishment_id: EST, year: YEAR }, ctx as never)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toMatch(/no 300a annual summary exists/i)
  })

  it('refuses an already-certified 300A', async () => {
    results = [{ data: { id: 'sum-1', certified_at: '2026-02-01T00:00:00Z', osha_establishments: { establishment_name: 'Plant 7' } }, error: null }]
    const out = await stage({ establishment_id: EST, year: YEAR }, ctx as never)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toMatch(/already certified/i)
  })

  it('refuses a malformed key before any query', async () => {
    const out = await stage({ establishment_id: 'nope', year: YEAR }, ctx as never)
    expect(out.ok).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('osha300aCertApplier — apply', () => {
  it('certifies an uncertified 300A as the approver and snapshots the prior null cert fields', async () => {
    results = [
      { data: { id: 'sum-1', year: YEAR, certified_at: null, certified_by: null, certified_typed_name: null, osha_establishments: { establishment_name: 'Plant 7' } }, error: null },
      { data: { full_name: 'Dana Owner', email: 'dana@acme.test' }, error: null },
      { data: [{ id: 'sum-1', year: YEAR, osha_establishments: { establishment_name: 'Plant 7' } }], error: null },
    ]
    const out = await osha300aCertApplier.apply(ctx, { establishment_id: EST, year: YEAR }, APPROVER)
    expect(out.summary).toMatch(/Plant 7 2025/)
    expect(out.prevState).toEqual({ certified_by: null, certified_at: null, certified_typed_name: null })

    const update = calls.find(c => c.op === 'update')!
    expect(update.table).toBe('osha_annual_summaries')
    expect(update.payload).toMatchObject({ certified_by: APPROVER, certified_typed_name: 'Dana Owner' })
    expect(update.payload!.certified_at).toBeTruthy()
    // the WHERE re-asserts uncertified + the natural key + tenant
    expect(update.filters).toMatchObject({ tenant_id: 'tenant-A', establishment_id: EST, year: YEAR, is_certified_at: null })
  })

  it('falls back to the approver email when the profile has no full name', async () => {
    results = [
      { data: { id: 'sum-1', year: YEAR, certified_at: null, certified_by: null, certified_typed_name: null, osha_establishments: { establishment_name: 'Plant 7' } }, error: null },
      { data: { full_name: null, email: 'dana@acme.test' }, error: null },
      { data: [{ id: 'sum-1', year: YEAR, osha_establishments: { establishment_name: 'Plant 7' } }], error: null },
    ]
    await osha300aCertApplier.apply(ctx, { establishment_id: EST, year: YEAR }, APPROVER)
    const update = calls.find(c => c.op === 'update')!
    expect(update.payload).toMatchObject({ certified_typed_name: 'dana@acme.test' })
  })

  it('refuses an already-certified 300A — no update issued', async () => {
    results = [{ data: { id: 'sum-1', year: YEAR, certified_at: '2026-02-01T00:00:00Z', certified_by: 'someone', certified_typed_name: 'Someone', osha_establishments: { establishment_name: 'Plant 7' } }, error: null }]
    await expect(osha300aCertApplier.apply(ctx, { establishment_id: EST, year: YEAR }, APPROVER)).rejects.toThrow(/already certified/i)
    expect(calls.some(c => c.op === 'update')).toBe(false)
  })

  it('refuses a missing 300A summary', async () => {
    results = [{ data: null, error: null }]
    await expect(osha300aCertApplier.apply(ctx, { establishment_id: EST, year: YEAR }, APPROVER)).rejects.toThrow(/not found/i)
  })

  it('throws on a lost race (the guarded update affects no rows)', async () => {
    results = [
      { data: { id: 'sum-1', year: YEAR, certified_at: null, certified_by: null, certified_typed_name: null, osha_establishments: { establishment_name: 'Plant 7' } }, error: null },
      { data: { full_name: 'Dana Owner', email: 'dana@acme.test' }, error: null },
      { data: [], error: null },
    ]
    await expect(osha300aCertApplier.apply(ctx, { establishment_id: EST, year: YEAR }, APPROVER)).rejects.toThrow(/changed before/i)
  })

  it('rejects a payload without a valid key before any query', async () => {
    await expect(osha300aCertApplier.apply(ctx, { establishment_id: 'nope', year: YEAR }, APPROVER)).rejects.toThrow(/establishment_id/i)
    expect(calls).toEqual([])
  })
})

describe('osha300aCertApplier — rollback', () => {
  it('clears all cert fields, guarded on currently-certified + tenant', async () => {
    results = [{ data: [{ id: 'sum-1', year: YEAR, osha_establishments: { establishment_name: 'Plant 7' } }], error: null }]
    const out = await osha300aCertApplier.rollback(ctx, { establishment_id: EST, year: YEAR }, {})
    expect(out.summary).toMatch(/uncertified again/i)

    const update = calls.find(c => c.op === 'update')!
    expect(update.payload).toEqual({ certified_by: null, certified_at: null, certified_typed_name: null })
    expect(update.filters).toMatchObject({ tenant_id: 'tenant-A', establishment_id: EST, year: YEAR, not_certified_at: null })
  })

  it('throws when there is nothing to roll back (no rows match the guard)', async () => {
    results = [{ data: [], error: null }]
    await expect(osha300aCertApplier.rollback(ctx, { establishment_id: EST, year: YEAR }, {})).rejects.toThrow(/nothing to roll back/i)
  })

  it('rejects a payload without a valid key before any query', async () => {
    await expect(osha300aCertApplier.rollback(ctx, { establishment_id: 'nope', year: YEAR }, {})).rejects.toThrow(/establishment_id/i)
    expect(calls).toEqual([])
  })
})
