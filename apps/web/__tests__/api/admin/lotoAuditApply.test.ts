// The apply route is the ONLY in-app path that writes audit fixes to the live
// LOTO tables. Its safety contract is ordering: capture_audit_snapshot (the
// rollback save point) MUST run BEFORE apply_approved_audit_changes. After
// applying, it regenerates placards only for equipment whose printed content
// changed. We assert call order on the two RPCs and that regeneration targets
// the right (deduped, placard-affecting) equipment.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  requireTenantAdminMock,
  regenerateAndUploadPlacardMock,
  rpcCalls, rpcResults, state,
  resetState,
} = vi.hoisted(() => {
  const rpcCalls: Array<{ name: string; args: unknown }> = []
  const rpcResults = new Map<string, { data?: unknown; error?: { message: string } | null }>()
  // Mutable shared state — reference state.appliedChanges / state.runRow in
  // tests so reassignment goes through this object (destructured consts can't
  // be reassigned).
  const state = {
    appliedChanges: [] as Array<{ equipment_id: string; change_kind: string }>,
    runRow: { data: { id: 'run-1', status: 'awaiting_review' } } as { data: unknown },
  }
  return {
    requireTenantAdminMock: vi.fn(),
    regenerateAndUploadPlacardMock: vi.fn(async (_admin: unknown, _tenantId: string, _equipmentId: string) => ({ placardUrl: 'https://cdn/p.pdf?v=1' })),
    rpcCalls,
    rpcResults,
    state,
    resetState() {
      rpcCalls.length = 0
      rpcResults.clear()
      state.appliedChanges = []
      state.runRow = { data: { id: 'run-1', status: 'awaiting_review' } }
    },
  }
})

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin: (req: Request) => requireTenantAdminMock(req),
}))

