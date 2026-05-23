// Auth + validation boundary for the inspection template builder routes.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const gateMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin: (...a: unknown[]) => gateMock(...a),
}))
vi.mock('@/lib/security/sanitizeError', () => ({
  sanitizeError: () => Response.json({ error: 'internal' }, { status: 500 }),
}))

import { GET, POST } from '@/app/api/inspections/templates/route'

function req(body?: unknown): Request {
  return new Request('https://example.com/api/inspections/templates', {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const okGate = { ok: true, tenantId: 't1', userId: 'u1', authedClient: {} }

beforeEach(() => gateMock.mockReset())

describe('/api/inspections/templates auth + validation', () => {
  it('GET surfaces the gate failure status', async () => {
    gateMock.mockResolvedValue({ ok: false, status: 403, message: 'Tenant admin or owner required' })
    expect((await GET(req())).status).toBe(403)
  })

  it('POST rejects a missing name', async () => {
    gateMock.mockResolvedValue(okGate)
    const res = await POST(req({ items: [{ item_type: 'pass_fail_na', prompt: 'OK?' }] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('name_required')
  })

  it('POST rejects a template with no valid items', async () => {
    gateMock.mockResolvedValue(okGate)
    // item missing a prompt → filtered out → items_required
    const res = await POST(req({ name: 'Forklift', items: [{ item_type: 'pass_fail_na' }] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('items_required')
  })

  it('POST rejects items with an unknown type (filtered → items_required)', async () => {
    gateMock.mockResolvedValue(okGate)
    const res = await POST(req({ name: 'Forklift', items: [{ item_type: 'rating', prompt: 'Stars?' }] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('items_required')
  })
})
