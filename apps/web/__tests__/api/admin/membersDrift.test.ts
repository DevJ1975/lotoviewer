import { beforeEach, describe, expect, it } from 'vitest'
import {
  emptyRequest,
  gateOk,
  gateRejects,
  jsonRequest,
  mockState,
  requireSuperadminMock,
  resetMocks,
} from '../superadmin/_helpers'

import { GET as listDrift, POST as reconcileDrift } from '@/app/api/admin/members/drift/route'

beforeEach(() => {
  resetMocks()
})

describe('GET /api/admin/members/drift', () => {
  it('rejects callers who fail the superadmin gate', async () => {
    gateRejects(403, 'Superadmin only')
    const res = await listDrift(emptyRequest('GET'))
    expect(res.status).toBe(403)
    expect(requireSuperadminMock).toHaveBeenCalled()
  })

  it('returns paginated findings', async () => {
    gateOk()
    mockState.queue('member_drift_findings', {
      data: [
        {
          id: 'f1',
          tenant_id: 't1',
          finding_type: 'missing_in_members',
          surface: 'profiles',
          surface_row_pk: 'p1',
          member_id: null,
          details: {},
          detected_at: '2026-05-15T03:00:00Z',
          reconciled_at: null,
        },
      ],
      error: null,
      count: 1,
    })

    const res = await listDrift(emptyRequest('GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.findings).toHaveLength(1)
    expect(body.count).toBe(1)
    expect(body.limit).toBeGreaterThan(0)
  })
})

describe('POST /api/admin/members/drift', () => {
  it('reconciles a single tenant via the two RPCs', async () => {
    gateOk()
    mockState.queue('rpc:reconcile_members_backfill', {
      data: [{ inserted_count: 2, updated_count: 1 }],
      error: null,
    })
    mockState.queue('rpc:audit_member_drift', { data: null, error: null })

    const validTenant = '00000000-0000-0000-0000-0000000000a1'
    const res = await reconcileDrift(jsonRequest('POST', { tenantId: validTenant }))
    expect(res.status).toBe(200)
    expect(mockState.rpcCalls).toContainEqual({
      name: 'reconcile_members_backfill',
      args: { p_tenant_id: validTenant },
    })
    expect(mockState.rpcCalls).toContainEqual({
      name: 'audit_member_drift',
      args: undefined,
    })
  })

  it('rejects a non-UUID tenantId with 400', async () => {
    gateOk()
    const res = await reconcileDrift(jsonRequest('POST', { tenantId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    expect(mockState.rpcCalls).toEqual([])
  })

  it('accepts an omitted tenantId for an all-tenants reconcile', async () => {
    gateOk()
    mockState.queue('rpc:reconcile_members_backfill', {
      data: [{ inserted_count: 0, updated_count: 0 }],
      error: null,
    })
    mockState.queue('rpc:audit_member_drift', { data: null, error: null })

    const res = await reconcileDrift(jsonRequest('POST', {}))
    expect(res.status).toBe(200)
    expect(mockState.rpcCalls[0]).toEqual({
      name: 'reconcile_members_backfill',
      args: { p_tenant_id: null },
    })
  })
})
