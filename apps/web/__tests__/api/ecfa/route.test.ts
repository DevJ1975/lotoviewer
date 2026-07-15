import { describe, it, expect, beforeEach } from 'vitest'
// Import the shared AI harness first — it mocks the tenant gate (both
// requireTenantMember and requireTenantAdmin) + Sentry, which is all the
// pre-DB guard paths of the ECFA CRUD route touch.
import { gateOk, gateRejects, requireTenantMemberMock } from '../ai/_helpers'

const VALID = '11111111-1111-1111-1111-111111111111'

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function importRoute() {
  return import('@/app/api/incidents/[id]/ecfa/route')
}

describe('ECFA CRUD route — guard paths', () => {
  beforeEach(() => {
    requireTenantMemberMock.mockReset()
    gateOk()
  })

  it('rejects a non-uuid incident id with 400', async () => {
    const { GET } = await importRoute()
    const res = await GET(new Request('http://t/api/incidents/nope/ecfa'), ctx('nope'))
    expect(res.status).toBe(400)
  })

  it('returns the gate error when the caller is not authorized', async () => {
    gateRejects(401, 'Not a member')
    const { POST } = await importRoute()
    const res = await POST(
      new Request(`http://t/api/incidents/${VALID}/ecfa`, { method: 'POST', body: JSON.stringify({ node: { node_type: 'event', title: 'x' } }) }),
      ctx(VALID),
    )
    expect(res.status).toBe(401)
  })

  it('rejects invalid JSON with 400', async () => {
    const { POST } = await importRoute()
    const res = await POST(
      new Request(`http://t/api/incidents/${VALID}/ecfa`, { method: 'POST', body: 'not json' }),
      ctx(VALID),
    )
    expect(res.status).toBe(400)
  })

  it('rejects a node that fails validation (missing title) with 400', async () => {
    const { POST } = await importRoute()
    const res = await POST(
      new Request(`http://t/api/incidents/${VALID}/ecfa`, { method: 'POST', body: JSON.stringify({ node: { node_type: 'event', title: '   ' } }) }),
      ctx(VALID),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/title is required/)
  })

  it('rejects a DELETE without a nodeId with 400', async () => {
    const { DELETE } = await importRoute()
    const res = await DELETE(new Request(`http://t/api/incidents/${VALID}/ecfa`, { method: 'DELETE' }), ctx(VALID))
    expect(res.status).toBe(400)
  })
})
