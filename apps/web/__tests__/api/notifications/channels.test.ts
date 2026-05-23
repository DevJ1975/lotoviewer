// Auth + validation boundary for the notification channels admin routes.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const gateMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin: (...a: unknown[]) => gateMock(...a),
}))
vi.mock('@/lib/security/sanitizeError', () => ({
  sanitizeError: () => Response.json({ error: 'internal' }, { status: 500 }),
}))

import { GET, POST } from '@/app/api/admin/notifications/channels/route'

function req(body?: unknown): Request {
  return new Request('https://example.com/api/admin/notifications/channels', {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const okGate = { ok: true, tenantId: 't1', userId: 'u1', authedClient: {} }

beforeEach(() => gateMock.mockReset())

describe('/api/admin/notifications/channels auth + validation', () => {
  it('GET surfaces the gate failure status (non-admin)', async () => {
    gateMock.mockResolvedValue({ ok: false, status: 403, message: 'Tenant admin or owner required' })
    expect((await GET(req())).status).toBe(403)
  })

  it('POST rejects a missing name', async () => {
    gateMock.mockResolvedValue(okGate)
    const res = await POST(req({ type: 'email', config: { to: 'a@b.com' } }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('name_required')
  })

  it('POST rejects an invalid channel type', async () => {
    gateMock.mockResolvedValue(okGate)
    const res = await POST(req({ name: 'Ops', type: 'carrier-pigeon', config: {} }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_type')
  })
})
