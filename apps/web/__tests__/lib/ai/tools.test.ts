import { describe, it, expect, vi, beforeEach } from 'vitest'

// Records every filter applied to the query builder so we can assert the
// handler scoped its read to the caller's tenant. The builder is a single
// thenable object: every method returns `this`, and awaiting it resolves to
// the preset result — which models the supabase-js chain
// (.from().select().eq().order().limit() and Promise.all of two chains).
interface Recorder { tables: string[]; eq: Array<[string, unknown]> }

let recorder: Recorder
let nextResult: { data: unknown; error: { message: string } | null }

function makeBuilder() {
  const b: Record<string, unknown> = {}
  const ret = () => b
  for (const m of ['select', 'order', 'limit', 'ilike', 'in', 'lt', 'lte', 'gt', 'gte', 'not', 'is', 'maybeSingle']) {
    b[m] = ret
  }
  b.eq = (col: string, val: unknown) => { recorder.eq.push([col, val]); return b }
  b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(nextResult).then(onF, onR)
  return b
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => { recorder.tables.push(table); return makeBuilder() },
  }),
}))

import { runTool, getToolDefinitions, ASSISTANT_TOOLS } from '@/lib/ai/tools'

const CTX = { tenantId: 'tenant-A', userId: 'user-1', role: 'member' as const, conversationId: 'conv-1' }

beforeEach(() => {
  recorder = { tables: [], eq: [] }
  nextResult = { data: [], error: null }
})

describe('assistant tool registry', () => {
  it('exposes a definition for every registered tool', () => {
    const defs = getToolDefinitions()
    expect(defs.length).toBe(Object.keys(ASSISTANT_TOOLS).length)
    for (const d of defs) expect(typeof d.name).toBe('string')
  })

  it('returns an error for an unknown tool', async () => {
    const out = JSON.parse(await runTool('does_not_exist', {}, CTX))
    expect(out.ok).toBe(false)
  })
})

describe('tenant scoping (read tools filter by the caller tenant)', () => {
  const readTools = ['list_risks', 'list_jhas', 'bbs_summary', 'training_expiring', 'recent_inspections', 'compliance_obligations_due', 'near_misses_recent']

  for (const name of readTools) {
    it(`${name} filters by tenant_id = ctx.tenantId`, async () => {
      const out = JSON.parse(await runTool(name, {}, CTX))
      expect(out.ok).toBe(true)
      expect(recorder.eq).toContainEqual(['tenant_id', 'tenant-A'])
      // never leaks another tenant
      expect(recorder.eq.some(([c, v]) => c === 'tenant_id' && v !== 'tenant-A')).toBe(false)
    })
  }

  it('active_permits scopes both permit tables to the tenant', async () => {
    const out = JSON.parse(await runTool('active_permits', {}, CTX))
    expect(out.ok).toBe(true)
    expect(recorder.tables).toEqual(expect.arrayContaining(['loto_confined_space_permits', 'loto_hot_work_permits']))
    expect(recorder.eq.filter(([c]) => c === 'tenant_id').every(([, v]) => v === 'tenant-A')).toBe(true)
  })

  it('surfaces a DB error instead of throwing', async () => {
    nextResult = { data: null, error: { message: 'boom' } }
    const out = JSON.parse(await runTool('list_risks', {}, CTX))
    expect(out.ok).toBe(false)
    expect(out.error).toBe('boom')
  })
})

describe('navigate_to', () => {
  it('resolves a module name to its href', async () => {
    const out = JSON.parse(await runTool('navigate_to', { query: 'confined spaces' }, CTX))
    expect(out.ok).toBe(true)
    expect(out.data.href).toBe('/confined-spaces')
  })

  it('matches on keywords in the description', async () => {
    const out = JSON.parse(await runTool('navigate_to', { query: 'risk register' }, CTX))
    expect(out.ok).toBe(true)
    expect(typeof out.data.href).toBe('string')
  })

  it('returns null data for an unmatchable query', async () => {
    const out = JSON.parse(await runTool('navigate_to', { query: 'zzzqqq-nonsense' }, CTX))
    expect(out.ok).toBe(true)
    expect(out.data).toBeNull()
  })

  it('requires a query', async () => {
    const out = JSON.parse(await runTool('navigate_to', {}, CTX))
    expect(out.ok).toBe(false)
  })
})
