import { describe, it, expect, vi, beforeEach } from 'vitest'

// Engine test for researchSeedBatch. We mock the AI seam (getAnthropic +
// discoverSds + logging) and a table-aware Supabase stub so we can assert the
// write decisions: a discover HIT inserts a global library row and marks the
// item 'found'; a MISS marks 'not_found' without inserting; guard clauses
// (missing run, empty batch) behave.

let adminClient: { from: (t: string) => unknown }
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => adminClient }))

const getAnthropic = vi.fn(async () => ({}))
vi.mock('@/lib/ai/client', () => ({
  getAnthropic: () => getAnthropic(),
  AnthropicNotConfiguredError: class extends Error {},
}))

const discoverSds = vi.fn()
vi.mock('@/lib/ai/discoverSds', () => ({ discoverSds: (...a: unknown[]) => discoverSds(...a) }))

vi.mock('@/lib/ai/rateLimit', () => ({ logAiInvocation: vi.fn(async () => {}) }))

import { researchSeedBatch } from '@/lib/sdsLibrarySeed'

// ── table-aware chainable Supabase mock ───────────────────────────────────
interface Call { table: string; ops: string[]; selectArg?: unknown; selectOpts?: { count?: string }; payload?: Record<string, unknown>; ilikeArg?: unknown }
type Result = { data?: unknown; error?: unknown; count?: number }

function makeAdmin(handler: (c: Call) => Result) {
  const calls: Call[] = []
  function from(table: string) {
    const ctx: Call = { table, ops: [] }
    const resolve = () => { calls.push(ctx); return handler(ctx) }
    const b: Record<string, unknown> = {}
    const passthrough = (name: string) => (...args: unknown[]) => {
      ctx.ops.push(name)
      if (name === 'select') { ctx.selectArg = args[0]; ctx.selectOpts = args[1] as { count?: string } }
      if (name === 'insert' || name === 'update' || name === 'upsert') ctx.payload = args[0] as Record<string, unknown>
      if (name === 'ilike') ctx.ilikeArg = args[1]
      return b
    }
    for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'upsert', 'ilike', 'in', 'lt', 'gte']) b[m] = passthrough(m)
    b.maybeSingle = async () => { ctx.ops.push('maybeSingle'); return resolve() }
    b.single = async () => { ctx.ops.push('single'); return resolve() }
    b.then = (res: (v: Result) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(resolve).then(res, rej)
    return b
  }
  return { client: { from }, calls }
}

const ITEM = { id: 'i1', proposed_name: 'Acetone', proposed_cas: '67-64-1', proposed_manufacturer: 'Fisher', attempts: 0 }
const RUN  = { id: 'r1', status: 'researching', created_by: 'u1' }
const CANDIDATE = {
  url: 'https://fishersci.com/acetone.pdf', title: 'Acetone SDS', manufacturer: 'Fisher',
  productName: 'Acetone', revisionDate: '2025-01-01', confidence: 'high', reasonsItMatches: 'exact',
}

// Handler for a one-item run: batch returns [ITEM], finalize sees the item
// terminal, count returns 0. `finalStatus` is what the item ends up as.
function oneItemHandler(finalStatus: string) {
  return (c: Call): Result => {
    if (c.table === 'sds_library_seed_runs') {
      return c.ops.includes('update') ? {} : { data: RUN }
    }
    if (c.table === 'sds_library_seed_items') {
      if (c.ops.includes('update')) return {}
      if (c.ops.includes('limit')) return { data: [ITEM] }
      if (c.selectArg === 'status') return { data: [{ status: finalStatus }] }
      if (c.selectOpts?.count) return { count: 0 }
      return {}
    }
    if (c.table === 'sds_library_chemicals') return { data: { id: 'chem-1' } }
    if (c.table === 'sds_library_sources') return {}
    return {}
  }
}

beforeEach(() => {
  getAnthropic.mockClear()
  discoverSds.mockReset()
})

