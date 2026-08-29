import { describe, it, expect, vi, beforeEach } from 'vitest'

// FIFO-scripted supabaseAdmin mock (same shape as carveOutAppliers.test.ts):
// records each query's table / op / payload / filters so we can assert the
// tenant scoping, the stage preconditions, and the apply no-double-submit guard.
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

// Stub the EXISTING submission helper so apply's reuse is observable in
// isolation: we assert the args it receives and feed back each ok-variant
// (true / stub / false) without exercising its internal queries or any network.
const submitMock = vi.fn()
vi.mock('@/lib/oshaItaSubmit', () => ({ submitToItaForEstablishment: (opts: unknown) => submitMock(opts) }))

import { submitOshaIta, oshaItaSubmitApplier } from '@/lib/ai/operator/carveOuts/oshaItaSubmit'
import { isRegulatedTool } from '@/lib/ai/operator/types'

const ctx = { tenantId: 'tenant-A', userId: 'approver-1' }
const EST = '11111111-1111-4111-8111-111111111111'
const YEAR = 2025

beforeEach(() => { results = []; calls = []; submitMock.mockReset() })

describe('submit_osha_ita tool — definition', () => {
  it('is an owner-gated regulated osha tool wired to osha_ita_submit', () => {
    expect(submitOshaIta.agent).toBe('osha')
    expect(isRegulatedTool(submitOshaIta)).toBe(true)
    if (isRegulatedTool(submitOshaIta)) expect(submitOshaIta.scope.action).toBe('osha_ita_submit')
    expect(submitOshaIta.definition.name).toBe('submit_osha_ita')
  })
})

describe('submit_osha_ita tool — stage', () => {
  function stage(input: unknown) {
    if (!isRegulatedTool(submitOshaIta)) throw new Error('expected a regulated tool')
    return submitOshaIta.stage(input, { ...ctx, role: 'owner' } as never)
  }

  it('stages a certified, unsubmitted 300A — payload keyed by establishment + year, tenant-scoped', async () => {
    results = [
      { data: { id: EST, establishment_name: 'North Plant' }, error: null },
      { data: { certified_at: '2026-02-10T00:00:00Z', submitted_to_ita_at: null }, error: null },
    ]
    const out = await stage({ establishment_id: EST, year: YEAR })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.payload).toEqual({ establishment_id: EST, year: YEAR })
      expect(out.summary).toMatch(/North Plant 2025 — final, cannot be undone/)
    }
    // both reads are tenant-scoped; the summary read keys on establishment + year
    expect(calls[0].filters).toMatchObject({ id: EST, tenant_id: 'tenant-A' })
    expect(calls[1].filters).toMatchObject({ tenant_id: 'tenant-A', establishment_id: EST, year: YEAR })
  })

  it('refuses a missing establishment', async () => {
    results = [{ data: null, error: null }]
    const out = await stage({ establishment_id: EST, year: YEAR })
    expect(out).toMatchObject({ ok: false })
    if (!out.ok) expect(out.error).toMatch(/no osha establishment/i)
  })

  it('refuses when no 300A is on file for the year', async () => {
    results = [
      { data: { id: EST, establishment_name: 'North Plant' }, error: null },
      { data: null, error: null },
    ]
    const out = await stage({ establishment_id: EST, year: YEAR })
    expect(out).toMatchObject({ ok: false })
    if (!out.ok) expect(out.error).toMatch(/no 300a annual summary/i)
  })

  it('refuses an uncertified 300A', async () => {
    results = [
      { data: { id: EST, establishment_name: 'North Plant' }, error: null },
      { data: { certified_at: null, submitted_to_ita_at: null }, error: null },
    ]
    const out = await stage({ establishment_id: EST, year: YEAR })
    expect(out).toMatchObject({ ok: false })
    if (!out.ok) expect(out.error).toMatch(/must be certified/i)
  })

  it('refuses an already-submitted 300A', async () => {
    results = [
      { data: { id: EST, establishment_name: 'North Plant' }, error: null },
      { data: { certified_at: '2026-02-10T00:00:00Z', submitted_to_ita_at: '2026-03-01T00:00:00Z' }, error: null },
    ]
    const out = await stage({ establishment_id: EST, year: YEAR })
    expect(out).toMatchObject({ ok: false })
    if (!out.ok) expect(out.error).toMatch(/already submitted/i)
  })

  it('rejects a non-uuid establishment id before any query', async () => {
    const out = await stage({ establishment_id: 'nope', year: YEAR })
    expect(out).toMatchObject({ ok: false })
    expect(calls).toEqual([])
  })
})

