import { describe, it, expect, beforeEach, vi } from 'vitest'

// POST /api/hazardous-waste/inspections validates every finding against the check
// catalog. A state's additional checks are real checks, so a finding for one is
// accepted; an unknown id and a check that does not apply to the area's kind are not.

const requireTenantModuleMemberMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantModuleMember: (...args: unknown[]) => requireTenantModuleMemberMock(...args),
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

interface ChainResult { data?: unknown; error?: { message: string; code?: string } | null }
const results = new Map<string, ChainResult>()
const inserts: unknown[] = []

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const result = () => Promise.resolve(results.get(table) ?? { data: null, error: null })
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain,
        insert: (payload: unknown) => { inserts.push(payload); results.set(table, { data: { id: 'inspection-1', ...(payload as object) }, error: null }); return chain },
        single: result, maybeSingle: result,
      }
      return chain
    },
  }),
}))

import { POST } from '@/app/api/hazardous-waste/inspections/route'

const TENANT = '11111111-1111-4111-8111-111111111111'
const AREA = '33333333-3333-4333-8333-333333333333'

const post = (findings: unknown[]) => POST(new Request('http://x/api/hazardous-waste/inspections', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ area_id: AREA, findings }),
}))

const pass = (check_id: string) => ({ check_id, status: 'pass' })

beforeEach(() => {
  results.clear()
  inserts.length = 0
  requireTenantModuleMemberMock.mockReset().mockResolvedValue({ ok: true, tenantId: TENANT, userId: 'user-1' })
  results.set('hazardous_waste_areas', { data: { id: AREA, area_type: 'central_accumulation', archived_at: null } })
})

describe('inspection findings from a state\'s additional checks', () => {
  it('accepts a California check on a central accumulation area', async () => {
    const res = await post([pass('closed-container'), pass('ca-label-contents')])
    expect(res.status).toBe(201)
    expect(JSON.stringify(inserts[0])).toContain('ca-label-contents')
  })

  it('takes whether a check is critical from the catalog, not from the client', async () => {
    const res = await post([{ check_id: 'ca-label-contents', status: 'fail', flagged_critical: false }])
    expect(res.status).toBe(201)
    const stored = (inserts[0] as { findings: Array<{ check_id: string; flagged_critical: boolean }> }).findings
    expect(stored[0]).toMatchObject({ check_id: 'ca-label-contents', flagged_critical: true })
  })

  it('refuses a check id no jurisdiction defines', async () => {
    const res = await post([pass('ca-made-up')])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Unknown check_id: ca-made-up/)
    expect(inserts).toEqual([])
  })

  it('refuses a state check that does not apply to this kind of area', async () => {
    const res = await post([pass('ca-uw-category')])   // a universal waste check, posted against central accumulation
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/does not apply to central_accumulation/)
    expect(inserts).toEqual([])
  })

  it('still accepts the federal checks on their own', async () => {
    expect((await post([pass('closed-container'), pass('label-readable')])).status).toBe(201)
  })
})
