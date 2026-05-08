// Voyage AI embeddings wrapper.
//
// Why Voyage and not Anthropic: Anthropic doesn't ship an embeddings
// model — they recommend Voyage AI as the canonical pair. voyage-3-large
// at 1024 dims is the current best-in-class for technical/regulatory
// content (the audit notes that for our domain, Voyage's recall on OSHA
// citation queries materially beats OpenAI's text-embedding-3-large).
//
// API contract: POST https://api.voyageai.com/v1/embeddings with
// { model, input: string[], input_type: 'document' | 'query' }.
// Returns { data: [{ embedding: number[], index: number }, ...] }.
// The wrapper:
//   - Batches calls (Voyage caps at 128 inputs / request)
//   - Distinguishes 'document' (corpus chunks at ingest) vs 'query'
//     (user query at retrieval). Voyage gives different embeddings
//     for these — queries get a slight asymmetric tweak that improves
//     retrieval. Mixing them up degrades recall noticeably.
//   - Surfaces a typed missing-key error so the upload route can
//     return a clear 503 instead of a Voyage 401.

import * as Sentry from '@sentry/nextjs'

export const VOYAGE_MODEL = 'voyage-3-large' as const
export const EMBEDDING_DIMS = 1024 as const
const VOYAGE_BATCH_SIZE = 128
const VOYAGE_TIMEOUT_MS = 30_000

export class VoyageNotConfiguredError extends Error {
  constructor() {
    super('VOYAGE_API_KEY is not configured for this deployment.')
    this.name = 'VoyageNotConfiguredError'
  }
}

export class VoyageApiError extends Error {
  constructor(public status: number, public payload: unknown, message?: string) {
    super(message ?? `Voyage API error: ${status}`)
    this.name = 'VoyageApiError'
  }
}

export type InputType = 'document' | 'query'

interface EmbedArgs {
  texts:     string[]
  inputType: InputType
}

interface EmbedResult {
  embeddings:  number[][]
  /** Total tokens charged. Voyage exposes usage on the response — we
   *  log it for cost attribution per ingestion run. */
  totalTokens: number
}

/**
 * Embeds an array of strings. Returns embeddings in the same order
 * as the input array. Throws on missing key or upstream error.
 */
export async function embed(args: EmbedArgs): Promise<EmbedResult> {
  const apiKey = process.env.VOYAGE_API_KEY ?? ''
  if (!apiKey) throw new VoyageNotConfiguredError()
  if (args.texts.length === 0) return { embeddings: [], totalTokens: 0 }

  const all: number[][] = []
  let totalTokens = 0

  // Voyage caps batches at 128 inputs; chunk the input array
  // accordingly. Each batch becomes one HTTP call.
  for (let i = 0; i < args.texts.length; i += VOYAGE_BATCH_SIZE) {
    const batch = args.texts.slice(i, i + VOYAGE_BATCH_SIZE)
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), VOYAGE_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type':  'application/json',
        },
        body: JSON.stringify({
          model:      VOYAGE_MODEL,
          input:      batch,
          input_type: args.inputType,
        }),
      })
    } finally {
      clearTimeout(t)
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      Sentry.addBreadcrumb({
        category: 'ai',
        level:    'error',
        message:  'voyage.embeddings failed',
        data: { status: response.status, batch_index: i, batch_size: batch.length },
      })
      throw new VoyageApiError(response.status, payload)
    }

    const json = (await response.json()) as VoyageResponse
    // Voyage returns results in the same order as input but the typed
    // response carries an explicit `index` field — sort by it to be
    // safe against future reordering.
    const sorted = [...(json.data ?? [])].sort((a, b) => a.index - b.index)
    for (const item of sorted) {
      if (!Array.isArray(item.embedding) || item.embedding.length !== EMBEDDING_DIMS) {
        throw new VoyageApiError(
          200,
          item,
          `Voyage returned an embedding with the wrong dim (${item.embedding?.length} != ${EMBEDDING_DIMS})`,
        )
      }
      all.push(item.embedding)
    }
    totalTokens += json.usage?.total_tokens ?? 0
  }

  return { embeddings: all, totalTokens }
}

interface VoyageResponse {
  data:  Array<{ embedding: number[]; index: number; object: string }>
  model: string
  usage?: { total_tokens?: number }
}

/**
 * Renders a vector(1024) Postgres array literal from a number[].
 * pgvector accepts `'[1.2, 3.4, ...]'::vector(1024)` syntax — used
 * by inserts that go through supabase-js (which doesn't know vector).
 */
export function vectorLiteral(v: number[]): string {
  if (v.length !== EMBEDDING_DIMS) {
    throw new Error(`vectorLiteral: expected ${EMBEDDING_DIMS} dims, got ${v.length}`)
  }
  return `[${v.join(',')}]`
}