describe('osha_ita_submit applier — apply', () => {
  it('claims the row (certified + unsubmitted guard) then delegates to the existing submission helper', async () => {
    // The guarded claim update: returns one row → the 300A was submittable.
    results = [{ data: [{ id: 'summary-1' }], error: null }]
    submitMock.mockResolvedValue({ ok: true, submitted_at: '2026-03-02T00:00:00Z', submission_id: 'ITA-777', coverage: 'summary_only', payload: {}, upstream: {} })

    const out = await oshaItaSubmitApplier.apply(ctx, { establishment_id: EST, year: YEAR }, 'approver-1')
    expect(out.summary).toMatch(/ITA-777/)
    expect(out.summary).toMatch(/cannot be undone/i)
    expect(out.prevState).toEqual({})

    // the claim is tenant-scoped, keyed, and guarded on certified + not-submitted
    const claim = calls.find(c => c.op === 'update')!
    expect(claim.table).toBe('osha_annual_summaries')
    expect(claim.payload).toMatchObject({ submitted_by: 'approver-1' })
    expect(claim.filters).toMatchObject({
      tenant_id: 'tenant-A', establishment_id: EST, year: YEAR,
      not_certified_at: null, is_submitted_to_ita_at: null,
    })
    // and the real submission is delegated to the existing helper as the approver
    expect(submitMock).toHaveBeenCalledWith({ tenant_id: 'tenant-A', establishment_id: EST, year: YEAR, submitted_by: 'approver-1' })
  })

  it('throws on a lost race / unsubmittable 300A — the guarded claim affects no rows, helper never called', async () => {
    results = [{ data: [], error: null }]
    await expect(oshaItaSubmitApplier.apply(ctx, { establishment_id: EST, year: YEAR }, 'approver-1'))
      .rejects.toThrow(/not in a submittable state/i)
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('throws when the deploy is unconfigured (helper returns stub) — never reports a phantom submission', async () => {
    results = [{ data: [{ id: 'summary-1' }], error: null }]
    submitMock.mockResolvedValue({ ok: 'stub', coverage: 'summary_only', payload: {}, hint: 'set OSHA_ITA_BASE_URL' })
    await expect(oshaItaSubmitApplier.apply(ctx, { establishment_id: EST, year: YEAR }, 'approver-1'))
      .rejects.toThrow(/not configured/i)
  })

  it('throws when the helper reports a submission failure', async () => {
    results = [{ data: [{ id: 'summary-1' }], error: null }]
    submitMock.mockResolvedValue({ ok: false, error: 'OSHA ITA rejected the submission (HTTP 502).', status: 502 })
    await expect(oshaItaSubmitApplier.apply(ctx, { establishment_id: EST, year: YEAR }, 'approver-1'))
      .rejects.toThrow(/HTTP 502/)
  })

  it('rejects a payload without a valid establishment_id before any query', async () => {
    await expect(oshaItaSubmitApplier.apply(ctx, { establishment_id: 'nope', year: YEAR }, 'approver-1'))
      .rejects.toThrow(/establishment_id/i)
    expect(calls).toEqual([])
    expect(submitMock).not.toHaveBeenCalled()
  })
})

describe('osha_ita_submit applier — rollback', () => {
  it('always throws: an OSHA ITA submission cannot be undone', async () => {
    await expect(oshaItaSubmitApplier.rollback(ctx, { establishment_id: EST, year: YEAR }, {}))
      .rejects.toThrow(/cannot be undone/i)
  })
})
