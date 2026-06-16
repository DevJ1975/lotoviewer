import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/weather/readings/route'

// The readings route writes through the gate's authedClient (RLS-scoped), so
// the gate mock carries a chainable client that records inserts. We assert the
// validation gate (400) and that a valid body stamps tenant/facility/creator
// before the insert.

interface ChainResult {
  data?: unknown
  error?: { message: string } | null
}

const { requireTenantMemberMock, mockState } = vi.hoisted(() => {
  class MockChainState {
    inserts: Array<{ table: string; payload: unknown }> = []
    result: ChainResult = { data: null, error: null }

    buildClient() {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        single: () => Promise.resolve(this.result),
        insert: (payload: unknown) => {
          this.inserts.push({ table: 'safety_weather_readings', payload })
          return chain
        },
        then: (onFulfilled: (value: ChainResult) => unknown) =>
          Promise.resolve(this.result).then(onFulfilled),
      }
      return { from: () => chain }
    }
  }

  return {
    requireTenantMemberMock: vi.fn(),
    mockState: new MockChainState(),
  }
})

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: (req: Request) => requireTenantMemberMock(req),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

const FACILITY_ID = '22222222-2222-2222-2222-222222222222'

function jsonRequest(body: unknown) {
  return new Request('http://x/api/weather/readings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify(body),
  })
}

function seedGate(facilityId: string | null = FACILITY_ID) {
  requireTenantMemberMock.mockResolvedValue({
    ok: true,
    tenantId: 'tenant-1',
    userId: 'user-1',
    facilityId,
    role: 'member',
    authedClient: mockState.buildClient(),
  })
}

describe('POST /api/weather/readings', () => {
  beforeEach(() => {
    requireTenantMemberMock.mockReset()
    mockState.inserts.length = 0
    mockState.result = { data: null, error: null }
    seedGate()
  })

  it('rejects an unauthenticated caller with the gate status', async () => {
    requireTenantMemberMock.mockResolvedValue({ ok: false, status: 401, message: 'Invalid session' })

    const response = await POST(jsonRequest({ measured_wind_mph: 12 }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Invalid session' })
    expect(mockState.inserts).toHaveLength(0)
  })

  it('returns 400 from the core validator when wind is missing', async () => {
    const response = await POST(jsonRequest({ instrument: 'Kestrel 3000' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'measured_wind_mph is required' })
    expect(mockState.inserts).toHaveLength(0)
  })

  it('returns 400 when a gust is lower than the sustained wind', async () => {
    const response = await POST(jsonRequest({ measured_wind_mph: 20, measured_gust_mph: 10 }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'measured_gust_mph cannot be less than measured_wind_mph' })
    expect(mockState.inserts).toHaveLength(0)
  })

  it('stamps tenant, creator, and the gate facility on a valid insert', async () => {
    mockState.result = {
      data: { id: 'reading-1', tenant_id: 'tenant-1', measured_wind_mph: 18 },
      error: null,
    }

    const response = await POST(jsonRequest({ measured_wind_mph: 18, measured_gust_mph: 24 }))

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      reading: { id: 'reading-1', tenant_id: 'tenant-1', measured_wind_mph: 18 },
    })
    expect(mockState.inserts).toEqual([
      expect.objectContaining({
        table: 'safety_weather_readings',
        payload: expect.objectContaining({
          tenant_id: 'tenant-1',
          facility_id: FACILITY_ID,
          created_by: 'user-1',
          measured_wind_mph: 18,
          measured_gust_mph: 24,
          unit_system: 'imperial',
        }),
      }),
    ])
  })

  it('ignores a client-supplied facility_id and scopes to the gate facility', async () => {
    // Security: a client must not be able to attribute an immutable reading to
    // an arbitrary or cross-tenant facility. The route derives scope from the gate.
    const bodyFacility = '33333333-3333-3333-3333-333333333333'
    mockState.result = { data: { id: 'reading-2' }, error: null }

    await POST(jsonRequest({ measured_wind_mph: 9, facility_id: bodyFacility }))

    expect(mockState.inserts[0].payload).toEqual(
      expect.objectContaining({ facility_id: FACILITY_ID }),
    )
  })
})
