import { describe, it, expect, vi, beforeEach } from 'vitest'

// retrieveContext + formatChunks tests. The Voyage embed call and the
// supabase RPC are both mocked; we pin the contract that retrieve
// degrades to an empty result on every recoverable failure path
// (Voyage missing/error, RPC error, empty matches) and that the
// formatted context block is structured as expected on the happy path.

const embedMock = vi.fn()
const rpcMock   = vi.fn()

vi.mock('@/lib/ai/embeddings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/embeddings')>('@/lib/ai/embeddings')
  return {
    ...actual,
    embed: (a: unknown) => embedMock(a),
  }
})

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({ rpc: (name: string, params: unknown) => rpcMock(name, params) }),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb:    vi.fn(),
}))

import { retrieveContext, formatChunks } from '@/lib/ai/rag'
import { VoyageNotConfiguredError } from '@/lib/ai/embeddings'

beforeEach(() => {
  embedMock.mockReset()
  rpcMock.mockReset()
})

const happyEmbed = { embeddings: [Array(1024).fill(0.1)], totalTokens: 7 }

const happyChunk = {
  chunk_id:       'c-1',
  document_id:    'd-1',
  chunk_index:    0,
  text:           'The energy-isolation procedure must include verification.',
  metadata:       { section: '1910.147(c)(4)' },
  source_type:    'regulation' as const,
  title:          '29 CFR 1910.147',
  jurisdiction:   'federal',
  effective_date: null,
  source_url:     'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147',
  doc_tenant_id:  null,
  similarity:     0.91,
}

describe('retrieveContext', () => {
  it('returns empty result for blank query', async () => {
    const r = await retrieveContext({ query: '   ', tenantId: 'tenant-1' })
    expect(r.chunks).toEqual([])
    expect(r.contextBlock).toBe('')
    expect(embedMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('degrades gracefully when Voyage is not configured', async () => {
    embedMock.mockRejectedValue(new VoyageNotConfiguredError())
    const r = await retrieveContext({ query: 'lockout', tenantId: 'tenant-1' })
    expect(r.chunks).toEqual([])
    expect(r.contextBlock).toBe('')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('degrades gracefully on a Voyage upstream error', async () => {
    embedMock.mockRejectedValue(new Error('voyage 503'))
    const r = await retrieveContext({ query: 'lockout', tenantId: 'tenant-1' })
    expect(r.chunks).toEqual([])
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('degrades gracefully when the supabase RPC errors', async () => {
    embedMock.mockResolvedValue(happyEmbed)
    rpcMock.mockResolvedValue({ data: null, error: { message: 'connection refused' } })
    const r = await retrieveContext({ query: 'lockout', tenantId: 'tenant-1' })
    expect(r.chunks).toEqual([])
    expect(r.contextBlock).toBe('')
    // Voyage tokens still surface so the route can include them in usage.
    expect(r.voyageTokens).toBe(7)
  })

  it('returns empty contextBlock when RPC returns no matches', async () => {
    embedMock.mockResolvedValue(happyEmbed)
    rpcMock.mockResolvedValue({ data: [], error: null })
    const r = await retrieveContext({ query: 'lockout', tenantId: 'tenant-1' })
    expect(r.chunks).toEqual([])
    expect(r.contextBlock).toBe('')
  })

  it('builds a formatted contextBlock on the happy path', async () => {
    embedMock.mockResolvedValue(happyEmbed)
    rpcMock.mockResolvedValue({ data: [happyChunk], error: null })
    const r = await retrieveContext({ query: 'energy isolation', tenantId: 'tenant-1' })
    expect(r.chunks.length).toBe(1)
    expect(r.contextBlock).toContain('<retrieved_context>')
    expect(r.contextBlock).toContain('title="29 CFR 1910.147"')
    expect(r.contextBlock).toContain('source="regulation"')
    expect(r.contextBlock).toContain('jurisdiction="federal"')
    expect(r.contextBlock).toContain('cite=')
    expect(r.contextBlock).toContain(happyChunk.text)
  })

  it('passes source filter + tenant filter to the RPC', async () => {
    embedMock.mockResolvedValue(happyEmbed)
    rpcMock.mockResolvedValue({ data: [], error: null })
    await retrieveContext({
      query:    'pump',
      tenantId: 'tenant-1',
      k:        5,
      sources:  ['regulation', 'epa'],
    })
    expect(rpcMock).toHaveBeenCalledWith('match_knowledge_chunks', expect.objectContaining({
      match_count:   5,
      source_filter: ['regulation', 'epa'],
      tenant_filter: 'tenant-1',
    }))
  })
})

describe('formatChunks', () => {
  it('renders an empty corpus deterministically', () => {
    const out = formatChunks([])
    expect(out).toBe('<retrieved_context>\n</retrieved_context>')
  })

  it('builds a well-formed company_policy citation tag', () => {
    const out = formatChunks([{
      ...happyChunk,
      source_type: 'company_policy',
      title:       'Acme LOTO Procedure',
      metadata:    { section: '3.2' },
    }])
    expect(out).toContain('cite="[Acme LOTO Procedure §3.2]"')
  })

  it('uses spacing for regulation citations even with section metadata', () => {
    const out = formatChunks([happyChunk])
    expect(out).toContain('cite="[29 CFR 1910.147 § 1910.147(c)(4)]"')
  })
})
