import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mocks must be declared before the import-under-test so vi.mock
// hoisting catches them.

interface MockState {
  inserts:               Array<{ table: string; rows: unknown }>
  deletes:               Array<{ table: string; filters: Record<string, unknown> }>
  insertedDocId:         string
  insertShouldFail:      boolean | string
  chunkInsertShouldFail: boolean | string
}

const mockCalls: MockState = {
  inserts:               [],
  deletes:               [],
  insertedDocId:         'doc-uuid-1',
  insertShouldFail:      false,
  chunkInsertShouldFail: false,
}

vi.mock('@/lib/supabaseAdmin', () => {
  function makeBuilder(table: string): unknown {
    let mode: 'insert' | 'delete' | null = null
    let rowsToInsert: unknown = null
    const filters: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}

    builder.insert = (rows: unknown) => {
      mode = 'insert'
      rowsToInsert = rows
      return builder
    }
    builder.delete = () => {
      mode = 'delete'
      return builder
    }
    builder.eq = (col: string, val: unknown) => { filters[col] = val; return builder }
    builder.is = (col: string, val: unknown) => { filters[`${col}__is`] = val; return builder }

    builder.select = (_cols?: string) => builder
    builder.maybeSingle = async () => {
      if (mode === 'insert' && table === 'knowledge_documents') {
        if (mockCalls.insertShouldFail) {
          return {
            data:  null,
            error: { message: typeof mockCalls.insertShouldFail === 'string' ? mockCalls.insertShouldFail : 'doc insert failed' },
          }
        }
        mockCalls.inserts.push({ table, rows: rowsToInsert })
        return { data: { id: mockCalls.insertedDocId }, error: null }
      }
      return { data: null, error: null }
    }

    // Thenable: lets the helper await the builder for delete/insert
    // chains that don't end in .select().maybeSingle().
    builder.then = (onResolve: (v: unknown) => unknown) => {
      if (mode === 'delete') {
        mockCalls.deletes.push({ table, filters: { ...filters } })
        return Promise.resolve({ error: null }).then(onResolve)
      }
      if (mode === 'insert' && table === 'knowledge_chunks') {
        if (mockCalls.chunkInsertShouldFail) {
          mockCalls.inserts.push({ table, rows: rowsToInsert })
          return Promise.resolve({
            error: { message: typeof mockCalls.chunkInsertShouldFail === 'string' ? mockCalls.chunkInsertShouldFail : 'chunk insert failed' },
          }).then(onResolve)
        }
        mockCalls.inserts.push({ table, rows: rowsToInsert })
        return Promise.resolve({ error: null }).then(onResolve)
      }
      return Promise.resolve({ data: null, error: null }).then(onResolve)
    }

    return builder
  }
  return {
    supabaseAdmin: () => ({
      from: (table: string) => makeBuilder(table),
    }),
  }
})

vi.mock('@/lib/ai/embeddings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/embeddings')>('@/lib/ai/embeddings')
  return {
    ...actual,
    embed: vi.fn(async ({ texts }: { texts: string[] }) => ({
      embeddings:  texts.map(() => new Array(1024).fill(0).map((_, i) => i / 1024)),
      totalTokens: texts.length * 800,
    })),
    vectorLiteral: (v: number[]) => `[${v.join(',')}]`,
  }
})

