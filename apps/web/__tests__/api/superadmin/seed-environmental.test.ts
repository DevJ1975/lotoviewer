import { describe, it, expect, beforeEach, vi } from 'vitest'
import { gateOk, gateRejects, mockState, resetMocks, emptyRequest, ctxFor } from './_helpers'

const seedEnvironmentalDemo = vi.fn()
vi.mock('@/lib/environmental/demoSeed', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/demoSeed')>('@/lib/environmental/demoSeed')
  return { ...actual, seedEnvironmentalDemo: (...a: unknown[]) => seedEnvironmentalDemo(...a) }
})
vi.mock('@/lib/environmental/demoStore', () => ({ supabaseDemoStore: () => ({}) }))

import { POST } from '@/app/api/superadmin/tenants/[number]/seed-environmental/route'

const SUMMARY = { sites: 3, permits: 5, outfalls: 5, evaluations: 14, deadlines: 5, runs: 4, libraryItems: 40 }
const demo = { id: 'T2', tenant_number: '0002', name: 'WLS Demo', is_demo: true }

describe('POST /api/superadmin/tenants/[number]/seed-environmental', () => {
  beforeEach(() => { resetMocks(); gateOk(); seedEnvironmentalDemo.mockReset(); seedEnvironmentalDemo.mockResolvedValue(SUMMARY) })

  it('is for superadmins', async () => {
    gateRejects(403, 'Superadmin only')
    expect((await POST(emptyRequest('POST'), ctxFor({ number: '0002' }))).status).toBe(403)
    expect(seedEnvironmentalDemo).not.toHaveBeenCalled()
  })

  it('rejects a malformed tenant number and an unknown tenant', async () => {
    expect((await POST(emptyRequest('POST'), ctxFor({ number: 'abc' }))).status).toBe(400)
    mockState.queue('tenants', { data: null, error: null })
    expect((await POST(emptyRequest('POST'), ctxFor({ number: '9999' }))).status).toBe(404)
  })

  it('REFUSES a non-demo tenant: DEMO records must never appear in a customer\'s data', async () => {
    mockState.queue('tenants', { data: { ...demo, is_demo: false }, error: null })
    const r = await POST(emptyRequest('POST'), ctxFor({ number: '0001' }))
    expect(r.status).toBe(403)
    expect(seedEnvironmentalDemo).not.toHaveBeenCalled()
  })

  it('seeds a demo tenant and says what it made, without wiping anything', async () => {
    mockState.queue('tenants', { data: demo, error: null })
    const r = await POST(emptyRequest('POST'), ctxFor({ number: '0002' }))
    const body = await r.json()
    expect(r.status).toBe(200)
    expect(body).toMatchObject({ ok: true, summary: SUMMARY })
    expect(body.message).toMatch(/environmental demo: 3 sites/)
    expect(mockState.deletes).toHaveLength(0)
  })

  it('reports why it could not seed', async () => {
    mockState.queue('tenants', { data: demo, error: null })
    seedEnvironmentalDemo.mockRejectedValue(new Error('The demo account has no members to own the demo records. Add a member and run it again.'))
    const r = await POST(emptyRequest('POST'), ctxFor({ number: '0002' }))
    expect(r.status).toBe(500)
    expect((await r.json()).error).toMatch(/no members/)
  })
})
