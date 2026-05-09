// RAG retrieval for the home-page assistant.
//
// Pipeline:
//   1. Embed the user's query as a Voyage 'query' embedding (different
//      from 'document' embeddings used at ingest time — mixing them up
//      degrades recall).
//   2. Call the match_knowledge_chunks RPC with the embedding + an
//      optional source-type filter (set by the caller when the query
//      obviously narrows the corpus, e.g. "what does DOT say about…").
//   3. Format the matches as <doc> blocks the model can cite. Each
//      block carries title, jurisdiction, source URL, and an inline
//      citation tag the model is instructed to copy verbatim.
//
// Tenant scoping: RLS handles it automatically — match_knowledge_chunks
// joins knowledge_documents which has its own RLS that limits visibility
// to global docs + the user's tenants. The retrieve fn passes a
// tenant_filter param too so the model never sees policies from a tenant
// the user isn't currently scoped to (defense in depth — RLS is the
// primary gate).
//
// Failure mode: if Voyage is missing or the RPC throws, retrieval
// returns an empty context block and logs to Sentry. The assistant
// degrades to no-RAG mode rather than 500-ing the whole turn.

import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  embed,
  VoyageNotConfiguredError,
  type InputType,
} from '@/lib/ai/embeddings'

export type KnowledgeSource =
  | 'regulation' | 'state_reg' | 'dot' | 'epa' | 'rcra' | 'company_policy' | 'manual'

export interface RetrievedChunk {
  chunk_id:        string
  document_id:     string
  chunk_index:     number
  text:            string
  metadata:        Record<string, unknown> | null
  source_type:     KnowledgeSource
  title:           string
  jurisdiction:    string | null
  effective_date:  string | null
  source_url:      string | null
  doc_tenant_id:   string | null
  similarity:      number
}

interface RetrieveArgs {
  query:        string
  tenantId:     string | null
  /** Top K. Defaults to 8. */
  k?:           number
  /** Restrict to certain source types. Useful when the caller can
   *  detect intent ("show me OSHA…" → ['regulation','state_reg']). */
  sources?:     KnowledgeSource[]
  /** Override the inputType. Defaults to 'query'. */
  inputType?:   InputType
}

export interface RetrieveResult {
  /** The model-facing context block, ready to drop into the system
   *  prompt's dynamic section. Empty string when nothing retrieved. */
  contextBlock: string
  /** Raw chunks for the UI to render citations under each turn. */
  chunks:       RetrievedChunk[]
  /** Telemetry. */
  voyageTokens: number
}

const EMPTY_RESULT: RetrieveResult = { contextBlock: '', chunks: [], voyageTokens: 0 }

export async function retrieveContext(args: RetrieveArgs): Promise<RetrieveResult> {
  const query = args.query.trim()
  if (!query) return EMPTY_RESULT

  let embedding: number[]
  let voyageTokens = 0
  try {
    const r = await embed({ texts: [query], inputType: args.inputType ?? 'query' })
    if (r.embeddings.length !== 1) return EMPTY_RESULT
    embedding = r.embeddings[0]
    voyageTokens = r.totalTokens
  } catch (err) {
    if (!(err instanceof VoyageNotConfiguredError)) {
      Sentry.captureException(err, { tags: { source: 'rag.embed' } })
    }
    // No embedding → no retrieval. Assistant degrades gracefully.
    return EMPTY_RESULT
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin.rpc('match_knowledge_chunks', {
    query_embedding: embedding as unknown as number[],
    match_count:     args.k ?? 8,
    source_filter:   args.sources && args.sources.length > 0 ? args.sources : null,
    tenant_filter:   args.tenantId ?? null,
  })
  if (error) {
    Sentry.captureException(error, { tags: { source: 'rag.match_rpc' } })
    return { ...EMPTY_RESULT, voyageTokens }
  }

  const chunks = ((data ?? []) as RetrievedChunk[]).filter(c => c.text.length > 0)
  if (chunks.length === 0) return { ...EMPTY_RESULT, voyageTokens }

  return {
    contextBlock: formatChunks(chunks),
    chunks,
    voyageTokens,
  }
}

/**
 * Renders the retrieved chunks as <doc>…</doc> XML blocks the model
 * can cite. The format is intentionally explicit — Claude responds
 * well to structured XML and the citation tag is what the system
 * prompt's CITATION RULES section instructs the model to echo.
 */
export function formatChunks(chunks: RetrievedChunk[]): string {
  const lines: string[] = ['<retrieved_context>']
  for (const c of chunks) {
    const cite = buildCiteTag(c)
    const docAttrs: string[] = []
    docAttrs.push(`title=${JSON.stringify(c.title)}`)
    docAttrs.push(`source=${JSON.stringify(c.source_type)}`)
    if (c.jurisdiction) docAttrs.push(`jurisdiction=${JSON.stringify(c.jurisdiction)}`)
    if (c.effective_date) docAttrs.push(`effective=${JSON.stringify(c.effective_date)}`)
    docAttrs.push(`cite=${JSON.stringify(cite)}`)
    docAttrs.push(`similarity=${JSON.stringify(c.similarity.toFixed(3))}`)
    lines.push(`  <doc ${docAttrs.join(' ')}>`)
    lines.push(`    ${c.text.replace(/\n/g, '\n    ')}`)
    lines.push(`  </doc>`)
  }
  lines.push('</retrieved_context>')
  return lines.join('\n')
}

/**
 * Builds the citation string the model is told to copy verbatim into
 * its reply. Format depends on source type:
 *   - regulation / state_reg / dot / epa / rcra → "[<title> §<section>]"
 *     where <section> comes from chunk metadata if present
 *   - company_policy → "[<title>]"
 */
function buildCiteTag(c: RetrievedChunk): string {
  const section = (c.metadata && typeof c.metadata === 'object'
    ? (c.metadata as Record<string, unknown>)['section']
    : undefined) as string | undefined
  // Manuals carry their own "Soteria User Manual: <title>" prefix from
  // syncManualToRag; just bracket the title as-is for the cite tag.
  if (c.source_type === 'manual' || c.source_type === 'company_policy') {
    return `[${c.title}${section ? ` §${section}` : ''}]`
  }
  return `[${c.title}${section ? ` § ${section}` : ''}]`
}
