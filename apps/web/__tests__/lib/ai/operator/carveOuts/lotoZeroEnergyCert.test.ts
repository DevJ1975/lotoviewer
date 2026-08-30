import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIFO-scripted supabaseAdmin mock that records each query's op / payload /
// filters, so we can assert the tenant scope + guarded revoke. Same shape as
// carveOutAppliers.test.ts — `select` is a pass-through.
interface Call { table: string; op: 'select' | 'insert' | 'update'; payload?: Record<string, unknown>; filters: Record<string, unknown> }
let results: Array<{ data?: unknown; error?: { message: string; code?: string } | null }>
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

import {
  certifyLotoZeroEnergy,
  lotoZeroEnergyCertApplier,
} from '@/lib/ai/operator/carveOuts/lotoZeroEnergyCert'
import { isRegulatedTool } from '@/lib/ai/operator/types'

const ctx = { tenantId: 'tenant-A', userId: 'approver-1' }
const EQUIP = 'EQ-123'
const CERT = '11111111-1111-4111-8111-111111111111'
const APPROVER = '22222222-2222-4222-8222-222222222222'

// stage is only present on the regulated variant — narrow once for all tests.
if (!isRegulatedTool(certifyLotoZeroEnergy)) throw new Error('expected a regulated tool')
const stage = certifyLotoZeroEnergy.stage

beforeEach(() => { results = []; calls = [] })

describe('certify_loto_zero_energy — wiring', () => {
  it('is a regulated loto tool gated on loto_zero_energy_cert', () => {
    expect(certifyLotoZeroEnergy.agent).toBe('loto')
    expect(certifyLotoZeroEnergy.minRole).toBe('member')
    expect(certifyLotoZeroEnergy.scope).toEqual({ kind: 'regulated', action: 'loto_zero_energy_cert' })
    expect(certifyLotoZeroEnergy.definition.name).toBe('certify_loto_zero_energy')
  })
})

describe('certify_loto_zero_energy — stage', () => {
  it('stages a known machine with no active cert', async () => {
    results = [
      { data: { equipment_id: EQUIP }, error: null },  // equipment exists in tenant
      { data: null, error: null },                     // no active cert
    ]
    const out = await stage({ equipment_id: EQUIP }, ctx as never)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.payload).toEqual({ equipment_id: EQUIP })
    expect(out.summary).toBe(`Certify zero-energy isolation (LOTO, 1910.147) for equipment ${EQUIP}`)
    // both reads are tenant-scoped on the natural text key
    expect(calls[0]).toMatchObject({ table: 'loto_equipment', filters: { equipment_id: EQUIP, tenant_id: 'tenant-A' } })
    expect(calls[1]).toMatchObject({
      table: 'loto_zero_energy_certifications',
      filters: { equipment_id: EQUIP, tenant_id: 'tenant-A', is_revoked_at: null },
    })
  })

  it('refuses equipment that does not exist in this tenant — no cert lookup', async () => {
    results = [{ data: null, error: null }]
    const out = await stage({ equipment_id: EQUIP }, ctx as never)
    expect(out).toMatchObject({ ok: false })
    if (out.ok) return
    expect(out.error).toMatch(/no equipment with id/i)
    // refusal happens after the single equipment read; the cert table is never hit
    expect(calls).toHaveLength(1)
  })

  it('refuses when an active cert already exists', async () => {
    results = [
      { data: { equipment_id: EQUIP }, error: null },
      { data: { id: CERT }, error: null },  // an active cert is already present
    ]
    const out = await stage({ equipment_id: EQUIP }, ctx as never)
    expect(out).toMatchObject({ ok: false })
    if (out.ok) return
    expect(out.error).toMatch(/already holds an active zero-energy certification/i)
  })

  it('rejects a blank equipment_id before any query', async () => {
    const out = await stage({ equipment_id: '   ' }, ctx as never)
    expect(out).toMatchObject({ ok: false })
    if (out.ok) return
    expect(out.error).toMatch(/equipment_id is required/i)
    expect(calls).toEqual([])
  })

  it('rejects a missing equipment_id before any query', async () => {
    const out = await stage({}, ctx as never)
    expect(out).toMatchObject({ ok: false })
    expect(calls).toEqual([])
  })
})

