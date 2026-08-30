import { beforeEach, describe, expect, it, vi } from 'vitest'

// Contract tests for POST /api/scorecard/export-xlsx. The route is admin-gated,
// derives the tenant SERVER-side (a caller can't export another tenant's data),
// recomputes the risk headline server-side, and streams the workbook as an
// attachment. We mock the gate, the risk computer, and the workbook builder so
// this stays a fast route-level test (the builder itself is covered separately).

const { requireTenantAdminMock, computeIncidentRiskMock, buildWorkbookMock, authedClient } = vi.hoisted(() => {
  // Awaitable, chainable Supabase stub: supports .select().eq().maybeSingle(),
  // a directly-awaited .select(), and .select().not().limit() — every shape the
  // route's tenant lookup + buildTargets reach for. All resolve to empty data.
  function chain(): Record<string, unknown> {
    const result = { data: null, error: null }
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      not: () => c,
      limit: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (onF: (v: typeof result) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onF, onR),
    }
    return c
  }
  return {
    requireTenantAdminMock: vi.fn(),
    computeIncidentRiskMock: vi.fn(),
    buildWorkbookMock: vi.fn(),
    authedClient: { from: () => chain() },
  }
})

vi.mock('@/lib/auth/tenantGate', () => ({ requireTenantAdmin: (req: Request) => requireTenantAdminMock(req) }))
vi.mock('@/lib/incidentRiskFeatures', () => ({ computeIncidentRisk: (...a: unknown[]) => computeIncidentRiskMock(...a) }))
vi.mock('@/lib/scorecardWorkbook', () => ({ buildScorecardWorkbook: (...a: unknown[]) => buildWorkbookMock(...a) }))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({}) }))

import { POST } from '@/app/api/scorecard/export-xlsx/route'

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const SPREADSHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function req(body: unknown): Request {
  return new Request('http://localhost/api/scorecard/export-xlsx', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireTenantAdminMock.mockResolvedValue({ ok: true, userId: 'admin', tenantId: TENANT_ID, authedClient })
  computeIncidentRiskMock.mockResolvedValue(null)
  buildWorkbookMock.mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
})

describe('POST /api/scorecard/export-xlsx', () => {
  it('rejects a non-admin with the gate status and never builds a workbook', async () => {
    requireTenantAdminMock.mockResolvedValue({ ok: false, status: 403, message: 'forbidden' })
    const res = await POST(req({ incidentMetrics: {} }))
    expect(res.status).toBe(403)
    expect(buildWorkbookMock).not.toHaveBeenCalled()
  })

  it('returns 400 on a malformed body', async () => {
    const res = await POST(req('{ not json'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_json' })
    expect(buildWorkbookMock).not.toHaveBeenCalled()
  })

  it('streams the workbook as an .xlsx attachment on the happy path', async () => {
    const res = await POST(req({ metrics: {}, incidentMetrics: {}, windowDays: 30 }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(SPREADSHEET_MIME)
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="ehs-scorecard-\d{4}-\d{2}-\d{2}\.xlsx"/)
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
    expect(buildWorkbookMock).toHaveBeenCalledOnce()
  })

  it('scopes risk to the gate tenant and ignores a client-supplied tenant id', async () => {
    await POST(req({ tenantId: 'attacker-tenant', incidentMetrics: {} }))
    expect(computeIncidentRiskMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID)
  })
})
