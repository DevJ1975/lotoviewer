import Anthropic from '@anthropic-ai/sdk'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'

// SDS discovery — find a manufacturer's official SDS PDF on the open web.
//
// This is the AI orchestration only: no DB, no auth, no rate-limit (the route
// owns those). Two steps, and they MUST be separate model calls:
//
//   1. searchSdsCandidates — a web_search-enabled call. Web search returns
//      results *with citations*, and the Messages API rejects citations
//      together with structured output (output_config.format) — so this call
//      cannot also constrain its output to a schema. It returns free text.
//   2. normalizeCandidates — a second, tool-free call that constrains the
//      first call's prose into a typed candidate list via output_config.format.
//
// A human picks one candidate; only then does the /fetch route download it
// (through the SSRF-guarded fetcher) and the existing parse→review pipeline
// runs. Discovery never auto-applies anything.

const MODEL = MODEL_BY_SURFACE['discover-sds']

// Server-side tool loops can return stop_reason 'pause_turn' when they hit the
// per-request tool-iteration ceiling; re-send to resume. Cap it so a runaway
// search can't loop forever.
const MAX_CONTINUATIONS = 5
const MAX_USES = 5

export interface SdsProductInfo {
  productName:  string
  manufacturer: string | null
  productCode:  string | null
}

export interface SdsCandidate {
  url:              string
  title:            string
  manufacturer:     string
  productName:      string
  revisionDate:     string | null
  confidence:       'high' | 'medium' | 'low'
  reasonsItMatches: string
}

export interface DiscoverUsage { inputTokens: number; outputTokens: number }

const SEARCH_SYSTEM = `You are an industrial-hygiene technician locating the OFFICIAL manufacturer Safety Data Sheet (SDS / MSDS) for a specific chemical product.

RULES
1. Prefer the manufacturer's own site, then a major distributor (Fisher, Sigma-Aldrich, VWR, Grainger) or a government aggregator (OSHA, CDC, ECHA, PubChem).
2. You want the direct link to the SDS PDF for THIS product (match manufacturer + product name/code), not a search-results or catalog page.
3. Never invent a URL. Only report links you actually found via search. If you cannot find one, say so plainly.
4. For each candidate you find, note: the URL, the document title, the manufacturer, the product name as stated, the revision date if shown, and one sentence on why it matches the requested product.
5. List at most 5 candidates, best match first.`

const NORMALIZE_SYSTEM = `Extract the SDS document candidates described in the text into the supplied JSON schema. Include only entries that have a concrete https URL the text actually mentions. Do NOT invent URLs or fields. If the text reports no candidates, return an empty array. confidence reflects how well the candidate matches the requested product (high/medium/low). revision_date is ISO yyyy-mm-dd or null.`

const CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'title', 'manufacturer', 'product_name', 'revision_date', 'confidence', 'reasons'],
        properties: {
          url:          { type: 'string' },
          title:        { type: 'string' },
          manufacturer: { type: 'string' },
          product_name: { type: 'string' },
          revision_date: { type: ['string', 'null'] },
          confidence:   { type: 'string', enum: ['high', 'medium', 'low'] },
          reasons:      { type: 'string' },
        },
      },
    },
  },
} as const

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new URL(value).protocol === 'https:' }
  catch { return false }
}

/**
 * Step 1 — run a web_search loop to find candidate SDS PDFs. Returns the
 * model's prose (which names the URLs it found) plus token usage. Resumes
 * `pause_turn` up to MAX_CONTINUATIONS.
 */
export async function searchSdsCandidates(
  client: Anthropic,
  info:   SdsProductInfo,
): Promise<{ rawText: string; usage: DiscoverUsage }> {
  const query = [
    `Find the official manufacturer Safety Data Sheet (SDS) PDF for this product:`,
    `Product name: ${info.productName}`,
    info.manufacturer ? `Manufacturer: ${info.manufacturer}` : null,
    info.productCode  ? `Product code: ${info.productCode}`  : null,
  ].filter(Boolean).join('\n')

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: query }]
  let usage: DiscoverUsage = { inputTokens: 0, outputTokens: 0 }
  let response: Anthropic.Message | null = null

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    response = await client.messages.create({
      model:      MODEL,
      max_tokens: 4096,
      system:     SEARCH_SYSTEM,
      messages,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_USES },
        { type: 'web_fetch_20260209',  name: 'web_fetch',  max_uses: MAX_USES },
      ],
    })
    usage = {
      inputTokens:  usage.inputTokens  + (response.usage?.input_tokens  ?? 0),
      outputTokens: usage.outputTokens + (response.usage?.output_tokens ?? 0),
    }
    if (response.stop_reason !== 'pause_turn') break
    // Resume: re-send with the assistant's partial turn appended.
    messages.push({ role: 'assistant', content: response.content })
  }

  const rawText = (response?.content ?? [])
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()

  return { rawText, usage }
}

/**
 * Step 2 — normalize the search prose into a typed candidate list via
 * structured output. Drops anything without a concrete https URL.
 */
export async function normalizeCandidates(
  client:  Anthropic,
  rawText: string,
): Promise<{ candidates: SdsCandidate[]; usage: DiscoverUsage }> {
  if (!rawText.trim()) return { candidates: [], usage: { inputTokens: 0, outputTokens: 0 } }

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 2048,
    system:     NORMALIZE_SYSTEM,
    messages:   [{ role: 'user', content: rawText }],
    output_config: { format: { type: 'json_schema', schema: CANDIDATE_SCHEMA } },
  })
  const usage: DiscoverUsage = {
    inputTokens:  response.usage?.input_tokens  ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) return { candidates: [], usage }

  let raw: unknown
  try { raw = JSON.parse(textBlock.text) }
  catch { return { candidates: [], usage } }

  const rows = Array.isArray((raw as { candidates?: unknown }).candidates)
    ? (raw as { candidates: unknown[] }).candidates
    : []

  const candidates: SdsCandidate[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    // Boundary validation: drop anything without a real https URL — the model
    // is told not to invent links, but we never trust that on its own.
    if (!isHttpsUrl(row.url)) continue
    if (seen.has(row.url)) continue   // the model can list the same PDF twice
    seen.add(row.url)
    const confidence = row.confidence === 'high' || row.confidence === 'medium' || row.confidence === 'low'
      ? row.confidence : 'low'
    candidates.push({
      url:              row.url,
      title:            str(row.title),
      manufacturer:     str(row.manufacturer),
      productName:      str(row.product_name),
      revisionDate:     typeof row.revision_date === 'string' && row.revision_date.trim() ? row.revision_date : null,
      confidence,
      reasonsItMatches: str(row.reasons),
    })
  }
  return { candidates, usage }
}

/** Run both steps. The route calls this, then logs the combined usage. */
export async function discoverSds(
  client: Anthropic,
  info:   SdsProductInfo,
): Promise<{ candidates: SdsCandidate[]; usage: DiscoverUsage }> {
  const search = await searchSdsCandidates(client, info)
  const norm   = await normalizeCandidates(client, search.rawText)
  return {
    candidates: norm.candidates,
    usage: {
      inputTokens:  search.usage.inputTokens  + norm.usage.inputTokens,
      outputTokens: search.usage.outputTokens + norm.usage.outputTokens,
    },
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
