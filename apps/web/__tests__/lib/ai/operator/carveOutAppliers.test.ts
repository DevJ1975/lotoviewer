import { describe, it, expect, vi, beforeEach } from 'vitest'

// FIFO-scripted supabaseAdmin mock that records each query's op / payload /
// filters, so we can assert the conditional-update guards on the permit table.
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

import { CARVE_OUT_APPLIERS } from '@/lib/ai/operator/carveOutAppliers'

const applier = CARVE_OUT_APPLIERS.permit_hot_work_auth!
const ctx = { tenantId: 'tenant-A', userId: 'approver-1' }
const PERMIT = '11111111-1111-4111-8111-111111111111'
const ORIG_PAI = '22222222-2222-4222-8222-222222222222'

beforeEach(() => { results = []; calls = [] })

describe('permit_hot_work_auth applier — apply', () => {
  it('signs an unsigned, active permit as the approver and snapshots the prior PAI', async () => {
    results = [
      { data: { id: PERMIT, serial: 'HWP-20260618-0003', pai_id: ORIG_PAI, pai_signature_at: null, canceled_at: null }, error: null },
      { data: [{ id: PERMIT, serial: 'HWP-20260618-0003' }], error: null },
    ]
    const out = await applier.apply(ctx, { permit_id: PERMIT }, 'approver-1')
    expect(out.summary).toMatch(/HWP-20260618-0003/)
    expect(out.prevState).toEqual({ pai_id: ORIG_PAI })

    const update = calls.find(c => c.op === 'update')!
    expect(update.table).toBe('loto_hot_work_permits')
    expect(update.payload).toMatchObject({ pai_id: 'approver-1' })
    expect(update.payload!.pai_signature_at).toBeTruthy()
    // the WHERE re-asserts unsigned + active + tenant so a concurrent change can't be clobbered
    expect(update.filters).toMatchObject({ id: PERMIT, tenant_id: 'tenant-A', is_pai_signature_at: null, is_canceled_at: null })
  })

  it('refuses a permit that is already authorized — no update issued', async () => {
    results = [{ data: { id: PERMIT, serial: 'HWP-1', pai_id: ORIG_PAI, pai_signature_at: '2026-06-18T00:00:00Z', canceled_at: null }, error: null }]
    await expect(applier.apply(ctx, { permit_id: PERMIT }, 'approver-1')).rejects.toThrow(/already authorized/i)
    expect(calls.some(c => c.op === 'update')).toBe(false)
  })

  it('refuses a canceled permit — no update issued', async () => {
    results = [{ data: { id: PERMIT, serial: 'HWP-1', pai_id: ORIG_PAI, pai_signature_at: null, canceled_at: '2026-06-18T00:00:00Z' }, error: null }]
    await expect(applier.apply(ctx, { permit_id: PERMIT }, 'approver-1')).rejects.toThrow(/canceled/i)
    expect(calls.some(c => c.op === 'update')).toBe(false)
  })

  it('refuses a missing permit', async () => {
    results = [{ data: null, error: null }]
    await expect(applier.apply(ctx, { permit_id: PERMIT }, 'approver-1')).rejects.toThrow(/not found/i)
  })

  it('throws on a lost race (the guarded update affects no rows)', async () => {
    results = [
      { data: { id: PERMIT, serial: 'HWP-1', pai_id: ORIG_PAI, pai_signature_at: null, canceled_at: null }, error: null },
      { data: [], error: null },
    ]
    await expect(applier.apply(ctx, { permit_id: PERMIT }, 'approver-1')).rejects.toThrow(/changed before/i)
  })

  it('rejects a payload without a valid permit_id before any query', async () => {
    await expect(applier.apply(ctx, { permit_id: 'nope' }, 'approver-1')).rejects.toThrow(/permit_id/i)
    expect(calls).toEqual([])
  })
})

describe('permit_hot_work_auth applier — rollback', () => {
  it('restores the prior PAI and un-signs, guarded on currently-signed + active', async () => {
    results = [{ data: [{ id: PERMIT, serial: 'HWP-20260618-0003' }], error: null }]
    const out = await applier.rollback(ctx, { permit_id: PERMIT }, { pai_id: ORIG_PAI })
    expect(out.summary).toMatch(/unsigned again/i)
    const update = calls.find(c => c.op === 'update')!
    expect(update.payload).toMatchObject({ pai_id: ORIG_PAI, pai_signature_at: null })
    expect(update.filters).toMatchObject({ id: PERMIT, tenant_id: 'tenant-A', not_pai_signature_at: null, is_canceled_at: null })
  })

  it('throws when there is nothing to roll back (no rows match the guard)', async () => {
    results = [{ data: [], error: null }]
    await expect(applier.rollback(ctx, { permit_id: PERMIT }, { pai_id: ORIG_PAI })).rejects.toThrow(/nothing to roll back/i)
  })

  it('refuses to roll back without a recorded prior PAI', async () => {
    await expect(applier.rollback(ctx, { permit_id: PERMIT }, {})).rejects.toThrow(/prior authorizing individual/i)
    expect(calls).toEqual([])
  })
})
