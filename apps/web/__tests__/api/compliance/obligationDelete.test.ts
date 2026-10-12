// DELETE /api/compliance/obligations/[id]: an obligation with compliance
// evaluations on record cannot be deleted (migration 298 holds it with a
// no-action foreign key), and the route says so plainly instead of
// surfacing a generic invalid_ref.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const gateMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin: (...a: unknown[]) => gateMock(...a),
}))
vi.mock('@/lib/security/sanitizeError', () => ({
  sanitizeError: () => Response.json({ error: 'internal' }, { status: 500 }),
}))

import { DELETE } from '@/app/api/compliance/obligations/[id]/route'

const ID = '0b000000-0000-4000-8000-000000000001'

function clientDeleting(result: { error: { code?: string; message: string } | null }) {
  const eq = vi.fn(async () => result)
  return { client: { from: vi.fn(() => ({ delete: () => ({ eq }) })) }, eq }
}

function del(id = ID) {
  return DELETE(new Request(`https://example.com/api/compliance/obligations/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) })
}

beforeEach(() => gateMock.mockReset())

describe('DELETE /api/compliance/obligations/[id]', () => {
  it('answers 409 with a plain reason when evaluations hold the obligation', async () => {
    const { client } = clientDeleting({ error: { code: '23503', message: 'violates foreign key constraint' } })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', userId: 'u1', authedClient: client })
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Dismiss it instead/)
  })

  it('deletes an obligation nothing holds', async () => {
    const { client, eq } = clientDeleting({ error: null })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', userId: 'u1', authedClient: client })
    expect((await del()).status).toBe(200)
    expect(eq).toHaveBeenCalledWith('id', ID)
  })

  it('hides any other database failure', async () => {
    const { client } = clientDeleting({ error: { code: 'XX000', message: 'internals' } })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', userId: 'u1', authedClient: client })
    expect((await del()).status).toBe(500)
  })

  it('passes a gate failure through and refuses a malformed id', async () => {
    gateMock.mockResolvedValue({ ok: false, status: 403, message: 'Tenant admin or owner required' })
    expect((await del()).status).toBe(403)
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', userId: 'u1', authedClient: {} })
    expect((await del('nope')).status).toBe(400)
  })
})
