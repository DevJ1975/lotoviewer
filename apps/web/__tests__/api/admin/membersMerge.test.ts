import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonRequest, mockState, resetMocks } from '../superadmin/_helpers'

const { requireTenantAdminMock } = vi.hoisted(() => ({
  requireTenantAdminMock: vi.fn(),
}))

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin: (req: Request) => requireTenantAdminMock(req),
}))

import { POST as mergeRoute } from '@/app/api/admin/members/merge/route'

const TENANT = '11111111-1111-1111-1111-111111111111'
const SOURCE = '22222222-2222-2222-2222-222222222222'
const TARGET = '33333333-3333-3333-3333-333333333333'

function tenantAdminOk() {
  requireTenantAdminMock.mockResolvedValue({
    ok: true,
    userId: 'admin-1',
    userEmail: 'admin@example.com',
    tenantId: TENANT,
    role: 'admin',
    authedClient: {},
  })
}

describe('POST /api/admin/members/merge', () => {
  beforeEach(() => {
    resetMocks()
    tenantAdminOk()
  })

  it('returns 409 when both source and target have profile_id (BOTH_HAVE_LOGIN)', async () => {
    mockState.queue('members', {
      data: [
        { id: SOURCE, tenant_id: TENANT, profile_id: 'u1', status: 'active' },
        { id: TARGET, tenant_id: TENANT, profile_id: 'u2', status: 'active' },
      ],
      error: null,
    })

    const res = await mergeRoute(jsonRequest('POST', {
      sourceMemberId: SOURCE,
      targetMemberId: TARGET,
      reason: 'duplicate import',
    }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('BOTH_HAVE_LOGIN')
    expect(mockState.rpcCalls.find(c => c.name === 'merge_members')).toBeUndefined()
  })

  it('calls merge_members RPC when only one side has profile_id', async () => {
    mockState.queue('members', {
      data: [
        { id: SOURCE, tenant_id: TENANT, profile_id: null, status: 'active' },
        { id: TARGET, tenant_id: TENANT, profile_id: 'u2', status: 'active' },
      ],
      error: null,
    })
    mockState.queue('rpc:merge_members', { data: TARGET, error: null })

    const res = await mergeRoute(jsonRequest('POST', {
      sourceMemberId: SOURCE,
      targetMemberId: TARGET,
      reason: 'duplicate import',
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ targetMemberId: TARGET })
    expect(mockState.rpcCalls).toContainEqual({
      name: 'merge_members',
      args: {
        p_source_id: SOURCE,
        p_target_id: TARGET,
        p_actor_id:  'admin-1',
        p_reason:    'duplicate import',
      },
    })
  })

  it('rejects malformed body (missing reason)', async () => {
    const res = await mergeRoute(jsonRequest('POST', {
      sourceMemberId: SOURCE,
      targetMemberId: TARGET,
    }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when one member is missing from the active tenant', async () => {
    // Only one row returned — tenant mismatch or wrong id.
    mockState.queue('members', {
      data: [{ id: SOURCE, tenant_id: TENANT, profile_id: null, status: 'active' }],
      error: null,
    })
    const res = await mergeRoute(jsonRequest('POST', {
      sourceMemberId: SOURCE,
      targetMemberId: TARGET,
      reason: 'duplicate',
    }))
    expect(res.status).toBe(404)
  })
})
