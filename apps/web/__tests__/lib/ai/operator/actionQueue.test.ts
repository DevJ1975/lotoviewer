import { describe, it, expect, vi, beforeEach } from 'vitest'

// Spy appliers so the engine's lifecycle (transitions, role re-proof, stamping)
// is tested in isolation from any real domain mutation.
const { applyFn, rollbackFn } = vi.hoisted(() => ({ applyFn: vi.fn(), rollbackFn: vi.fn() }))
vi.mock('@/lib/ai/operator/carveOutAppliers', () => ({
  CARVE_OUT_APPLIERS: { permit_hot_work_auth: { apply: applyFn, rollback: rollbackFn } },
}))

// supabaseAdmin mock: a FIFO of scripted results (one per terminal query, in
// call order) plus a recorder of every query's table / op / payload / filters.
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
  stageRegulatedAction, approveAndApply, rejectAction, rollbackAction, listPendingActions,
} from '@/lib/ai/operator/actionQueue'

const stageCtx = { tenantId: 'tenant-A', userId: 'u1', role: 'member' as const, conversationId: 'conv-1' }
const adminApprover = { tenantId: 'tenant-A', userId: 'admin-1', role: 'admin' as const }
const QUEUE = 'q-1'

beforeEach(() => { results = []; calls = []; applyFn.mockReset(); rollbackFn.mockReset() })

describe('stageRegulatedAction', () => {
  it('inserts a pending, tenant-scoped row snapshotting the action spec', async () => {
    results = [{ data: { id: QUEUE }, error: null }]
    const res = await stageRegulatedAction(stageCtx, 'permit_hot_work_auth', { permit_id: 'p1' }, 'Authorize HWP-1')
    expect(res).toEqual({ ok: true, queueId: QUEUE, authorizingRole: 'admin' })
    expect(calls[0]).toMatchObject({ table: 'agent_action_queue', op: 'insert' })
    expect(calls[0].payload).toMatchObject({
      tenant_id: 'tenant-A', conversation_id: 'conv-1', action: 'permit_hot_work_auth',
      status: 'pending', authorizing_role: 'admin', reversible: true, requested_by: 'u1',
      payload: { permit_id: 'p1' }, summary: 'Authorize HWP-1',
    })
  })

  it('surfaces an insert failure', async () => {
    results = [{ data: null, error: { message: 'boom' } }]
    const res = await stageRegulatedAction(stageCtx, 'permit_hot_work_auth', {}, 's')
    expect(res).toEqual({ ok: false, error: 'boom' })
  })
})

describe('approveAndApply', () => {
  const row = { data: { action: 'permit_hot_work_auth', status: 'pending', reversible: true, payload: { permit_id: 'p1' }, apply_result: null }, error: null }

  it('re-proves the authorizing role, applies, and marks applied', async () => {
    applyFn.mockResolvedValue({ summary: 'Authorized HWP-1', prevState: { pai_id: 'orig' } })
    results = [row, { data: { role: 'admin' }, error: null }, { data: null, error: null }]
    const res = await approveAndApply(adminApprover, QUEUE)
    expect(res).toEqual({ ok: true, status: 'applied', summary: 'Authorized HWP-1' })
    expect(applyFn).toHaveBeenCalledWith({ tenantId: 'tenant-A', userId: 'admin-1' }, { permit_id: 'p1' }, 'admin-1')
    // role was re-proved LIVE against tenant_memberships, not trusted from the caller
    expect(calls.some(c => c.table === 'tenant_memberships')).toBe(true)
    const update = calls.find(c => c.op === 'update')!
    expect(update.payload).toMatchObject({
      status: 'applied', decided_by: 'admin-1',
      apply_result: { summary: 'Authorized HWP-1', prevState: { pai_id: 'orig' } },
    })
    expect(update.filters).toMatchObject({ id: QUEUE, tenant_id: 'tenant-A', status: 'pending' })
  })

  it('forbids an approver who lacks the authorizing role — never applies', async () => {
    results = [row, { data: { role: 'member' }, error: null }]
    const res = await approveAndApply({ tenantId: 'tenant-A', userId: 'm-1', role: 'member' }, QUEUE)
    expect(res).toMatchObject({ ok: false, status: 403 })
    expect(applyFn).not.toHaveBeenCalled()
    expect(calls.some(c => c.op === 'update')).toBe(false)
  })

  it('404s a missing row', async () => {
    results = [{ data: null, error: null }]
    expect(await approveAndApply(adminApprover, QUEUE)).toMatchObject({ ok: false, status: 404 })
  })

  it('409s a row that is no longer pending', async () => {
    results = [{ data: { ...row.data, status: 'applied' }, error: null }]
    const res = await approveAndApply(adminApprover, QUEUE)
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(applyFn).not.toHaveBeenCalled()
  })

  it('stamps the error and 409s when the applier refuses the mutation', async () => {
    applyFn.mockRejectedValue(new Error('already authorized'))
    results = [row, { data: { role: 'admin' }, error: null }, { data: null, error: null }]
    const res = await approveAndApply(adminApprover, QUEUE)
    expect(res).toMatchObject({ ok: false, status: 409, error: 'already authorized' })
    const update = calls.find(c => c.op === 'update')!
    expect(update.payload).toEqual({ error: 'already authorized' })
  })
})

