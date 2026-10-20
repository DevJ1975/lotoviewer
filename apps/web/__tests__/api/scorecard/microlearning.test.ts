import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/scorecard/microlearning feeds the EHS Scorecard's microlearning
// section: admin-gated, tenant from the gate, window limited to the
// scorecard's own options.

const { requireTenantAdminMock, loadMock } = vi.hoisted(() => ({ requireTenantAdminMock: vi.fn(), loadMock: vi.fn() }))
vi.mock('@/lib/auth/tenantGate', () => ({ requireTenantAdmin: (req: Request) => requireTenantAdminMock(req) }))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/strike/scorecardData', () => ({ loadMicrolearningSummary: (...a: unknown[]) => loadMock(...a) }))

import { GET } from '@/app/api/scorecard/microlearning/route'

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const get = (query: string) => GET(new Request(`http://localhost/api/scorecard/microlearning${query}`))

beforeEach(() => {
  vi.clearAllMocks()
  requireTenantAdminMock.mockResolvedValue({ ok: true, userId: 'admin', tenantId: TENANT_ID })
  loadMock.mockResolvedValue({ completions: 3 })
})

describe('GET /api/scorecard/microlearning', () => {
  it('refuses a non-admin with the gate status', async () => {
    requireTenantAdminMock.mockResolvedValue({ ok: false, status: 403, message: 'forbidden' })
    expect((await get('?window=30')).status).toBe(403)
    expect(loadMock).not.toHaveBeenCalled()
  })

  it('returns the summary for the gate tenant and the chosen window, uncached', async () => {
    const res = await get('?window=90')
    expect(await res.json()).toEqual({ summary: { completions: 3 } })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(loadMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, 90)
  })

  it('falls back to 30 days for a window the scorecard does not offer', async () => {
    await get('?window=3650')
    expect(loadMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, 30)
  })

  it('tells the page to hide the section when STRIKE is off', async () => {
    loadMock.mockResolvedValue(null)
    expect(await (await get('?window=30')).json()).toEqual({ summary: null })
  })
})
