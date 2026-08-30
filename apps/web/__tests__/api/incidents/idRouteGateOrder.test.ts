import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression cover for the PATCH gate ordering on /api/incidents/[id].
//
// The route used to reject unknown field names before running the auth
// gate, so an unauthenticated caller could tell a real field from an
// invented one by whether the reply was 400 or 401 — an oracle for which
// fields exist and which are admin-gated.

const { requireTenantMemberMock, requireTenantAdminMock } = vi.hoisted(() => ({
  requireTenantMemberMock: vi.fn(),
  requireTenantAdminMock:  vi.fn(),
}))

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: (req: Request) => requireTenantMemberMock(req),
  requireTenantAdmin:  (req: Request) => requireTenantAdminMock(req),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({ from: () => ({}) }),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

const INCIDENT_ID = '11111111-1111-1111-1111-111111111111'

function ctx() {
  return { params: Promise.resolve({ id: INCIDENT_ID }) }
}

function patch(body: unknown) {
  return new Request(`http://x/api/incidents/${INCIDENT_ID}`, {
    method:  'PATCH',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

async function importRoute() {
  return import('@/app/api/incidents/[id]/route')
}

describe('PATCH /api/incidents/[id] — authorize before describing the schema', () => {
  beforeEach(() => {
    requireTenantMemberMock.mockReset()
    requireTenantAdminMock.mockReset()
    const reject = { ok: false, status: 401, message: 'Not a member' }
    requireTenantMemberMock.mockResolvedValue(reject)
    requireTenantAdminMock.mockResolvedValue(reject)
  })

  it('answers 401, not "Unknown field", for an unauthenticated caller', async () => {
    const { PATCH } = await importRoute()
    const res = await PATCH(patch({ not_a_real_field: 'x' }), ctx())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).not.toMatch(/Unknown field/)
  })

  it('gives an unauthenticated caller the same answer for real and invented fields', async () => {
    const { PATCH } = await importRoute()

    const invented = await PATCH(patch({ not_a_real_field: 'x' }), ctx())
    const real     = await PATCH(patch({ description: 'x' }), ctx())
    const adminOnly = await PATCH(patch({ status: 'closed' }), ctx())

    // Identical replies: nothing distinguishes a field that exists from one
    // that does not, nor a member field from an admin-gated one.
    expect(invented.status).toBe(401)
    expect(real.status).toBe(401)
    expect(adminOnly.status).toBe(401)
  })

  it('still rejects unknown fields once the caller is authorized', async () => {
    requireTenantMemberMock.mockResolvedValue({
      ok: true, userId: 'u1', tenantId: 't1', userEmail: 'u@x.test',
      role: 'member', authedClient: {} as never,
    })

    const { PATCH } = await importRoute()
    const res = await PATCH(patch({ not_a_real_field: 'x' }), ctx())

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Unknown field/)
  })

  it('routes a status change to the admin guard, not the member guard', async () => {
    const { PATCH } = await importRoute()
    await PATCH(patch({ status: 'closed' }), ctx())

    expect(requireTenantAdminMock).toHaveBeenCalledTimes(1)
    expect(requireTenantMemberMock).not.toHaveBeenCalled()
  })
})
