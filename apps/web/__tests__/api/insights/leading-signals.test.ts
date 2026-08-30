import { describe, it, expect, beforeEach } from 'vitest'
// The AI harness mocks the tenant gate (member + admin) + Sentry — all the
// pre-DB guard path of this route touches.
import { gateOk, gateRejects, requireTenantMemberMock } from '../ai/_helpers'

async function importRoute() {
  return import('@/app/api/insights/leading-signals/route')
}

describe('leading-signals route — guards', () => {
  beforeEach(() => {
    requireTenantMemberMock.mockReset()
    gateOk()
  })

  it('rejects an unauthorized (non-admin) caller with the gate status', async () => {
    gateRejects(403, 'Admins only')
    const { GET } = await importRoute()
    const res = await GET(new Request('http://t/api/insights/leading-signals') as never)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/Admins only/)
  })
})
