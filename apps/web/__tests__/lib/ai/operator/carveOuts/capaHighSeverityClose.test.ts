import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIFO-scripted supabaseAdmin mock that records each query's op / payload /
// filters, so we can assert the guarded-update filters on incident_actions.
// Same shape as carveOutAppliers.test.ts — `select` is a pass-through so the
// embedded join string is harmless.
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

import {
  closeHighSeverityCapa,
  capaHighSeverityCloseApplier,
} from '@/lib/ai/operator/carveOuts/capaHighSeverityClose'
import { isRegulatedTool } from '@/lib/ai/operator/types'

const ctx = { tenantId: 'tenant-A', userId: 'agent-1' }
const ACTION = '11111111-1111-4111-8111-111111111111'
const COMPLETER = '22222222-2222-4222-8222-222222222222'
const VERIFIER = '33333333-3333-4333-8333-333333333333'
const OWNER = '44444444-4444-4444-8444-444444444444'

// stage is only present on the regulated variant — narrow once for all tests.
if (!isRegulatedTool(closeHighSeverityCapa)) throw new Error('expected a regulated tool')
const stage = closeHighSeverityCapa.stage

beforeEach(() => { results = []; calls = [] })

describe('close_high_severity_capa — stage', () => {
  it('stages a completed action whose parent incident is high-severity', async () => {
    results = [{
      data: {
        id: ACTION,
        description: 'Install machine guard on press #4',
        status: 'complete',
        incidents: { report_number: 'INC-2026-0042', severity_actual: 'lost_time' },
      },
      error: null,
    }]
    const out = await stage({ action_id: ACTION }, ctx as never)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.payload).toEqual({ action_id: ACTION })
    expect(out.summary).toMatch(/Install machine guard/)
    expect(out.summary).toMatch(/INC-2026-0042/)
    // the read is tenant-scoped on the right id
    expect(calls[0]).toMatchObject({ table: 'incident_actions', op: 'select', filters: { id: ACTION, tenant_id: 'tenant-A' } })
  })

  it('refuses a missing action', async () => {
    results = [{ data: null, error: null }]
    const out = await stage({ action_id: ACTION }, ctx as never)
    expect(out).toMatchObject({ ok: false })
    if (out.ok) return
    expect(out.error).toMatch(/no corrective\/preventive action/i)
  })

  it('refuses an action that is not complete', async () => {
    results = [{
      data: { id: ACTION, description: 'x', status: 'in_progress', incidents: { report_number: 'INC-2026-0042', severity_actual: 'fatality' } },
      error: null,
    }]
    const out = await stage({ action_id: ACTION }, ctx as never)
    expect(out).toMatchObject({ ok: false })
    if (out.ok) return
    expect(out.error).toMatch(/only a completed action/i)
  })

  it('refuses a completed action whose parent incident is not high-severity', async () => {
    results = [{
      data: { id: ACTION, description: 'x', status: 'complete', incidents: { report_number: 'INC-2026-0042', severity_actual: 'first_aid' } },
      error: null,
    }]
    const out = await stage({ action_id: ACTION }, ctx as never)
    expect(out).toMatchObject({ ok: false })
    if (out.ok) return
    expect(out.error).toMatch(/not high-severity/i)
  })

  it('rejects an invalid action_id before any query', async () => {
    const out = await stage({ action_id: 'nope' }, ctx as never)
    expect(out).toMatchObject({ ok: false })
    expect(calls).toEqual([])
  })
})

