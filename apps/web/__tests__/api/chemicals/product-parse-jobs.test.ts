// GET /api/chemicals/products/[id] — background parse status on each SDS.
//
// The page shows "parsing in background" / "background parse failed" from the
// latest sds_parse_jobs row per SDS. That table (migration 294) is applied by
// hand, so the route must still load the product before it exists — but only
// a schema-missing error may be shrugged off; anything else is a real failure.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const PRODUCT_ID = '00000000-0000-0000-0000-0000000000aa'

let jobsResult: { data: unknown[] | null; error: { code?: string; message: string } | null }

const REVISIONS = [
  { id: 'sds-new', parse_model: null },
  { id: 'sds-old', parse_model: 'claude' },
]

function query(result: unknown) {
  // Every builder step returns the same chainable, awaitable object.
  const chain: Record<string, unknown> = {}
  for (const step of ['select', 'eq', 'in', 'order']) chain[step] = () => chain
  chain.maybeSingle = async () => result
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return chain
}

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({}) }))

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: async () => ({
    ok: true, userId: 'user-1', tenantId: 'tenant-1',
    authedClient: {
      from: (table: string) => {
        if (table === 'chemical_products') return query({ data: { id: PRODUCT_ID }, error: null })
        if (table === 'chemical_sds_documents') return query({ data: REVISIONS, error: null })
        if (table === 'sds_parse_jobs') return query(jobsResult)
        throw new Error(`unexpected table ${table}`)
      },
    },
  }),
}))

async function getProduct(): Promise<Response> {
  const { GET } = await import('@/app/api/chemicals/products/[id]/route')
  return GET(new Request(`http://x/api/chemicals/products/${PRODUCT_ID}`), { params: Promise.resolve({ id: PRODUCT_ID }) })
}

beforeEach(() => {
  jobsResult = { data: [], error: null }
})

describe('GET /api/chemicals/products/[id] — background parse jobs', () => {
  it('attaches the LATEST job to each SDS, and null where none was queued', async () => {
    // Rows arrive newest-first (the route orders by created_at desc).
    jobsResult = {
      data: [
        { sds_id: 'sds-new', status: 'failed',  last_error: 'scan is blank', created_at: '2026-10-02T00:00:00Z' },
        { sds_id: 'sds-new', status: 'running', last_error: null,            created_at: '2026-10-01T00:00:00Z' },
      ],
      error: null,
    }

    const res = await getProduct()
    expect(res.status).toBe(200)
    const { revisions } = await res.json()
    expect(revisions[0].parse_job).toEqual({ status: 'failed', last_error: 'scan is blank', created_at: '2026-10-02T00:00:00Z' })
    expect(revisions[1].parse_job).toBeNull()
  })

  it('still loads the product before migration 294 is applied', async () => {
    jobsResult = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.sds_parse_jobs'" } }

    const res = await getProduct()
    expect(res.status).toBe(200)
    const { revisions } = await res.json()
    expect(revisions.map((r: { parse_job: unknown }) => r.parse_job)).toEqual([null, null])
  })

  it('treats any other jobs error as a real failure', async () => {
    jobsResult = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }

    const res = await getProduct()
    expect(res.status).toBe(500)
  })
})
