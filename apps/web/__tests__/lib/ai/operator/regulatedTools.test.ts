import { describe, it, expect, vi, beforeEach } from 'vitest'

let nextResult: { data: unknown; error: { message: string } | null }
let tables: string[]

function makeBuilder() {
  const b: Record<string, unknown> = {}
  const ret = () => b
  for (const m of ['select', 'eq', 'maybeSingle']) b[m] = ret
  b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(nextResult).then(onF, onR)
  return b
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => { tables.push(t); return makeBuilder() } }),
}))

import { authorizeHotWorkPermit } from '@/lib/ai/operator/regulatedTools'
import { getOperatorToolDefinitions } from '@/lib/ai/operator/registry'

const ctx = { tenantId: 'tenant-A', userId: 'u1', role: 'member' as const, conversationId: 'c1' }
const PERMIT = '11111111-1111-4111-8111-111111111111'

// the union guarantees a regulated tool carries `stage`, not `handler`.
const stage = (authorizeHotWorkPermit as Extract<typeof authorizeHotWorkPermit, { scope: { kind: 'regulated' } }>).stage

beforeEach(() => { nextResult = { data: null, error: null }; tables = [] })

describe('authorize_hot_work_permit registration', () => {
  it('is a permits regulated tool visible to a member but not a viewer', () => {
    expect(authorizeHotWorkPermit.scope).toEqual({ kind: 'regulated', action: 'permit_hot_work_auth' })
    expect(getOperatorToolDefinitions('permits', 'member').map(d => d.name)).toContain('authorize_hot_work_permit')
    expect(getOperatorToolDefinitions('permits', 'viewer').map(d => d.name)).not.toContain('authorize_hot_work_permit')
  })
})

describe('authorize_hot_work_permit stage', () => {
  it('summarizes an active, unsigned permit and returns the validated payload', async () => {
    nextResult = { data: { serial: 'HWP-20260618-0003', work_description: 'Weld a bracket', work_location: 'Bay 3', pai_signature_at: null, canceled_at: null }, error: null }
    const res = await stage({ permit_id: PERMIT }, ctx)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.payload).toEqual({ permit_id: PERMIT })
      expect(res.summary).toMatch(/HWP-20260618-0003/)
      expect(res.summary).toMatch(/Bay 3/)
    }
    expect(tables).toEqual(['loto_hot_work_permits'])
  })

  it('rejects a malformed permit_id before any query', async () => {
    const res = await stage({ permit_id: 'nope' }, ctx)
    expect(res).toMatchObject({ ok: false })
    if (!res.ok) expect(res.error).toMatch(/permit_id/i)
    expect(tables).toEqual([])
  })

  it('refuses a permit that does not exist in the tenant', async () => {
    nextResult = { data: null, error: null }
    const res = await stage({ permit_id: PERMIT }, ctx)
    expect(res).toMatchObject({ ok: false })
    if (!res.ok) expect(res.error).toMatch(/no hot-work permit/i)
  })

  it('refuses a canceled permit', async () => {
    nextResult = { data: { serial: 'HWP-1', work_description: 'x', work_location: 'y', pai_signature_at: null, canceled_at: '2026-06-18T00:00:00Z' }, error: null }
    const res = await stage({ permit_id: PERMIT }, ctx)
    expect(res).toMatchObject({ ok: false })
    if (!res.ok) expect(res.error).toMatch(/canceled/i)
  })

  it('refuses a permit that is already authorized', async () => {
    nextResult = { data: { serial: 'HWP-1', work_description: 'x', work_location: 'y', pai_signature_at: '2026-06-18T00:00:00Z', canceled_at: null }, error: null }
    const res = await stage({ permit_id: PERMIT }, ctx)
    expect(res).toMatchObject({ ok: false })
    if (!res.ok) expect(res.error).toMatch(/already authorized/i)
  })
})
