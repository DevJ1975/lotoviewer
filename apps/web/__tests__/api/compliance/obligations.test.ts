// Auth + validation boundary for /api/compliance/obligations. The DB happy
// path is covered indirectly by the complianceCalendar unit tests; here we
// assert the gate is enforced and inputs are validated before any write.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const gateMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin: (...a: unknown[]) => gateMock(...a),
}))
vi.mock('@/lib/security/sanitizeError', () => ({
  sanitizeError: () => Response.json({ error: 'internal' }, { status: 500 }),
}))

import { GET, POST } from '@/app/api/compliance/obligations/route'

function req(body?: unknown): Request {
  return new Request('https://example.com/api/compliance/obligations', {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const okGate = { ok: true, tenantId: 't1', userId: 'u1', authedClient: {} }

beforeEach(() => gateMock.mockReset())

describe('/api/compliance/obligations auth + validation', () => {
  it('GET surfaces the gate failure status (forged/insufficient tenant)', async () => {
    gateMock.mockResolvedValue({ ok: false, status: 403, message: 'Tenant admin or owner required' })
    const res = await GET(req())
    expect(res.status).toBe(403)
  })

  it('POST rejects a missing title', async () => {
    gateMock.mockResolvedValue(okGate)
    const res = await POST(req({ next_due_at: '2026-03-01', cadence: 'annual' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('title_required')
  })

  it('POST rejects a malformed due date', async () => {
    gateMock.mockResolvedValue(okGate)
    const res = await POST(req({ title: 'X', next_due_at: 'soon', cadence: 'annual' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('next_due_at_required')
  })

  it('POST rejects an invalid cadence', async () => {
    gateMock.mockResolvedValue(okGate)
    const res = await POST(req({ title: 'X', next_due_at: '2026-03-01', cadence: 'weekly' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_cadence')
  })

  it('POST requires cadence_days when cadence is custom_days', async () => {
    gateMock.mockResolvedValue(okGate)
    const res = await POST(req({ title: 'X', next_due_at: '2026-03-01', cadence: 'custom_days' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('cadence_days_required')
  })
})
