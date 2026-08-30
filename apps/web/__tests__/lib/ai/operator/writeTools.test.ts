import { describe, it, expect, vi, beforeEach } from 'vitest'

// Builder mock that supports insert(...).select(...).single() and records the
// table + insert payload so we can assert tenant scoping. Awaiting any chain
// resolves to `nextResult`.
interface Recorder { tables: string[]; inserts: Array<Record<string, unknown>> }
let recorder: Recorder
let nextResult: { data: unknown; error: { message: string } | null }

function makeBuilder() {
  const b: Record<string, unknown> = {}
  const ret = () => b
  for (const m of ['select', 'single', 'maybeSingle', 'eq', 'order', 'limit']) b[m] = ret
  b.insert = (payload: Record<string, unknown>) => { recorder.inserts.push(payload); return b }
  b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(nextResult).then(onF, onR)
  return b
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => { recorder.tables.push(table); return makeBuilder() },
  }),
}))

import { getOperatorToolDefinitions, runOperatorTool } from '@/lib/ai/operator/registry'

const member = { tenantId: 'tenant-A', userId: 'u1', role: 'member' as const, conversationId: 'c1' }
const viewer = { ...member, role: 'viewer' as const }

// A clearly-past timestamp (today is 2026-06-17 in this project's fixtures).
const PAST = '2026-06-10T08:00:00Z'

beforeEach(() => {
  recorder = { tables: [], inserts: [] }
  nextResult = { data: { id: 'row-1', report_number: 'X-2026-0001', status: 'new' }, error: null }
})

describe('write tool registration + role gating', () => {
  it('exposes file_near_miss to a member but not a viewer', () => {
    expect(getOperatorToolDefinitions('incidents', 'member').map(d => d.name)).toContain('file_near_miss')
    expect(getOperatorToolDefinitions('incidents', 'viewer')).toEqual([])
  })

  it('exposes submit_bbs_observation to a member', () => {
    expect(getOperatorToolDefinitions('bbs', 'member').map(d => d.name)).toContain('submit_bbs_observation')
  })

  it('refuses a write for a below-role caller without touching the DB', async () => {
    const out = JSON.parse(await runOperatorTool('incidents', 'file_near_miss', {
      occurred_at: PAST, description: 'Guard left open', hazard_category: 'mechanical', severity_potential: 'high',
    }, viewer))
    expect(out.ok).toBe(false)
    expect(out.refusal).toBeTruthy()
    expect(recorder.tables).toEqual([])
  })
})

describe('file_near_miss', () => {
  it('inserts a tenant-scoped near-miss authored by the caller', async () => {
    const out = JSON.parse(await runOperatorTool('incidents', 'file_near_miss', {
      occurred_at: PAST,
      description: 'Forklift nearly struck a pedestrian at the dock.',
      hazard_category: 'mechanical',
      severity_potential: 'high',
      location: 'Dock 4',
    }, member))

    expect(out.ok).toBe(true)
    expect(out.data.report_number).toBe('X-2026-0001')
    expect(recorder.tables).toEqual(['near_misses'])
    expect(recorder.inserts[0]).toMatchObject({
      tenant_id: 'tenant-A',
      reported_by: 'u1',
      hazard_category: 'mechanical',
      severity_potential: 'high',
      location: 'Dock 4',
    })
  })

  it('rejects an out-of-enum hazard category before any DB write', async () => {
    const out = JSON.parse(await runOperatorTool('incidents', 'file_near_miss', {
      occurred_at: PAST, description: 'Something happened', hazard_category: 'meteor', severity_potential: 'high',
    }, member))
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/hazard category/i)
    expect(recorder.tables).toEqual([])
  })

  it('rejects a future occurred_at before any DB write', async () => {
    const out = JSON.parse(await runOperatorTool('incidents', 'file_near_miss', {
      occurred_at: '2099-01-01T00:00:00Z', description: 'Time traveler', hazard_category: 'physical', severity_potential: 'low',
    }, member))
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/future/i)
    expect(recorder.tables).toEqual([])
  })
})

describe('submit_bbs_observation', () => {
  it('inserts a tenant-scoped unsafe observation authored by the caller', async () => {
    const out = JSON.parse(await runOperatorTool('bbs', 'submit_bbs_observation', {
      kind: 'unsafe_act',
      description: 'Worker bypassed the machine guard on line 3.',
      severity: 'high',
      likelihood: 'medium',
    }, member))

    expect(out.ok).toBe(true)
    expect(recorder.tables).toEqual(['bbs_observations'])
    expect(recorder.inserts[0]).toMatchObject({
      tenant_id: 'tenant-A',
      submitted_by: 'u1',
      kind: 'unsafe_act',
      severity: 'high',
      likelihood: 'medium',
      status: 'open',
    })
  })

  it('accepts a safe_behavior without severity/likelihood', async () => {
    const out = JSON.parse(await runOperatorTool('bbs', 'submit_bbs_observation', {
      kind: 'safe_behavior',
      description: 'Operator wore full PPE and followed the lockout steps.',
    }, member))
    expect(out.ok).toBe(true)
    expect(recorder.inserts[0]).toMatchObject({ kind: 'safe_behavior', severity: null, likelihood: null })
  })

  it('rejects an unsafe observation missing severity/likelihood before any DB write', async () => {
    const out = JSON.parse(await runOperatorTool('bbs', 'submit_bbs_observation', {
      kind: 'unsafe_condition',
      description: 'Slippery spill near the east exit.',
    }, member))
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/severity|likelihood/i)
    expect(recorder.tables).toEqual([])
  })
})
