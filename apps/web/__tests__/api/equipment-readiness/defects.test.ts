import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PATCH } from '@/app/api/equipment-readiness/defects/[id]/route'

interface ChainResult {
  data?: unknown
  error?: { message: string; code?: string } | null
  count?: number
}

const { requireTenantAdminMock, mockState } = vi.hoisted(() => {
  class MockChainState {
    queues = new Map<string, ChainResult[]>()
    inserts: Array<{ table: string; payload: unknown }> = []
    updates: Array<{ table: string; payload: unknown }> = []

    queue(table: string, ...results: ChainResult[]) {
      if (!this.queues.has(table)) this.queues.set(table, [])
      this.queues.get(table)!.push(...results)
    }

    next(table: string): ChainResult {
      return this.queues.get(table)?.shift() ?? { data: null, error: null }
    }

    buildAdmin() {
      const tableProxy = (table: string) => {
        const result = () => Promise.resolve(this.next(table))
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          neq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          single: result,
          maybeSingle: result,
          insert: (payload: unknown) => { this.inserts.push({ table, payload }); return chain },
          update: (payload: unknown) => { this.updates.push({ table, payload }); return chain },
          then: (onFulfilled: (value: ChainResult) => unknown) => Promise.resolve(this.next(table)).then(onFulfilled),
        }
        return chain
      }
      return { from: (table: string) => tableProxy(table) }
    }
  }

  return {
    requireTenantAdminMock: vi.fn(),
    mockState: new MockChainState(),
  }
})

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin: (req: Request) => requireTenantAdminMock(req),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => mockState.buildAdmin(),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

const DEFECT_ID = '11111111-1111-1111-1111-111111111111'

function jsonRequest(body: unknown) {
  return new Request('http://x/api/equipment-readiness/defects/' + DEFECT_ID, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify(body),
  })
}

function ctxFor(id = DEFECT_ID) {
  return { params: Promise.resolve({ id }) }
}

function seedGate() {
  requireTenantAdminMock.mockResolvedValue({
    ok: true,
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'admin',
  })
}

function seedDefect(openCritical: unknown[]) {
  mockState.queue(
    'equipment_defects',
    {
      data: {
        id: DEFECT_ID,
        tenant_id: 'tenant-1',
        equipment_record_id: 'equipment-1',
        status: 'in_repair',
        severity: 'critical',
        out_of_service: true,
        description: 'Fork carriage crack',
      },
      error: null,
    },
    { data: null, error: null },
    { data: openCritical, error: null },
  )
}

describe('PATCH /api/equipment-readiness/defects/[id]', () => {
  beforeEach(() => {
    requireTenantAdminMock.mockReset()
    mockState.queues = new Map()
    mockState.inserts.length = 0
    mockState.updates.length = 0
    seedGate()
  })

  it('requires a tenant admin gate', async () => {
    requireTenantAdminMock.mockResolvedValue({ ok: false, status: 403, message: 'Admin only' })

    const response = await PATCH(jsonRequest({ action: 'acknowledge' }), ctxFor())

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Admin only' })
  })

  it('does not release equipment while another out-of-service defect remains', async () => {
    seedDefect([{ id: 'other-defect' }])
    mockState.queue('equipment_repairs', { data: [{ id: 'repair-1' }], error: null }, { data: null, error: null })
    mockState.queue('equipment_evidence', { data: null, error: null })

    const response = await PATCH(jsonRequest({
      action: 'return_to_service',
      notes: 'Hydraulic hose replaced and function checked.',
      evidence: [{ storage_path: 'tenant-1/defects/repair.jpg', caption: 'After repair' }],
    }), ctxFor())

    expect(response.status).toBe(200)
    expect(mockState.updates.some(row => row.table === 'loto_equipment')).toBe(false)
    expect(mockState.inserts.some(row => row.table === 'equipment_evidence')).toBe(true)
  })

  it('releases equipment when the resolved defect is the only out-of-service finding', async () => {
    seedDefect([])
    mockState.queue('loto_equipment', { data: null, error: null })
    mockState.queue('equipment_repairs', { data: [{ id: 'repair-1' }], error: null }, { data: null, error: null })

    const response = await PATCH(jsonRequest({
      action: 'return_to_service',
      notes: 'Guard repaired and verified operational.',
    }), ctxFor())

    expect(response.status).toBe(200)
    expect(mockState.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'loto_equipment',
        payload: expect.objectContaining({ readiness_status: 'available' }),
      }),
    ]))
  })
})