describe('researchSeedBatch', () => {
  it('throws when the run does not exist', async () => {
    adminClient = makeAdmin(() => ({ data: null })).client
    await expect(researchSeedBatch({ seedRunId: 'missing', max: 10 })).rejects.toThrow('Seed run not found')
  })

  it('no-ops on an empty approved batch and reports completion', async () => {
    adminClient = makeAdmin((c) => {
      if (c.table === 'sds_library_seed_runs') return c.ops.includes('update') ? {} : { data: RUN }
      return { data: [] } // empty batch + empty finalize tally
    }).client
    const result = await researchSeedBatch({ seedRunId: 'r1', max: 10 })
    expect(result).toMatchObject({ processed: 0, found: 0, notFound: 0, completed: true })
    expect(getAnthropic).not.toHaveBeenCalled()
  })

  it('writes a library row and marks the item found on a discovery hit', async () => {
    discoverSds.mockResolvedValue({ candidates: [CANDIDATE], usage: { inputTokens: 5, outputTokens: 5 } })
    const { client, calls } = makeAdmin(oneItemHandler('found'))
    adminClient = client

    const result = await researchSeedBatch({ seedRunId: 'r1', max: 10 })

    expect(result).toMatchObject({ processed: 1, found: 1, notFound: 0 })
    // A global library row was inserted...
    const insert = calls.find(c => c.table === 'sds_library_chemicals' && c.ops.includes('insert'))
    expect(insert?.payload).toMatchObject({
      canonical_name: 'Acetone', source_url: CANDIDATE.url, source_host: 'fishersci.com', review_status: 'pending',
    })
    // ...candidate sources were recorded...
    expect(calls.some(c => c.table === 'sds_library_sources' && c.ops.includes('upsert'))).toBe(true)
    // ...and the item was marked 'found'.
    expect(calls.some(c =>
      c.table === 'sds_library_seed_items' && c.ops.includes('update') && c.payload?.status === 'found',
    )).toBe(true)
  })

  it('marks the item not_found and inserts nothing when discovery returns no candidates', async () => {
    discoverSds.mockResolvedValue({ candidates: [], usage: { inputTokens: 1, outputTokens: 1 } })
    const { client, calls } = makeAdmin(oneItemHandler('not_found'))
    adminClient = client

    const result = await researchSeedBatch({ seedRunId: 'r1', max: 10 })

    expect(result).toMatchObject({ processed: 1, found: 0, notFound: 1 })
    expect(calls.some(c => c.table === 'sds_library_chemicals')).toBe(false)
    expect(calls.some(c =>
      c.table === 'sds_library_seed_items' && c.ops.includes('update') && c.payload?.status === 'not_found',
    )).toBe(true)
  })

  it('reclaims stale researching items before selecting the batch', async () => {
    discoverSds.mockResolvedValue({ candidates: [], usage: { inputTokens: 1, outputTokens: 1 } })
    const { client, calls } = makeAdmin(oneItemHandler('not_found'))
    adminClient = client

    await researchSeedBatch({ seedRunId: 'r1', max: 10 })

    // Two stale-lease reclaims run up front — both bound by lt(last_attempt_at):
    // remaining retries go back to 'approved', exhausted ones to 'error' so the
    // run can still complete.
    const reclaims = calls.filter(c =>
      c.table === 'sds_library_seed_items' && c.ops.includes('update') && c.ops.includes('lt'))
    expect(reclaims.some(c => c.payload?.status === 'approved')).toBe(true)
    expect(reclaims.some(c => c.payload?.status === 'error')).toBe(true)
  })

  it('reuses the row matching the inserted manufacturer on collision, with ilike wildcards escaped', async () => {
    // The best candidate's manufacturer differs from the proposed one, and the
    // name carries a LIKE wildcard. The insert collides on the identity index;
    // the lookup must match the manufacturer we actually wrote ('Acme'), not the
    // proposed 'Fisher', and must not let the '%' act as a wildcard.
    const candidate = { ...CANDIDATE, manufacturer: 'Acme', url: 'https://acme.example/p.pdf' }
    discoverSds.mockResolvedValue({ candidates: [candidate], usage: { inputTokens: 1, outputTokens: 1 } })
    const item = { ...ITEM, proposed_name: 'Acetone 5%', proposed_manufacturer: 'Fisher' }
    const fisherRow = { id: 'fisher-row', canonical_name: item.proposed_name, manufacturer: 'Fisher', cas_primary: item.proposed_cas }
    const acmeRow   = { id: 'acme-row',   canonical_name: item.proposed_name, manufacturer: 'Acme',   cas_primary: item.proposed_cas }

    const { client, calls } = makeAdmin((c) => {
      if (c.table === 'sds_library_seed_runs') return c.ops.includes('update') ? {} : { data: RUN }
      if (c.table === 'sds_library_seed_items') {
        if (c.ops.includes('update')) return {}
        if (c.ops.includes('limit')) return { data: [item] }
        if (c.selectArg === 'status') return { data: [{ status: 'found' }] }
        if (c.selectOpts?.count) return { count: 0 }
        return {}
      }
      if (c.table === 'sds_library_chemicals') {
        if (c.ops.includes('insert')) return { error: { code: '23505', message: 'dup identity' } }
        return { data: [fisherRow, acmeRow] } // findExistingChemical lookup
      }
      return {} // sds_library_sources
    })
    adminClient = client

    const result = await researchSeedBatch({ seedRunId: 'r1', max: 10 })
    expect(result).toMatchObject({ processed: 1, found: 1 })

    // #3: sources attach to the manufacturer we inserted ('Acme'), not 'Fisher'.
    const upsert = calls.find(c => c.table === 'sds_library_sources' && c.ops.includes('upsert'))
    const sourceRows = upsert?.payload as unknown as Array<{ chemical_id: string }>
    expect(sourceRows[0].chemical_id).toBe('acme-row')

    // #4: the name's '%' is escaped before reaching ilike.
    const lookup = calls.find(c => c.table === 'sds_library_chemicals' && c.ops.includes('ilike'))
    expect(lookup?.ilikeArg).toBe('Acetone 5\\%')
  })
})
