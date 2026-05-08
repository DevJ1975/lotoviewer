import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  embed,
  vectorLiteral,
  VoyageNotConfiguredError,
  VoyageApiError,
  EMBEDDING_DIMS,
} from '@/lib/ai/embeddings'

// Voyage embeddings tests. The fetch call is mocked at the global level.

const ORIGINAL_KEY = process.env.VOYAGE_API_KEY
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  // @ts-expect-error - global fetch override for tests
  global.fetch = fetchMock
  process.env.VOYAGE_API_KEY = 'voyage-test-key'
})
afterEach(() => {
  process.env.VOYAGE_API_KEY = ORIGINAL_KEY
})

function fakeEmbedding(): number[] {
  return Array(EMBEDDING_DIMS).fill(0.1)
}

describe('embed', () => {
  it('throws VoyageNotConfiguredError when the env key is missing', async () => {
    delete process.env.VOYAGE_API_KEY
    await expect(embed({ texts: ['hi'], inputType: 'query' })).rejects.toBeInstanceOf(VoyageNotConfiguredError)
  })

  it('returns empty result when no inputs', async () => {
    const r = await embed({ texts: [], inputType: 'query' })
    expect(r.embeddings).toEqual([])
    expect(r.totalTokens).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('happy path: one batch, embeddings sorted by index', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        // Returned out of order to verify sorting.
        data: [
          { embedding: fakeEmbedding(), index: 1, object: 'embedding' },
          { embedding: fakeEmbedding().map(() => 0.2), index: 0, object: 'embedding' },
        ],
        usage: { total_tokens: 14 },
      }),
    })
    const r = await embed({ texts: ['a', 'b'], inputType: 'document' })
    expect(r.embeddings.length).toBe(2)
    // index 0 came back as the 0.2 embedding — should be first after sort.
    expect(r.embeddings[0][0]).toBe(0.2)
    expect(r.embeddings[1][0]).toBe(0.1)
    expect(r.totalTokens).toBe(14)
  })

  it('throws VoyageApiError on a non-OK response', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 503, json: async () => ({ detail: 'overloaded' }),
    })
    await expect(embed({ texts: ['x'], inputType: 'query' })).rejects.toBeInstanceOf(VoyageApiError)
  })

  it('throws on a wrong-dimension embedding to catch a model mismatch fast', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3], index: 0, object: 'embedding' }],
        usage: { total_tokens: 1 },
      }),
    })
    await expect(embed({ texts: ['x'], inputType: 'query' })).rejects.toBeInstanceOf(VoyageApiError)
  })

  it('batches large input into multiple fetch calls', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: Array(128).fill(0).map((_, i) => ({
          embedding: fakeEmbedding(),
          index: i,
          object: 'embedding',
        })),
        usage: { total_tokens: 100 },
      }),
    })
    // 200 inputs = ceil(200/128) = 2 batches
    const r = await embed({ texts: Array(200).fill('x'), inputType: 'document' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(r.embeddings.length).toBe(128 + 128)  // mock returns 128 each call
    expect(r.totalTokens).toBe(200)
  })

  it('uses input_type=query for query calls (Voyage asymmetric encoding)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: fakeEmbedding(), index: 0, object: 'embedding' }],
        usage: { total_tokens: 1 },
      }),
    })
    await embed({ texts: ['lockout'], inputType: 'query' })
    const call = fetchMock.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.input_type).toBe('query')
  })
})

describe('vectorLiteral', () => {
  it('renders a Postgres vector literal', () => {
    const v = Array(EMBEDDING_DIMS).fill(0).map((_, i) => i / EMBEDDING_DIMS)
    const lit = vectorLiteral(v)
    expect(lit.startsWith('[')).toBe(true)
    expect(lit.endsWith(']')).toBe(true)
    // First and last numeric values appear.
    expect(lit).toContain('0,')
    expect(lit).toContain(((EMBEDDING_DIMS - 1) / EMBEDDING_DIMS).toString())
  })

  it('throws on wrong dimension to catch a model swap that forgot the migration', () => {
    expect(() => vectorLiteral([0.1, 0.2, 0.3])).toThrow(/expected 1024 dims/)
  })
})