vi.mock('@/lib/ai/chunker', () => ({
  chunkText: ({ text }: { text: string }) => {
    if (!text.trim()) return []
    const half = Math.ceil(text.length / 2)
    return [
      { index: 0, text: text.slice(0, half), tokenEst: 100, startChar: 0,    endChar: half },
      { index: 1, text: text.slice(half),    tokenEst: 100, startChar: half, endChar: text.length },
    ]
  },
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { syncManualToRag, syncManualToRagSafe } from '@/lib/ai/syncManualToRag'

const PUBLISHED_MANUAL = {
  id:           'manual-uuid-1',
  module_id:    'loto',
  title:        'LOTO',
  summary:      'Lockout/Tagout',
  body_md:      '## LOTO\n\nProcedures and placards.\n\n## Sign-on\n\nWorkers sign on after isolation is verified.',
  published_at: '2026-05-09T00:00:00.000Z',
  version:      2,
}

beforeEach(() => {
  mockCalls.inserts.length = 0
  mockCalls.deletes.length = 0
  mockCalls.insertedDocId = 'doc-uuid-1'
  mockCalls.insertShouldFail = false
  mockCalls.chunkInsertShouldFail = false
})

describe('syncManualToRag — published manual', () => {
  it('deletes any prior row, inserts document + chunks, returns the outcome', async () => {
    const r = await syncManualToRag(PUBLISHED_MANUAL)
    expect(r.action).toBe('ingested')
    expect(r.document_id).toBe('doc-uuid-1')
    expect(r.chunk_count).toBe(2)
    expect(r.voyage_tokens).toBeGreaterThan(0)

    expect(mockCalls.deletes.some(d => d.table === 'knowledge_documents')).toBe(true)
    expect(mockCalls.inserts.some(i => i.table === 'knowledge_documents')).toBe(true)
    expect(mockCalls.inserts.some(i => i.table === 'knowledge_chunks')).toBe(true)
  })

  it('uses tenant_id = NULL (platform-wide visibility)', async () => {
    await syncManualToRag(PUBLISHED_MANUAL)
    const docInsert = mockCalls.inserts.find(i => i.table === 'knowledge_documents')!
    const row = (docInsert.rows as Record<string, unknown>)
    expect(row.tenant_id).toBeNull()
    expect(row.source_type).toBe('manual')
  })

  it('prefixes the document title with "Soteria User Manual:" so citations read clearly', async () => {
    await syncManualToRag(PUBLISHED_MANUAL)
    const docInsert = mockCalls.inserts.find(i => i.table === 'knowledge_documents')!
    expect((docInsert.rows as { title: string }).title).toBe('Soteria User Manual: LOTO')
  })

  it('sets effective_date from published_at so the citation can show it', async () => {
    await syncManualToRag(PUBLISHED_MANUAL)
    const row = mockCalls.inserts.find(i => i.table === 'knowledge_documents')!.rows as { effective_date: string }
    expect(row.effective_date).toBe('2026-05-09')
  })

  it('points source_url at the in-app manual page', async () => {
    await syncManualToRag(PUBLISHED_MANUAL)
    const row = mockCalls.inserts.find(i => i.table === 'knowledge_documents')!.rows as { source_url: string }
    expect(row.source_url).toBe('/manuals/loto')
  })

  it('writes manual_id + module_id + version into chunk metadata for traceability', async () => {
    await syncManualToRag(PUBLISHED_MANUAL)
    const chunkInsert = mockCalls.inserts.find(i => i.table === 'knowledge_chunks')!
    const chunkRows = chunkInsert.rows as Array<{ metadata: Record<string, unknown> }>
    for (const row of chunkRows) {
      expect(row.metadata.manual_id).toBe('manual-uuid-1')
      expect(row.metadata.module_id).toBe('loto')
      expect(row.metadata.version).toBe(2)
    }
  })

  it('uses the same content_sha256 across syncs for a given module_id (idempotent replace)', async () => {
    await syncManualToRag(PUBLISHED_MANUAL)
    const sha1 = (mockCalls.inserts.find(i => i.table === 'knowledge_documents')!.rows as { content_sha256: string }).content_sha256
    mockCalls.inserts.length = 0
    mockCalls.deletes.length = 0
    await syncManualToRag({ ...PUBLISHED_MANUAL, body_md: 'Updated body content', version: 3 })
    const sha2 = (mockCalls.inserts.find(i => i.table === 'knowledge_documents')!.rows as { content_sha256: string }).content_sha256
    expect(sha1).toBe(sha2)
  })

  it('cleans up the inserted document if a chunk-insert batch fails', async () => {
    mockCalls.chunkInsertShouldFail = 'unique_violation'
    await expect(syncManualToRag(PUBLISHED_MANUAL)).rejects.toThrow(/Failed to insert manual chunks/)
    expect(mockCalls.deletes.some(d => d.table === 'knowledge_documents' && d.filters['id'] === 'doc-uuid-1')).toBe(true)
  })
})

describe('syncManualToRag — draft / empty', () => {
  it('removes prior RAG row when published_at is null (draft)', async () => {
    const r = await syncManualToRag({ ...PUBLISHED_MANUAL, published_at: null })
    expect(r.action).toBe('removed')
    expect(mockCalls.deletes.some(d => d.table === 'knowledge_documents')).toBe(true)
    expect(mockCalls.inserts.length).toBe(0)
  })

  it('removes prior RAG row when body_md is empty', async () => {
    const r = await syncManualToRag({ ...PUBLISHED_MANUAL, body_md: '   \n  ' })
    expect(r.action).toBe('removed')
    expect(mockCalls.inserts.length).toBe(0)
  })
})

describe('syncManualToRagSafe', () => {
  it('returns null on a thrown error instead of propagating', async () => {
    mockCalls.insertShouldFail = 'simulated DB outage'
    const r = await syncManualToRagSafe(PUBLISHED_MANUAL)
    expect(r).toBeNull()
  })

  it('returns the outcome on success', async () => {
    const r = await syncManualToRagSafe(PUBLISHED_MANUAL)
    expect(r?.action).toBe('ingested')
  })
})
