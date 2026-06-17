import { describe, it, expect, vi, beforeEach } from 'vitest'

// Same thenable-builder mock as the assistant tools test: every chainable
// method returns the builder; awaiting resolves to the preset result. Lets us
// assert the reused read handlers scope to the caller's tenant.
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

import { getOperatorToolDefinitions, runOperatorTool, OPERATOR_TOOLS } from '@/lib/ai/operator/registry'

const member = { tenantId: 'tenant-A', userId: 'u1', role: 'member' as const, conversationId: 'c1' }
const viewer = { ...member, role: 'viewer' as const }
const admin = { ...member, role: 'admin' as const }

beforeEach(() => {
  recorder = { tables: [], eq: [] }
  nextResult = { data: [], error: null }
})

describe('role-gated tool visibility', () => {
  it('omits member-gated tools from a viewer', () => {
    expect(getOperatorToolDefinitions('incidents', 'viewer')).toEqual([])
  })

  it('exposes the incidents read tools to a member', () => {
    const names = getOperatorToolDefinitions('incidents', 'member').map(d => d.name)
    expect(names).toContain('recent_incidents')
    expect(names).toContain('near_misses_recent')
  })

  it('keeps knowledge tools viewer-readable', () => {
    const names = getOperatorToolDefinitions('knowledge', 'viewer').map(d => d.name)
    expect(names).toContain('navigate_to')
    expect(names).toContain('compliance_obligations_due')
  })

  it('requires admin for the osha agent read tool', () => {
    expect(getOperatorToolDefinitions('osha', 'member')).toEqual([])
    expect(getOperatorToolDefinitions('osha', 'admin').map(d => d.name)).toEqual(['scorecard_kpis'])
  })

  it('returns tool definitions in a deterministic (sorted) order', () => {
    const names = getOperatorToolDefinitions('incidents', 'member').map(d => d.name)
    expect(names).toEqual([...names].sort())
  })
})

describe('runOperatorTool', () => {
  it('reuses the shared handler and scopes the read to the caller tenant', async () => {
    const out = JSON.parse(await runOperatorTool('risk', 'list_risks', {}, member))
    expect(out.ok).toBe(true)
    expect(recorder.eq).toContainEqual(['tenant_id', 'tenant-A'])
    expect(recorder.eq.some(([c, v]) => c === 'tenant_id' && v !== 'tenant-A')).toBe(false)
  })

  it('runs a no-DB reused tool (navigate_to) for a viewer', async () => {
    const out = JSON.parse(await runOperatorTool('knowledge', 'navigate_to', { query: 'risk register' }, viewer))
    expect(out.ok).toBe(true)
  })

  it('refuses a tool above the caller role instead of running it', async () => {
    const out = JSON.parse(await runOperatorTool('osha', 'scorecard_kpis', {}, member))
    expect(out.ok).toBe(false)
    expect(out.refusal).toBeTruthy()
    expect(recorder.tables).toEqual([]) // handler never touched the DB
  })

  it('fails cleanly for an unknown agent or tool', async () => {
    const badAgent = JSON.parse(await runOperatorTool('nope' as never, 'x', {}, member))
    expect(badAgent.ok).toBe(false)
    const badTool = JSON.parse(await runOperatorTool('risk', 'does_not_exist', {}, member))
    expect(badTool.ok).toBe(false)
  })

  it('NEVER executes a regulated carve-out handler inline — it stages instead', async () => {
    let executed = false
    OPERATOR_TOOLS.loto.__test_certify = {
      definition: { name: '__test_certify', description: 'test', input_schema: { type: 'object', properties: {} } },
      agent: 'loto',
      minRole: 'admin',
      scope: { kind: 'regulated', action: 'loto_zero_energy_cert' },
      handler: async () => { executed = true; return JSON.stringify({ ok: true }) },
    }
    try {
      const out = JSON.parse(await runOperatorTool('loto', '__test_certify', {}, admin))
      expect(executed).toBe(false) // the structural carve-out: handler must not run
      expect(out.ok).toBe(false)
      expect(out.refusal).toMatch(/approval/i)
    } finally {
      delete OPERATOR_TOOLS.loto.__test_certify
    }
  })
})