describe('loto_zero_energy_cert applier — apply', () => {
  it('inserts a cert row as the approver and returns prevState.cert_id', async () => {
    results = [
      { data: null, error: null },          // pre-check: no active cert
      { data: { id: CERT }, error: null },  // insert ... returning id
    ]
    const out = await lotoZeroEnergyCertApplier.apply(ctx, { equipment_id: EQUIP, method: 'try-start + meter', notes: 'panel 3' }, APPROVER)
    expect(out.summary).toMatch(new RegExp(EQUIP))
    expect(out.prevState).toEqual({ cert_id: CERT })

    const insert = calls.find(c => c.op === 'insert')!
    expect(insert.table).toBe('loto_zero_energy_certifications')
    expect(insert.payload).toMatchObject({
      tenant_id: 'tenant-A',
      equipment_id: EQUIP,
      certified_by: APPROVER,
      method: 'try-start + meter',
      notes: 'panel 3',
    })
  })

  it('writes NULL for blank optional method/notes', async () => {
    results = [
      { data: null, error: null },
      { data: { id: CERT }, error: null },
    ]
    await lotoZeroEnergyCertApplier.apply(ctx, { equipment_id: EQUIP, method: '   ' }, APPROVER)
    const insert = calls.find(c => c.op === 'insert')!
    expect(insert.payload).toMatchObject({ method: null, notes: null })
  })

  it('refuses a duplicate active cert at the pre-check — no insert', async () => {
    results = [{ data: { id: CERT }, error: null }]  // pre-check finds an active cert
    await expect(lotoZeroEnergyCertApplier.apply(ctx, { equipment_id: EQUIP }, APPROVER))
      .rejects.toThrow(/already holds an active/i)
    expect(calls.some(c => c.op === 'insert')).toBe(false)
  })

  it('translates a unique-violation race into a clean re-stage error', async () => {
    results = [
      { data: null, error: null },                                   // pre-check clear
      { data: null, error: { code: '23505', message: 'duplicate key' } }, // index caught the race
    ]
    await expect(lotoZeroEnergyCertApplier.apply(ctx, { equipment_id: EQUIP }, APPROVER))
      .rejects.toThrow(/before this could be applied/i)
  })

  it('rejects a payload without an equipment_id before any query', async () => {
    await expect(lotoZeroEnergyCertApplier.apply(ctx, {}, APPROVER)).rejects.toThrow(/equipment_id/i)
    expect(calls).toEqual([])
  })
})

describe('loto_zero_energy_cert applier — rollback', () => {
  it('soft-revokes the recorded cert as ctx.userId, guarded on tenant + not-yet-revoked', async () => {
    results = [{ data: [{ id: CERT }], error: null }]
    const out = await lotoZeroEnergyCertApplier.rollback(ctx, { equipment_id: EQUIP }, { cert_id: CERT })
    expect(out.summary).toMatch(/no longer active/i)

    const update = calls.find(c => c.op === 'update')!
    expect(update.table).toBe('loto_zero_energy_certifications')
    expect(update.payload).toMatchObject({ revoked_by: 'approver-1' })
    expect(update.payload!.revoked_at).toBeTruthy()
    expect(update.filters).toMatchObject({ id: CERT, tenant_id: 'tenant-A', is_revoked_at: null })
  })

  it('throws when there is nothing to roll back (no rows match the guard)', async () => {
    results = [{ data: [], error: null }]
    await expect(lotoZeroEnergyCertApplier.rollback(ctx, { equipment_id: EQUIP }, { cert_id: CERT }))
      .rejects.toThrow(/nothing to roll back/i)
  })

  it('refuses to roll back without a recorded cert id', async () => {
    await expect(lotoZeroEnergyCertApplier.rollback(ctx, { equipment_id: EQUIP }, {}))
      .rejects.toThrow(/certification id was not recorded/i)
    expect(calls).toEqual([])
  })

  it('rejects a payload without an equipment_id before any query', async () => {
    await expect(lotoZeroEnergyCertApplier.rollback(ctx, {}, { cert_id: CERT })).rejects.toThrow(/equipment_id/i)
    expect(calls).toEqual([])
  })
})
