import { describe, it, expect, vi, beforeEach } from 'vitest'

// Engine test for verifyLibraryBatch: an unchanged hash records 'ok'; a changed
// hash flips the entry to 'needs_research'; a fetch failure records the outcome.
// Mocks fetchSdsPdf + verifyPDF + a table-aware supabaseAdmin.

let adminClient: { from: (t: string) => unknown }
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => adminClient }))

const fetchSdsPdf = vi.fn()
vi.mock('@/lib/chemicalSdsFetch', () => ({ fetchSdsPdf: (...a: unknown[]) => fetchSdsPdf(...a) }))
vi.mock('@/lib/security/magicBytes', () => ({ verifyPDF: () => true }))

import { verifyLibraryBatch } from '@/lib/sdsLibraryVerify'

interface Call { table: string; ops: string[]; selectOpts?: { count?: string }; payload?: Record<string, unknown> }
type Result = { data?: unknown; count?: number }

function makeAdmin(candidates: Array<Record<string, unknown>>) {
  const calls: Call[] = []
  const handler = (c: Call): Result => {
    if (c.ops.includes('update')) return {}
    if (c.ops.includes('limit')) return { data: candidates }
    if (c.selectOpts?.count) return { count: 0 }
    return {}
  }
  function from(table: string) {
    const ctx: Call = { table, ops: [] }
    const resolve = () => { calls.push(ctx); return handler(ctx) }
    const b: Record<string, unknown> = {}
    const pass = (name: string) => (...args: unknown[]) => {
      ctx.ops.push(name)
      if (name === 'select') ctx.selectOpts = args[1] as { count?: string }
      if (name === 'update') ctx.payload = args[0] as Record<string, unknown>
      return b
    }
    for (const m of ['select', 'eq', 'not', 'or', 'order', 'limit', 'update']) b[m] = pass(m)
    b.then = (res: (v: Result) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(resolve).then(res, rej)
    return b
  }
  return { client: { from }, calls }
}

beforeEach(() => fetchSdsPdf.mockReset())

describe('verifyLibraryBatch', () => {
  it('records ok when the fetched hash is unchanged', async () => {
    fetchSdsPdf.mockResolvedValue({ outcome: 'ok', bytes: new Uint8Array([1]), sha256: 'samehash' })
    const { client, calls } = makeAdmin([{ id: 'c1', source_url: 'https://x.com/a.pdf', last_verified_fetch_hash: 'samehash' }])
    adminClient = client
    const r = await verifyLibraryBatch({ max: 10 })
    expect(r).toMatchObject({ checked: 1, unchanged: 1, changed: 0, failed: 0 })
    const update = calls.find(c => c.ops.includes('update'))
    expect(update?.payload).toMatchObject({ last_verify_outcome: 'ok' })
    expect(update?.payload).not.toHaveProperty('review_status')
  })

  it('flags needs_research when the manufacturer hash changed', async () => {
    fetchSdsPdf.mockResolvedValue({ outcome: 'ok', bytes: new Uint8Array([1]), sha256: 'newhash' })
    const { client, calls } = makeAdmin([{ id: 'c1', source_url: 'https://x.com/a.pdf', last_verified_fetch_hash: 'oldhash' }])
    adminClient = client
    const r = await verifyLibraryBatch({ max: 10 })
    expect(r).toMatchObject({ checked: 1, changed: 1, unchanged: 0 })
    const update = calls.find(c => c.ops.includes('update'))
    expect(update?.payload).toMatchObject({ last_verify_outcome: 'changed', review_status: 'needs_research' })
  })

  it('records the fetch outcome on failure', async () => {
    fetchSdsPdf.mockResolvedValue({ outcome: 'http_error' })
    const { client, calls } = makeAdmin([{ id: 'c1', source_url: 'https://x.com/a.pdf', last_verified_fetch_hash: null }])
    adminClient = client
    const r = await verifyLibraryBatch({ max: 10 })
    expect(r).toMatchObject({ checked: 1, failed: 1 })
    const update = calls.find(c => c.ops.includes('update'))
    expect(update?.payload).toMatchObject({ last_verify_outcome: 'http_error' })
  })
})
