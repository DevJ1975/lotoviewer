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
  for (const m of ['select', 'insert', 'update', 'order', 'limit', 'ilike', 'in', 'lt', 'lte', 'gt', 'gte', 'not', 'is', 'maybeSingle', 'single']) {
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

  it('stages a regulated carve-out via its `stage` instead of executing — and records it', async () => {
    // A regulated tool has no inline handler at all (the union forbids it); its
    // `stage` only validates + summarizes. runOperatorTool must route the result
    // into agent_action_queue and tell the model it is staged, not done.
    let staged = false
    OPERATOR_TOOLS.loto.__test_certify = {
      definition: { name: '__test_certify', description: 'test', input_schema: { type: 'object', properties: {} } },
      agent: 'loto',
      minRole: 'admin',
      scope: { kind: 'regulated', action: 'loto_zero_energy_cert' },
      stage: async () => { staged = true; return { ok: true, payload: { foo: 'bar' }, summary: 'Certify zero-energy on press-3' } },
    }
    nextResult = { data: { id: 'q-staged' }, error: null } // the agent_action_queue insert
    try {
      const out = JSON.parse(await runOperatorTool('loto', '__test_certify', {}, admin))
      expect(staged).toBe(true)
      expect(out).toMatchObject({ ok: true, staged: true, queueId: 'q-staged', action: 'loto_zero_energy_cert', authorizingRole: 'admin' })
      expect(out.note).toMatch(/will NOT take effect/i)
      expect(recorder.tables).toContain('agent_action_queue')
    } finally {
      delete OPERATOR_TOOLS.loto.__test_certify
    }
  })

  it('returns a regulated tool\'s stage refusal without recording anything', async () => {
    OPERATOR_TOOLS.loto.__test_reject = {
      definition: { name: '__test_reject', description: 'test', input_schema: { type: 'object', properties: {} } },
      agent: 'loto',
      minRole: 'admin',
      scope: { kind: 'regulated', action: 'loto_zero_energy_cert' },
      stage: async () => ({ ok: false, error: 'equipment not found' }),
    }
    try {
      const out = JSON.parse(await runOperatorTool('loto', '__test_reject', {}, admin))
      expect(out.ok).toBe(false)
      expect(out.error).toMatch(/equipment not found/i)
      expect(recorder.tables).not.toContain('agent_action_queue')
    } finally {
      delete OPERATOR_TOOLS.loto.__test_reject
    }
  })
})
