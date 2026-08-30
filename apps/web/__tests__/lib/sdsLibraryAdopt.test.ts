import { describe, it, expect, vi, beforeEach } from 'vitest'

// Engine test for adoptLibraryChemical. Mocks supabaseAdmin (table-aware) and
// the shared persistFetchedSds, asserting the adopt decisions: approved entry →
// product insert + SDS fetch; not-approved / banned → refused; fetch failure →
// product flagged sds_fetch_pending; duplicate → returned untouched.

let adminClient: { from: (t: string) => unknown; rpc: (n: string, p: unknown) => Promise<unknown> }
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => adminClient }))

const persistFetchedSds = vi.fn()
vi.mock('@/lib/chemicalSdsPersist', () => ({ persistFetchedSds: (...a: unknown[]) => persistFetchedSds(...a) }))

import { adoptLibraryChemical } from '@/lib/sdsLibraryAdopt'

interface Call { table: string; ops: string[]; selectArg?: unknown; payload?: Record<string, unknown> }
type Result = { data?: unknown; error?: unknown }

function makeAdmin(opts: {
  library: Record<string, unknown> | null
  existingProducts?: Record<string, unknown>[]
  restrictedHits?: Array<{ severity: string }>
  insertedProduct?: Record<string, unknown>
}) {
  const calls: Call[] = []
  const handler = (c: Call): Result => {
    if (c.table === 'sds_library_chemicals') return { data: opts.library }
    if (c.table === 'chemical_products') {
      if (c.ops.includes('insert')) return { data: opts.insertedProduct ?? { id: 'prod-1' } }
      if (c.ops.includes('update')) return {}
      return { data: opts.existingProducts ?? [] } // dedupe select
    }
    return {}
  }
  function from(table: string) {
    const ctx: Call = { table, ops: [] }
    const resolve = () => { calls.push(ctx); return handler(ctx) }
    const b: Record<string, unknown> = {}
    const passthrough = (name: string) => (...args: unknown[]) => {
      ctx.ops.push(name)
      if (name === 'select') ctx.selectArg = args[0]
      if (name === 'insert' || name === 'update') ctx.payload = args[0] as Record<string, unknown>
      return b
    }
    for (const m of ['select', 'eq', 'is', 'ilike', 'order', 'limit', 'insert', 'update']) b[m] = passthrough(m)
    b.maybeSingle = async () => { ctx.ops.push('maybeSingle'); return resolve() }
    b.single = async () => { ctx.ops.push('single'); return resolve() }
    b.then = (res: (v: Result) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(resolve).then(res, rej)
    return b
  }
  const rpc = async (name: string, payload: unknown) => {
    calls.push({ table: '__rpc__', ops: ['rpc'], payload: payload as Record<string, unknown> })
    return { data: opts.restrictedHits ?? [], error: null }
  }
  return { client: { from, rpc }, calls }
}

const APPROVED = {
  id: 'lib-1', canonical_name: 'Acetone', manufacturer: 'Fisher', product_code: 'A18-4',
  cas_primary: '67-64-1', cas_numbers: ['67-64-1'], synonyms: ['propanone'],
  physical_state: 'liquid', ghs_pictograms: ['GHS02'], ghs_signal_word: 'danger',
  hazard_statements: null, precautionary_statements: null,
  nfpa_health: 1, nfpa_flammability: 3, nfpa_instability: 0, nfpa_special: null,
  ppe_required: [], flash_point_c: -17, boiling_point_c: 56, storage_class: null,
  incompatibilities: [], sds_revision_date: '2025-01-01',
  source_url: 'https://fishersci.com/acetone.pdf', review_status: 'approved',
}

beforeEach(() => { persistFetchedSds.mockReset() })

describe('adoptLibraryChemical', () => {
  it('404s when the library entry does not exist', async () => {
    adminClient = makeAdmin({ library: null }).client
    const r = await adoptLibraryChemical({ tenantId: 't1', userId: 'u1', libraryId: 'x', overrideRestricted: false })
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it('409s when the entry is not approved', async () => {
    adminClient = makeAdmin({ library: { ...APPROVED, review_status: 'pending' } }).client
    const r = await adoptLibraryChemical({ tenantId: 't1', userId: 'u1', libraryId: 'lib-1', overrideRestricted: false })
    expect(r).toMatchObject({ ok: false, status: 409 })
  })

  it('refuses a banned chemical with 409', async () => {
    adminClient = makeAdmin({ library: APPROVED, restrictedHits: [{ severity: 'banned' }] }).client
    const r = await adoptLibraryChemical({ tenantId: 't1', userId: 'u1', libraryId: 'lib-1', overrideRestricted: false })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(persistFetchedSds).not.toHaveBeenCalled()
  })

  it('requires override on a restricted chemical', async () => {
    adminClient = makeAdmin({ library: APPROVED, restrictedHits: [{ severity: 'restricted' }] }).client
    const r = await adoptLibraryChemical({ tenantId: 't1', userId: 'u1', libraryId: 'lib-1', overrideRestricted: false })
    expect(r).toMatchObject({ ok: false, status: 409, requiresOverride: true })
  })

  it('inserts the product and fetches the SDS on the happy path', async () => {
    persistFetchedSds.mockResolvedValue({ ok: true, sds: { id: 'sds-1' }, deduped: false, finalUrl: APPROVED.source_url })
    const { client, calls } = makeAdmin({ library: APPROVED, insertedProduct: { id: 'prod-9' } })
    adminClient = client

    const r = await adoptLibraryChemical({ tenantId: 't1', userId: 'u1', libraryId: 'lib-1', overrideRestricted: false })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.deduped).toBe(false)
      expect(r.sds).toEqual({ id: 'sds-1' })
      expect(r.product).toMatchObject({ id: 'prod-9' })
    }
    expect(calls.some(c => c.table === 'chemical_products' && c.ops.includes('insert'))).toBe(true)
    expect(persistFetchedSds).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', productId: 'prod-9', url: APPROVED.source_url }),
    )
  })

  it('flags sds_fetch_pending when the SDS fetch fails', async () => {
    persistFetchedSds.mockResolvedValue({ ok: false, outcome: 'http_error' })
    const { client, calls } = makeAdmin({ library: APPROVED, insertedProduct: { id: 'prod-9' } })
    adminClient = client

    const r = await adoptLibraryChemical({ tenantId: 't1', userId: 'u1', libraryId: 'lib-1', overrideRestricted: false })

    expect(r).toMatchObject({ ok: true, sdsFetchPending: true, sdsFetchOutcome: 'http_error' })
    expect(calls.some(c =>
      c.table === 'chemical_products' && c.ops.includes('update') && c.payload?.sds_fetch_pending === true,
    )).toBe(true)
  })

  it('returns the existing product (deduped) without inserting', async () => {
    const { client, calls } = makeAdmin({
      library: APPROVED,
      existingProducts: [{ id: 'prod-existing', name: 'Acetone', manufacturer: 'Fisher' }],
    })
    adminClient = client

    const r = await adoptLibraryChemical({ tenantId: 't1', userId: 'u1', libraryId: 'lib-1', overrideRestricted: false })

    expect(r).toMatchObject({ ok: true, deduped: true })
    if (r.ok) expect(r.product).toMatchObject({ id: 'prod-existing' })
    expect(calls.some(c => c.table === 'chemical_products' && c.ops.includes('insert'))).toBe(false)
    expect(persistFetchedSds).not.toHaveBeenCalled()
  })
})