vi.mock('@/lib/loto/regeneratePlacard', () => ({
  regenerateAndUploadPlacard: (admin: unknown, tenantId: string, equipmentId: string) =>
    regenerateAndUploadPlacardMock(admin, tenantId, equipmentId),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

// supabaseAdmin stub: run lookup via from().maybeSingle(), the applied-changes
// read via an awaited from() chain, and the two RPCs recorded in order.
vi.mock('@/lib/supabaseAdmin', () => {
  function from(table: string) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve(table === 'loto_audit_runs' ? state.runRow : { data: null, error: null }),
      then: (onF: (v: { data: unknown; error: unknown }) => unknown, onR?: (e: unknown) => unknown) => {
        const data = table === 'loto_audit_changes' ? state.appliedChanges : null
        return Promise.resolve({ data, error: null }).then(onF, onR)
      },
    }
    return chain
  }
  return {
    supabaseAdmin: () => ({
      from,
      rpc: (name: string, args: unknown) => {
        rpcCalls.push({ name, args })
        return Promise.resolve(rpcResults.get(name) ?? { data: null, error: null })
      },
    }),
  }
})

import { POST } from '@/app/api/admin/loto/audit/[runId]/apply/route'

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = 'admin-user'
const RUN_ID = 'run-1'

function req(): Request {
  return new Request('http://localhost/api/admin/loto/audit/run-1/apply', { method: 'POST' })
}
function ctx() {
  return { params: Promise.resolve({ runId: RUN_ID }) }
}

beforeEach(() => {
  resetState()
  requireTenantAdminMock.mockReset()
  regenerateAndUploadPlacardMock.mockClear()
  requireTenantAdminMock.mockResolvedValue({ ok: true, userId: USER_ID, tenantId: TENANT_ID })
  regenerateAndUploadPlacardMock.mockResolvedValue({ placardUrl: 'https://cdn/p.pdf?v=1' })
})

describe('POST /api/admin/loto/audit/[runId]/apply — snapshot-before-apply', () => {
  it('calls capture_audit_snapshot BEFORE apply_approved_audit_changes', async () => {
    rpcResults.set('capture_audit_snapshot', { data: 'snap-1', error: null })
    rpcResults.set('apply_approved_audit_changes', { data: 3, error: null })

    const res = await POST(req(), ctx())

    expect(res.status).toBe(200)
    const names = rpcCalls.map(c => c.name)
    const snapIdx = names.indexOf('capture_audit_snapshot')
    const applyIdx = names.indexOf('apply_approved_audit_changes')
    expect(snapIdx).toBeGreaterThanOrEqual(0)
    expect(applyIdx).toBeGreaterThanOrEqual(0)
    expect(snapIdx).toBeLessThan(applyIdx)
  })

  it('aborts (and does NOT apply) when the snapshot fails', async () => {
    rpcResults.set('capture_audit_snapshot', { data: null, error: { message: 'snapshot boom' } })

    const res = await POST(req(), ctx())

    expect(res.status).toBe(500)
    // Apply must never run after a failed snapshot — there is no rollback point.
    expect(rpcCalls.some(c => c.name === 'apply_approved_audit_changes')).toBe(false)
    expect(regenerateAndUploadPlacardMock).not.toHaveBeenCalled()
  })

  it('404s when the run is not found (before any RPC)', async () => {
    state.runRow = { data: null }

    const res = await POST(req(), ctx())

    expect(res.status).toBe(404)
    expect(rpcCalls).toHaveLength(0)
  })

  it('returns the gate status when the admin gate rejects', async () => {
    requireTenantAdminMock.mockResolvedValue({ ok: false, status: 403, message: 'Tenant admin or owner required' })

    const res = await POST(req(), ctx())

    expect(res.status).toBe(403)
    expect(rpcCalls).toHaveLength(0)
  })
})

describe('POST /api/admin/loto/audit/[runId]/apply — placard regeneration', () => {
  beforeEach(() => {
    rpcResults.set('capture_audit_snapshot', { data: 'snap-1', error: null })
    rpcResults.set('apply_approved_audit_changes', { data: 2, error: null })
  })

  it('regenerates placards once per affected equipment with a placard-affecting change', async () => {
    state.appliedChanges = [
      { equipment_id: 'EQ-1', change_kind: 'placeholder_photo' },
      { equipment_id: 'EQ-2', change_kind: 'step_field_edit' },
    ]

    const res = await POST(req(), ctx())

    expect(res.status).toBe(200)
    expect(regenerateAndUploadPlacardMock).toHaveBeenCalledTimes(2)
    const equipmentIds = regenerateAndUploadPlacardMock.mock.calls.map(c => c[2])
    expect(equipmentIds).toEqual(expect.arrayContaining(['EQ-1', 'EQ-2']))
    // Called with the admin client + tenant id from the gate.
    expect(regenerateAndUploadPlacardMock.mock.calls[0]![1]).toBe(TENANT_ID)
  })

  it('deduplicates equipment that has multiple placard-affecting changes', async () => {
    state.appliedChanges = [
      { equipment_id: 'EQ-1', change_kind: 'placeholder_photo' },
      { equipment_id: 'EQ-1', change_kind: 'equipment_field_edit' },
    ]

    await POST(req(), ctx())

    expect(regenerateAndUploadPlacardMock).toHaveBeenCalledTimes(1)
    expect(regenerateAndUploadPlacardMock.mock.calls[0]![2]).toBe('EQ-1')
  })

  it('skips equipment whose only applied change does not affect the placard', async () => {
    // ehs_finding is informational — it does not change printed content.
    state.appliedChanges = [
      { equipment_id: 'EQ-1', change_kind: 'ehs_finding' },
      { equipment_id: 'EQ-2', change_kind: 'step_confidence' },
    ]

    await POST(req(), ctx())

    expect(regenerateAndUploadPlacardMock).not.toHaveBeenCalled()
  })

  it('still returns 200 when a single placard regeneration throws (error-isolated)', async () => {
    state.appliedChanges = [
      { equipment_id: 'EQ-1', change_kind: 'placeholder_photo' },
      { equipment_id: 'EQ-2', change_kind: 'step_field_edit' },
    ]
    regenerateAndUploadPlacardMock
      .mockRejectedValueOnce(new Error('pdf render boom'))
      .mockResolvedValueOnce({ placardUrl: 'https://cdn/p2.pdf?v=1' })

    const res = await POST(req(), ctx())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.placards_regenerated).toEqual({ ok: 1, failed: 1 })
  })
})
