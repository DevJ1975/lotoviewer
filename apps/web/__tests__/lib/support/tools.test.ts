import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeTool, isDataFetchTool, visibleDataFetchTools } from '@/lib/support/tools'

// Tool tests verify two things:
//   1. Tenant scoping — every query carries the gate.tenantId, and
//      tool input never overrides it.
//   2. Module gating — a tool is only exposed to the model when its
//      backing module is enabled in tenant.modules.
//
// Behind the scenes executeTool calls supabaseAdmin().from(...).
// We mock that chain to assert the exact filters applied.

const eqSpy = vi.fn()
const gteSpy = vi.fn()
const lteSpy = vi.fn()
const orderSpy = vi.fn()
const limitSpy = vi.fn()
const notSpy = vi.fn()
const neqSpy = vi.fn()

function chainable(result: { data: unknown; error: null | { message: string } }) {
  const node: Record<string, unknown> = {}
  node.eq    = vi.fn((col: string, val: unknown) => { eqSpy(col, val);  return node })
  node.gte   = vi.fn((col: string, val: unknown) => { gteSpy(col, val); return node })
  node.lte   = vi.fn((col: string, val: unknown) => { lteSpy(col, val); return node })
  node.not   = vi.fn((col: string, _op: string, val: unknown) => { notSpy(col, val); return node })
  node.neq   = vi.fn((col: string, val: unknown) => { neqSpy(col, val); return node })
  node.order = vi.fn((col: string, opts: unknown) => { orderSpy(col, opts); return node })
  node.limit = vi.fn((n: number) => {
    limitSpy(n)
    // Limit is the terminal call → returns the awaited result.
    return Promise.resolve(result)
  })
  return node
}

vi.mock('@/lib/supabaseAdmin', () => {
  return {
    supabaseAdmin: () => ({
      from: vi.fn(() => ({
        select: vi.fn(() => chainable({ data: [], error: null })),
      })),
    }),
  }
})

beforeEach(() => {
  eqSpy.mockClear()
  gteSpy.mockClear()
  lteSpy.mockClear()
  orderSpy.mockClear()
  limitSpy.mockClear()
  notSpy.mockClear()
  neqSpy.mockClear()
})

describe('isDataFetchTool', () => {
  it('recognises the three data tools', () => {
    expect(isDataFetchTool('fetch_recent_near_misses')).toBe(true)
    expect(isDataFetchTool('fetch_training_expiry_cohort')).toBe(true)
    expect(isDataFetchTool('fetch_my_recent_permits')).toBe(true)
  })
  it('rejects everything else', () => {
    expect(isDataFetchTool('create_support_ticket')).toBe(false)
    expect(isDataFetchTool('fetch_secrets')).toBe(false)
  })
})

describe('visibleDataFetchTools', () => {
  it('includes near-miss tool only when near-miss module is on', () => {
    const onlyNm  = visibleDataFetchTools({ 'near-miss': true })
    expect(onlyNm.map(t => t.name)).toContain('fetch_recent_near_misses')
    expect(onlyNm.map(t => t.name)).not.toContain('fetch_training_expiry_cohort')
  })

  it('includes training tool when LOTO is on', () => {
    const onlyLoto = visibleDataFetchTools({ 'lockout-tagout': true })
    expect(onlyLoto.map(t => t.name)).toContain('fetch_training_expiry_cohort')
  })

  it('includes permit tool when CS or hot-work is on', () => {
    const onlyCS = visibleDataFetchTools({ 'confined-spaces': true })
    expect(onlyCS.map(t => t.name)).toContain('fetch_my_recent_permits')
    const onlyHw = visibleDataFetchTools({ 'hot-work-permits': true })
    expect(onlyHw.map(t => t.name)).toContain('fetch_my_recent_permits')
  })

  it('returns nothing when no relevant modules are enabled', () => {
    expect(visibleDataFetchTools({})).toEqual([])
  })
})

describe('executeTool tenant scoping', () => {
  const gate = { tenantId: 'tenant-A', userId: 'user-1', modules: { 'near-miss': true, 'confined-spaces': true } }

  it('refuses when tenantId is null', async () => {
    const r = await executeTool('fetch_recent_near_misses', {}, { ...gate, tenantId: null })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('No active tenant')
  })

  it('fetch_recent_near_misses applies tenant filter (cannot be overridden by tool input)', async () => {
    await executeTool('fetch_recent_near_misses', { tenant_id: 'tenant-B', days: 7 }, gate)
    // Whatever the model put in input, the route uses gate.tenantId.
    expect(eqSpy).toHaveBeenCalledWith('tenant_id', 'tenant-A')
  })

  it('fetch_training_expiry_cohort applies tenant filter', async () => {
    await executeTool('fetch_training_expiry_cohort', { within_days: 30, tenant_id: 'tenant-X' }, gate)
    expect(eqSpy).toHaveBeenCalledWith('tenant_id', 'tenant-A')
  })

  it('fetch_my_recent_permits applies tenant filter for both tables', async () => {
    eqSpy.mockClear()
    await executeTool('fetch_my_recent_permits', { tenant_id: 'tenant-X', days: 30, limit: 10 }, gate)
    // Two queries (CS + HW), both should have tenant_id = tenant-A
    const tenantCalls = eqSpy.mock.calls.filter(c => c[0] === 'tenant_id')
    expect(tenantCalls.length).toBe(2)
    for (const call of tenantCalls) expect(call[1]).toBe('tenant-A')
  })

  it('clamps oversized limit to the safe ceiling', async () => {
    limitSpy.mockClear()
    await executeTool('fetch_recent_near_misses', { limit: 9999 }, gate)
    // Tool's max for limit is 20.
    expect(limitSpy).toHaveBeenCalledWith(20)
  })

  it('returns a structured error for unknown tool name', async () => {
    const r = await executeTool('rm_-rf', {}, gate)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/unknown tool/i)
  })
})