describe('rejectAction', () => {
  const row = { data: { action: 'permit_hot_work_auth', status: 'pending', reversible: true, payload: {}, apply_result: null }, error: null }

  it('requires a reason and never touches the DB without one', async () => {
    const res = await rejectAction(adminApprover, QUEUE, '   ')
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(calls).toEqual([])
  })

  it('records the rejection after re-proving the role', async () => {
    results = [row, { data: { role: 'admin' }, error: null }, { data: null, error: null }]
    const res = await rejectAction(adminApprover, QUEUE, 'Combustibles not cleared')
    expect(res).toMatchObject({ ok: true, status: 'rejected' })
    const update = calls.find(c => c.op === 'update')!
    expect(update.payload).toMatchObject({ status: 'rejected', rejection_reason: 'Combustibles not cleared', decided_by: 'admin-1' })
    expect(update.filters).toMatchObject({ id: QUEUE, tenant_id: 'tenant-A', status: 'pending' })
  })
})

describe('rollbackAction', () => {
  const appliedReversible = {
    data: { action: 'permit_hot_work_auth', status: 'applied', reversible: true, payload: { permit_id: 'p1' }, apply_result: { prevState: { pai_id: 'orig' } } },
    error: null,
  }

  it('reverses an applied reversible action via the applier with the saved prevState', async () => {
    rollbackFn.mockResolvedValue({ summary: 'unsigned again' })
    results = [appliedReversible, { data: { role: 'admin' }, error: null }, { data: null, error: null }]
    const res = await rollbackAction(adminApprover, QUEUE)
    expect(res).toMatchObject({ ok: true, status: 'rolled_back' })
    expect(rollbackFn).toHaveBeenCalledWith({ tenantId: 'tenant-A', userId: 'admin-1' }, { permit_id: 'p1' }, { pai_id: 'orig' })
    const update = calls.find(c => c.op === 'update')!
    expect(update.payload).toMatchObject({ status: 'rolled_back', rolled_back_by: 'admin-1' })
    expect(update.filters).toMatchObject({ id: QUEUE, tenant_id: 'tenant-A', status: 'applied' })
  })

  it('409s a non-applied action', async () => {
    results = [{ data: { ...appliedReversible.data, status: 'pending' }, error: null }]
    const res = await rollbackAction(adminApprover, QUEUE)
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(rollbackFn).not.toHaveBeenCalled()
  })

  it('409s an irreversible applied action', async () => {
    results = [{ data: { ...appliedReversible.data, reversible: false }, error: null }]
    const res = await rollbackAction(adminApprover, QUEUE)
    expect(res).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/not reversible/i) })
    expect(rollbackFn).not.toHaveBeenCalled()
  })
})

describe('listPendingActions', () => {
  it('maps rows and filters to pending for the tenant', async () => {
    results = [{ data: [{ id: 'q1', action: 'permit_hot_work_auth', authorizing_role: 'admin', reversible: true, summary: 'S', requested_by: 'u1', requested_at: 'T' }], error: null }]
    const out = await listPendingActions('tenant-A')
    expect(out).toEqual([{ id: 'q1', action: 'permit_hot_work_auth', authorizingRole: 'admin', reversible: true, summary: 'S', requestedBy: 'u1', requestedAt: 'T' }])
    expect(calls[0].filters).toMatchObject({ tenant_id: 'tenant-A', status: 'pending' })
  })
})
