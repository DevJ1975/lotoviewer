import { beforeEach, describe, expect, it, vi } from 'vitest'

// Contract tests for POST /api/scorecard/export. Same security posture as the
// xlsx route: admin-gated, tenant derived server-side, risk recomputed
// server-side, PDF streamed as an attachment. The gate, risk computer, and PDF
// builder are mocked so this stays a fast route-level test.

const { requireTenantAdminMock, computeIncidentRiskMock, buildPdfMock, authedClient } = vi.hoisted(() => {
  function chain(): Record<string, unknown> {
    // logo_url omitted ⇒ the route skips the network logo fetch entirely.
    const result = { data: { name: 'Acme', logo_url: null }, error: null }
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      maybeSingle: () => Promise.resolve(result),
      then: (onF: (v: typeof result) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onF, onR),
    }
    return c
  }
  return {
    requireTenantAdminMock: vi.fn(),
    computeIncidentRiskMock: vi.fn(),
    buildPdfMock: vi.fn(),
    authedClient: { from: () => chain() },
  }
})

vi.mock('@/lib/auth/tenantGate', () => ({ requireTenantAdmin: (req: Request) => requireTenantAdminMock(req) }))
vi.mock('@/lib/incidentRiskFeatures', () => ({ computeIncidentRisk: (...a: unknown[]) => computeIncidentRiskMock(...a) }))
vi.mock('@/lib/pdfScorecard', () => ({ buildScorecardPdf: (...a: unknown[]) => buildPdfMock(...a) }))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({}) }))

import { POST } from '@/app/api/scorecard/export/route'

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

function req(body: unknown): Request {
  return new Request('http://localhost/api/scorecard/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireTenantAdminMock.mockResolvedValue({ ok: true, userId: 'admin', tenantId: TENANT_ID, authedClient })
  computeIncidentRiskMock.mockResolvedValue(null)
  buildPdfMock.mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
})

describe('POST /api/scorecard/export', () => {
  it('rejects a non-admin with the gate status and never builds a PDF', async () => {
    requireTenantAdminMock.mockResolvedValue({ ok: false, status: 401, message: 'unauthorized' })
    const res = await POST(req({ incidentMetrics: {} }))
    expect(res.status).toBe(401)
    expect(buildPdfMock).not.toHaveBeenCalled()
  })

  it('returns 400 on a malformed body', async () => {
    const res = await POST(req('{ not json'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_json' })
    expect(buildPdfMock).not.toHaveBeenCalled()
  })

  it('streams the report as a .pdf attachment on the happy path', async () => {
    const res = await POST(req({ metrics: {}, incidentMetrics: {}, windowDays: 30 }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="ehs-scorecard-\d{4}-\d{2}-\d{2}\.pdf"/)
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
    expect(buildPdfMock).toHaveBeenCalledOnce()
  })

  it('scopes risk to the gate tenant and ignores a client-supplied tenant id', async () => {
    await POST(req({ tenantId: 'attacker-tenant', incidentMetrics: {} }))
    expect(computeIncidentRiskMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID)
  })
})
