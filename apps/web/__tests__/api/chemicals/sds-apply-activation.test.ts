import { describe, it, expect, beforeEach, vi } from 'vitest'

// Locks the activation contract of POST /api/chemicals/products/[id]/sds/[sdsId]/apply.
//
// A discovered (or library-adopted) SDS is deliberately NOT activated at fetch
// time — the PDF is unparsed and unreviewed. Approval is the point where it
// becomes the product's active revision. Before this was wired, active_sds_id
// stayed null forever for those flows: the product kept rendering the amber
// "No SDS" badge, the missing-SDS KPI counted it, and chemicalSdsDrift had no
// baseline hash, so every scheduled check fell through to a paid AI extraction.

const requireTenantMemberMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: (...args: unknown[]) => requireTenantMemberMock(...args),
}))

vi.mock('@soteria/core/chemicals', () => ({
  parseToProductFields:   () => ({ name: 'Acetone', sds_revision_date: '2026-01-15' }),
  collectGhsCodeWarnings: () => [],
}))

interface ChainResult { data?: unknown; error?: { message: string } | null }
const queues  = new Map<string, ChainResult[]>()
const updates: Array<{ table: string; payload: Record<string, unknown> }> = []

function queue(table: string, ...results: ChainResult[]) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table)!.push(...results)
}
function nextFor(table: string): ChainResult {
  const q = queues.get(table)
  return q && q.length ? q.shift()! : { data: null, error: null }
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const result = () => Promise.resolve(nextFor(table))
      const chain: Record<string, unknown> = {
        select:      () => chain,
        eq:          () => chain,
        update:      (payload: Record<string, unknown>) => { updates.push({ table, payload }); return chain },
        maybeSingle: result,
        single:      result,
        then: (onFulfilled: (v: ChainResult) => unknown) =>
          Promise.resolve(nextFor(table)).then(onFulfilled),
      }
      return chain
    },
  }),
}))

import { POST } from '@/app/api/chemicals/products/[id]/sds/[sdsId]/apply/route'

const TENANT  = '11111111-1111-1111-1111-111111111111'
const PRODUCT = '22222222-2222-2222-2222-222222222222'
const NEW_SDS = '33333333-3333-3333-3333-333333333333'
const OLD_SDS = '44444444-4444-4444-4444-444444444444'

const ctx = { params: Promise.resolve({ id: PRODUCT, sdsId: NEW_SDS }) }

function applyReq(): Request {
  return new Request('http://x/apply', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body:    JSON.stringify({ fields: 'all' }),
  })
}

/** Queue the two reads the route always makes before the product write. */
function seed(priorActiveSdsId: string | null) {
  queue('chemical_sds_documents', {
    data: { id: NEW_SDS, parsed_payload: { x: 1 }, parse_review_status: 'pending', product_id: PRODUCT, tenant_id: TENANT },
    error: null,
  })
  queue('chemical_products',
    { data: { active_sds_id: priorActiveSdsId }, error: null },
    { data: { id: PRODUCT, active_sds_id: priorActiveSdsId }, error: null },
  )
}

const productUpdate   = () => updates.find(u => u.table === 'chemical_products')
const sdsUpdates      = () => updates.filter(u => u.table === 'chemical_sds_documents')
const supersedeUpdate = () => sdsUpdates().find(u => 'superseded_by' in u.payload)

beforeEach(() => {
  requireTenantMemberMock.mockReset()
  requireTenantMemberMock.mockResolvedValue({
    ok: true, userId: 'user-1', userEmail: 'u@x.com', tenantId: TENANT,
    facilityId: null, role: 'member',
  })
  queues.clear()
  updates.length = 0
})

describe('POST …/sds/[sdsId]/apply — activation on approve', () => {
  it('sets active_sds_id when the product had no active revision', async () => {
    seed(null)
    const res  = await POST(applyReq(), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.activated).toBe(true)
    expect(productUpdate()?.payload.active_sds_id).toBe(NEW_SDS)
    // Nothing to supersede when there was no prior active revision.
    expect(supersedeUpdate()).toBeUndefined()
  })

  it('supersedes the prior active revision instead of deleting it', async () => {
    seed(OLD_SDS)
    const res  = await POST(applyReq(), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.activated).toBe(true)
    expect(productUpdate()?.payload.active_sds_id).toBe(NEW_SDS)

    // 1910.1020 retention: the outgoing sheet is marked, never removed.
    const sup = supersedeUpdate()
    expect(sup).toBeDefined()
    expect(sup!.payload.superseded_by).toBe(NEW_SDS)
    expect(sup!.payload.superseded_reason).toBe('Replaced by newer revision')
    expect(sup!.payload.superseded_at).toEqual(expect.any(String))
  })

  it('is a no-op for activation when the approved SDS is already active', async () => {
    seed(NEW_SDS)
    const res  = await POST(applyReq(), ctx)
    const body = await res.json()

    expect(body.activated).toBe(false)
    expect(productUpdate()?.payload).not.toHaveProperty('active_sds_id')
    expect(supersedeUpdate()).toBeUndefined()
  })

  it('still marks the parse approved', async () => {
    seed(null)
    await POST(applyReq(), ctx)
    expect(sdsUpdates().some(u => u.payload.parse_review_status === 'approved')).toBe(true)
  })

  it('omits the internal active_sds_id from the reported applied fields', async () => {
    seed(null)
    const body = await (await POST(applyReq(), ctx)).json()
    expect(body.applied).not.toContain('active_sds_id')
    expect(body.applied).not.toContain('updated_by')
    expect(body.applied).toContain('name')
  })
})
