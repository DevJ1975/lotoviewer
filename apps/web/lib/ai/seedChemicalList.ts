import Anthropic from '@anthropic-ai/sdk'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'

// Seed-list generation — propose the most common manufacturing chemicals to
// pre-populate the global SDS reference library.
//
// Same two-step shape as lib/ai/discoverSds.ts, and for the same reason: a
// web_search-enabled call returns citations, which the Messages API rejects
// alongside structured output (output_config.format). So step 1 searches and
// returns prose; step 2 normalizes that prose into a typed list via a
// tool-free structured-output call.
//
// The output is a list of CANDIDATES only. A human reviews and approves the
// list before the research pass (lib/sdsLibrarySeed.ts) discovers each one's
// official SDS. Nothing here writes to the database.

const MODEL = MODEL_BY_SURFACE['seed-sds-list']

// web_search loops can hit the per-request tool ceiling and return
// stop_reason 'pause_turn'; resume up to this many times.
const MAX_CONTINUATIONS = 5
const MAX_USES = 6

const CAS_RE = /^\d{2,7}-\d{2}-\d$/

export interface ProposedChemical {
  name:         string
  cas:          string | null
  manufacturer: string | null
  rationale:    string
}

export interface SeedListUsage { inputTokens: number; outputTokens: number }

const SEARCH_SYSTEM = `You are an industrial-hygiene chemical-inventory specialist building a reference catalog of the chemicals most commonly found on manufacturing sites (food/beverage, metalworking, plastics, chemical processing, maintenance shops).

GOAL
Propose the most COMMON industrial chemical products a typical manufacturing facility stocks. Spread the list across the major categories so it isn't all solvents:
- Solvents & thinners (acetone, IPA, mineral spirits, toluene, MEK…)
- Acids & bases / cleaners (sodium hydroxide, sulfuric acid, citric acid, bleach…)
- Lubricants, oils & greases
- Adhesives, sealants & coatings (epoxies, paints, primers)
- Fuels & gases (propane, acetylene, diesel, CO2)
- Sanitizers & water-treatment chemicals
- Maintenance aerosols (penetrating oil, contact cleaner, brake cleaner)

RULES
1. Use web search to ground the list in real, widely-used products. Prefer chemicals/products that show up on real SDS binders and Tier II inventories.
2. For each entry give: the common product or chemical name, the CAS Registry Number when it's a single substance (mixtures may have none), a typical manufacturer or brand, and ONE short sentence on why it's common on manufacturing sites.
3. Use real CAS numbers in the form \\d{2,7}-\\d{2}-\\d. If you are not sure of a CAS, leave it blank rather than guessing.
4. No duplicates. Each entry must be a distinct chemical/product.
5. Aim for the count requested, breadth over depth.`

const NORMALIZE_SYSTEM = `Extract the proposed chemicals described in the text into the supplied JSON schema. Include only entries that name a real chemical or product. Do NOT invent CAS numbers — use null when the text doesn't give a concrete one in the form \\d{2,7}-\\d{2}-\\d. Keep rationale to one sentence. If the text lists none, return an empty array.`

const LIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['chemicals'],
  properties: {
    chemicals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'cas', 'manufacturer', 'rationale'],
        properties: {
          name:         { type: 'string' },
          cas:          { type: ['string', 'null'] },
          manufacturer: { type: ['string', 'null'] },
          rationale:    { type: 'string' },
        },
      },
    },
  },
} as const

/**
 * Step 1 — web_search for common manufacturing chemicals. Returns the model's
 * prose (which names the chemicals) plus token usage. Resumes `pause_turn`.
 */
export async function searchCommonChemicals(
  client:  Anthropic,
  count:   number,
  exclude: string[] = [],
): Promise<{ rawText: string; usage: SeedListUsage }> {
  const query = [
    `Propose ${count} of the most common chemical products stocked on manufacturing sites, spread across the categories in your instructions.`,
    exclude.length > 0
      ? `Do NOT repeat any of these already-collected chemicals:\n${exclude.slice(0, 400).join(', ')}`
      : null,
  ].filter(Boolean).join('\n\n')

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: query }]
  let usage: SeedListUsage = { inputTokens: 0, outputTokens: 0 }
  let response: Anthropic.Message | null = null

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    response = await client.messages.create({
      model:      MODEL,
      max_tokens: 8192,
      system:     SEARCH_SYSTEM,
      messages,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_USES },
      ],
    })
    usage = {
      inputTokens:  usage.inputTokens  + (response.usage?.input_tokens  ?? 0),
      outputTokens: usage.outputTokens + (response.usage?.output_tokens ?? 0),
    }
    if (response.stop_reason !== 'pause_turn') break
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
 * Step 2 — normalize the search prose into a typed list via structured output.
 * Drops entries without a name and nulls out CAS values that aren't well-formed.
 */
export async function normalizeChemicalList(
  client:  Anthropic,
  rawText: string,
): Promise<{ chemicals: ProposedChemical[]; usage: SeedListUsage }> {
  if (!rawText.trim()) return { chemicals: [], usage: { inputTokens: 0, outputTokens: 0 } }

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 8192,
    system:     NORMALIZE_SYSTEM,
    messages:   [{ role: 'user', content: rawText }],
    output_config: { format: { type: 'json_schema', schema: LIST_SCHEMA } },
  })
  const usage: SeedListUsage = {
    inputTokens:  response.usage?.input_tokens  ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) return { chemicals: [], usage }

  let raw: unknown
  try { raw = JSON.parse(textBlock.text) }
  catch { return { chemicals: [], usage } }

  const rows = Array.isArray((raw as { chemicals?: unknown }).chemicals)
    ? (raw as { chemicals: unknown[] }).chemicals
    : []

  const chemicals: ProposedChemical[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    const name = str(row.name)
    if (!name) continue
    const casRaw = typeof row.cas === 'string' ? row.cas.trim() : ''
    chemicals.push({
      name,
      cas:          CAS_RE.test(casRaw) ? casRaw : null,
      manufacturer: str(row.manufacturer) || null,
      rationale:    str(row.rationale),
    })
  }
  return { chemicals, usage }
}

/** Run both steps. The route logs the combined usage. */
export async function proposeChemicalList(
  client:  Anthropic,
  count:   number,
  exclude: string[] = [],
): Promise<{ chemicals: ProposedChemical[]; usage: SeedListUsage }> {
  const search = await searchCommonChemicals(client, count, exclude)
  const norm   = await normalizeChemicalList(client, search.rawText)
  return {
    chemicals: norm.chemicals,
    usage: {
      inputTokens:  search.usage.inputTokens  + norm.usage.inputTokens,
      outputTokens: search.usage.outputTokens + norm.usage.outputTokens,
    },
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