describe('capa_high_severity_close applier — apply', () => {
  it('verifies-closes a completed action and snapshots the prior (complete) state', async () => {
    results = [
      { data: { id: ACTION, description: 'Install machine guard', status: 'complete', completed_by: COMPLETER, owner_user_id: OWNER, verified_at: null, verified_by: null }, error: null },
      { data: [{ id: ACTION, description: 'Install machine guard' }], error: null },
    ]
    const out = await capaHighSeverityCloseApplier.apply(ctx, { action_id: ACTION }, VERIFIER)
    expect(out.summary).toMatch(/Verified and closed/i)
    expect(out.prevState).toEqual({ status: 'complete', verified_at: null, verified_by: null })

    const update = calls.find(c => c.op === 'update')!
    expect(update.table).toBe('incident_actions')
    expect(update.payload).toMatchObject({ status: 'verified', verified_by: VERIFIER })
    expect(update.payload!.verified_at).toBeTruthy()
    // the WHERE re-asserts complete + tenant so a concurrent change can't be clobbered
    expect(update.filters).toMatchObject({ id: ACTION, tenant_id: 'tenant-A', status: 'complete' })
  })

  it('enforces separation of duty: the verifier may not be the completer — no update', async () => {
    results = [{ data: { id: ACTION, description: 'x', status: 'complete', completed_by: COMPLETER, owner_user_id: OWNER, verified_at: null, verified_by: null }, error: null }]
    await expect(capaHighSeverityCloseApplier.apply(ctx, { action_id: ACTION }, COMPLETER))
      .rejects.toThrow(/separation of duty/i)
    expect(calls.some(c => c.op === 'update')).toBe(false)
  })

  it('falls back to the owner as the completer for legacy rows with no completed_by', async () => {
    results = [{ data: { id: ACTION, description: 'x', status: 'complete', completed_by: null, owner_user_id: OWNER, verified_at: null, verified_by: null }, error: null }]
    await expect(capaHighSeverityCloseApplier.apply(ctx, { action_id: ACTION }, OWNER))
      .rejects.toThrow(/separation of duty/i)
    expect(calls.some(c => c.op === 'update')).toBe(false)
  })

  it('refuses an action that is not complete — no update', async () => {
    results = [{ data: { id: ACTION, description: 'x', status: 'verified', completed_by: COMPLETER, owner_user_id: OWNER, verified_at: '2026-06-18T00:00:00Z', verified_by: VERIFIER }, error: null }]
    await expect(capaHighSeverityCloseApplier.apply(ctx, { action_id: ACTION }, VERIFIER))
      .rejects.toThrow(/only a completed action/i)
    expect(calls.some(c => c.op === 'update')).toBe(false)
  })

  it('refuses a missing action', async () => {
    results = [{ data: null, error: null }]
    await expect(capaHighSeverityCloseApplier.apply(ctx, { action_id: ACTION }, VERIFIER)).rejects.toThrow(/not found/i)
  })

  it('throws on a lost race (the guarded update affects no rows)', async () => {
    results = [
      { data: { id: ACTION, description: 'x', status: 'complete', completed_by: COMPLETER, owner_user_id: OWNER, verified_at: null, verified_by: null }, error: null },
      { data: [], error: null },
    ]
    await expect(capaHighSeverityCloseApplier.apply(ctx, { action_id: ACTION }, VERIFIER)).rejects.toThrow(/changed before/i)
  })

  it('rejects a payload without a valid action_id before any query', async () => {
    await expect(capaHighSeverityCloseApplier.apply(ctx, { action_id: 'nope' }, VERIFIER)).rejects.toThrow(/action_id/i)
    expect(calls).toEqual([])
  })
})

describe('capa_high_severity_close applier — rollback', () => {
  it('reopens a verified action to complete, clearing the verification stamps, guarded on currently-verified', async () => {
    results = [{ data: [{ id: ACTION, description: 'Install machine guard' }], error: null }]
    const out = await capaHighSeverityCloseApplier.rollback(ctx, { action_id: ACTION }, { status: 'complete', verified_at: null, verified_by: null })
    expect(out.summary).toMatch(/reopened/i)
    const update = calls.find(c => c.op === 'update')!
    expect(update.table).toBe('incident_actions')
    expect(update.payload).toMatchObject({ status: 'complete', verified_at: null, verified_by: null })
    // verification_evidence is intentionally untouched
    expect(update.payload).not.toHaveProperty('verification_evidence')
    expect(update.filters).toMatchObject({ id: ACTION, tenant_id: 'tenant-A', status: 'verified' })
  })

  it('throws when there is nothing to roll back (no rows match the guard)', async () => {
    results = [{ data: [], error: null }]
    await expect(capaHighSeverityCloseApplier.rollback(ctx, { action_id: ACTION }, {})).rejects.toThrow(/nothing to roll back/i)
  })

  it('rejects a payload without a valid action_id before any query', async () => {
    await expect(capaHighSeverityCloseApplier.rollback(ctx, { action_id: 'nope' }, {})).rejects.toThrow(/action_id/i)
    expect(calls).toEqual([])
  })
})
