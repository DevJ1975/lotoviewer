import { describe, it, expect, vi, beforeEach } from 'vitest'

// Builder mock supporting select(...).eq(...).maybeSingle() reads and
// update(...).eq(...) writes. Records tables, eq filters, and update payloads;
// awaiting any chain resolves to `nextResult`.
interface Recorder { tables: string[]; eq: Array<[string, unknown]>; updates: Array<Record<string, unknown>> }
let recorder: Recorder
let nextResult: { data: unknown; error: { message: string } | null }

function makeBuilder() {
  const b: Record<string, unknown> = {}
  const ret = () => b
  for (const m of ['select', 'maybeSingle', 'single', 'order', 'limit']) b[m] = ret
  b.eq = (col: string, val: unknown) => { recorder.eq.push([col, val]); return b }
  b.update = (payload: Record<string, unknown>) => { recorder.updates.push(payload); return b }
  b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(nextResult).then(onF, onR)
  return b
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => { recorder.tables.push(table); return makeBuilder() },
  }),
}))

import { getOperatorToolDefinitions, runOperatorTool } from '@/lib/ai/operator/registry'

const admin = { tenantId: 'tenant-A', userId: 'u1', role: 'admin' as const, conversationId: 'c1' }
const member = { ...admin, role: 'member' as const }

beforeEach(() => {
  recorder = { tables: [], eq: [], updates: [] }
  nextResult = { data: {}, error: null }
})

describe('home-config tool registration + role gating', () => {
  it('exposes the three home tools to an admin in sorted order', () => {
    const names = getOperatorToolDefinitions('home', 'admin').map(d => d.name)
    expect(names).toEqual(['get_home_config', 'set_default_landing_path', 'set_module_visibility'])
  })

  it('hides all home tools from a member (they are admin-gated)', () => {
    expect(getOperatorToolDefinitions('home', 'member')).toEqual([])
  })

  it('refuses a home write for a below-role caller without touching the DB', async () => {
    const out = JSON.parse(await runOperatorTool('home', 'set_module_visibility', { module_id: 'incidents', visible: false }, member))
    expect(out.ok).toBe(false)
    expect(out.refusal).toBeTruthy()
    expect(recorder.tables).toEqual([])
  })
})

describe('get_home_config', () => {
  it('returns the landing path, name, and per-module visibility', async () => {
    nextResult = { data: { name: 'Acme', settings: { default_landing_path: '/loto' }, modules: { incidents: false } }, error: null }
    const out = JSON.parse(await runOperatorTool('home', 'get_home_config', {}, admin))

    expect(out.ok).toBe(true)
    expect(out.data.tenant_name).toBe('Acme')
    expect(out.data.default_landing_path).toBe('/loto')
    const incidents = out.data.modules.find((m: { id: string }) => m.id === 'incidents')
    const loto = out.data.modules.find((m: { id: string }) => m.id === 'loto')
    expect(incidents.visible).toBe(false)   // explicit override
    expect(loto.visible).toBe(true)         // no override → default-enabled
  })
})

describe('set_default_landing_path', () => {
  it('validates against the live catalog and merges into settings (preserving other keys)', async () => {
    nextResult = { data: { settings: { ai_disabled: true }, modules: { loto: true } }, error: null }
    const out = JSON.parse(await runOperatorTool('home', 'set_default_landing_path', { path: '/loto' }, admin))

    expect(out.ok).toBe(true)
    expect(recorder.eq).toContainEqual(['id', 'tenant-A'])
    expect(recorder.updates[0]).toEqual({ settings: { ai_disabled: true, default_landing_path: '/loto' } })
  })

  it('rejects a path that resolves to no visible module — without writing', async () => {
    nextResult = { data: { settings: {}, modules: { loto: true } }, error: null }
    const out = JSON.parse(await runOperatorTool('home', 'set_default_landing_path', { path: '/not-a-real-module' }, admin))

    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/valid landing path/i)
    expect(recorder.updates).toEqual([])
  })
})

describe('set_module_visibility', () => {
  it('merges the toggle into tenants.modules', async () => {
    nextResult = { data: { modules: { loto: true } }, error: null }
    const out = JSON.parse(await runOperatorTool('home', 'set_module_visibility', { module_id: 'incidents', visible: false }, admin))

    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ module_id: 'incidents', visible: false })
    expect(recorder.eq).toContainEqual(['id', 'tenant-A'])
    expect(recorder.updates[0]).toEqual({ modules: { loto: true, incidents: false } })
  })

  it('rejects an unknown module id before any DB access', async () => {
    const out = JSON.parse(await runOperatorTool('home', 'set_module_visibility', { module_id: 'not-a-real-module', visible: true }, admin))
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/unknown module/i)
    expect(recorder.tables).toEqual([])
  })
})
