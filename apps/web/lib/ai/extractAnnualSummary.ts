// AI extraction of a prior-year OSHA 300A annual-summary PDF.
//
// Mirrors policyExtract.ts: same Anthropic client wrapper + SONNET
// model, same base64 document-block posture, same 25MB cap. The
// difference is the output contract — rather than free text, we force
// the model to emit the 300A numeric fields through a single tool so
// the result is structured and machine-checkable.
//
// This module NEVER persists. The route logs the AI spend and returns
// the parsed fields to the admin for review; only an explicit confirm
// writes to osha_annual_summaries. (Human-in-the-loop is the whole
// point of the feature.)

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic } from '@/lib/ai/client'
import { SONNET } from '@/lib/ai/models'
import { INJURY_TYPES, type InjuryType } from '@soteria/core/oshaForms'

export const MAX_BYTES = 25 * 1024 * 1024 // 25 MB — matches policyExtract.

export type ExtractMime = 'application/pdf' | 'text/plain' | 'text/markdown'

export const SUPPORTED_MIMES: ExtractMime[] = ['application/pdf', 'text/plain', 'text/markdown']

// The numeric 300A fields we ask the model to read off the form. These
// map 1:1 onto the Osha300ASummary shape the confirm route persists.
// `by_injury_type` is optional from the model — the 300A's per-illness
// breakdown is often blank — so we derive it when absent.
export interface AnnualSummaryFields {
  year:                        number
  total_deaths:                number
  total_days_away:             number
  total_restricted:            number
  total_other_recordable:      number
  total_days_away_count:       number
  total_days_restricted_count: number
  total_hours_worked:          number
  annual_avg_employees:        number
  by_injury_type:              Record<InjuryType, number>
}

interface ExtractArgs {
  bytes: Uint8Array
  mime:  string
}

interface ExtractResult {
  parsed: AnnualSummaryFields
  usage?: {
    inputTokens:     number
    outputTokens:    number
    cacheReadTokens: number
  }
}

export class UnsupportedMimeError extends Error {
  constructor(mime: string) {
    super(`Unsupported MIME type: ${mime}. Supported: ${SUPPORTED_MIMES.join(', ')}.`)
    this.name = 'UnsupportedMimeError'
  }
}

export class NoSummaryFoundError extends Error {
  constructor() {
    super('No recognizable OSHA 300A annual summary was found in this file. Upload a Form 300A (Summary of Work-Related Injuries and Illnesses).')
    this.name = 'NoSummaryFoundError'
  }
}

const SYSTEM = `You read OSHA Form 300A "Summary of Work-Related Injuries and Illnesses" documents and extract the establishment's annual totals. The 300A summarizes one calendar year:
- The reporting year.
- Case totals: total deaths (column G), total cases with days away from work (H), total cases with job transfer or restriction (I), total other recordable cases (J).
- Day totals: total number of days away from work, total number of days of job transfer or restriction.
- The injury/illness breakdown by type, when present (injuries, skin disorders, respiratory conditions, poisonings, hearing loss, all other illnesses).
- The establishment information: total hours worked by all employees, and the annual average number of employees.

Report every count exactly as printed. If a box is blank, report 0 — never invent a number. If the document is clearly NOT an OSHA 300A annual summary (e.g. a 300 log, a 301 incident report, an unrelated PDF), call the tool with year=0 and all totals 0 so the caller can reject it.`

// Single tool whose input_schema IS the field set. Forcing
// tool_choice to this tool guarantees the model replies with a
// tool_use block carrying the structured numbers — no JSON-in-prose
// parsing, no markdown fences to strip.
const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'report_annual_summary',
  description: 'Report the numeric totals read from an OSHA 300A annual summary.',
  input_schema: {
    type: 'object',
    properties: {
      year:                        { type: 'integer', description: 'The calendar year the summary covers, e.g. 2023. Use 0 if not an OSHA 300A.' },
      total_deaths:                { type: 'integer', description: 'Total number of deaths (column G).' },
      total_days_away:             { type: 'integer', description: 'Total cases with days away from work (column H).' },
      total_restricted:            { type: 'integer', description: 'Total cases with job transfer or restriction (column I).' },
      total_other_recordable:      { type: 'integer', description: 'Total other recordable cases (column J).' },
      total_days_away_count:       { type: 'integer', description: 'Total number of days away from work.' },
      total_days_restricted_count: { type: 'integer', description: 'Total number of days of job transfer or restriction.' },
      total_hours_worked:          { type: 'integer', description: 'Total hours worked by all employees during the year.' },
      annual_avg_employees:        { type: 'integer', description: 'Annual average number of employees.' },
      by_injury_type: {
        type: 'object',
        description: 'Per-type case breakdown. Omit when the form does not break it out.',
        properties: {
          injury:        { type: 'integer' },
          skin_disorder: { type: 'integer' },
          respiratory:   { type: 'integer' },
          poisoning:     { type: 'integer' },
          hearing_loss:  { type: 'integer' },
          other_illness: { type: 'integer' },
        },
      },
    },
    required: [
      'year', 'total_deaths', 'total_days_away', 'total_restricted',
      'total_other_recordable', 'total_days_away_count',
      'total_days_restricted_count', 'total_hours_worked', 'annual_avg_employees',
    ],
  },
}

// Clamp any model output to a non-negative integer. Defends against
// negatives, floats, NaN, strings — the model is reliable but the
// boundary must validate.
function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

export async function extractAnnualSummary(args: ExtractArgs): Promise<ExtractResult> {
  const { bytes, mime } = args

  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(`File exceeds the ${MAX_BYTES / 1024 / 1024}MB cap.`)
  }
  if (!(SUPPORTED_MIMES as string[]).includes(mime)) {
    throw new UnsupportedMimeError(mime)
  }

  // The PDF rides as a document block; plain text / markdown ride as a
  // text block. Both go to the same tool-forced call.
  const content: Anthropic.ContentBlockParam[] = mime === 'application/pdf'
    ? [{
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') },
      }]
    : [{ type: 'text', text: Buffer.from(bytes).toString('utf-8') }]
  content.push({
    type: 'text',
    text: 'Extract the OSHA 300A annual totals from this document and report them via the report_annual_summary tool.',
  })

  const client = await getAnthropic(null)
  const response = (await client.messages.create({
    model:       SONNET,
    max_tokens:  1024,
    system:      SYSTEM,
    tools:       [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
    messages:    [{ role: 'user', content }],
  } as Parameters<Anthropic['messages']['create']>[0])) as Anthropic.Message

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === EXTRACT_TOOL.name,
  )
  if (!toolUse) throw new NoSummaryFoundError()

  const raw = toolUse.input as Record<string, unknown>
  const year = toCount(raw.year)

  const totals = {
    total_deaths:                toCount(raw.total_deaths),
    total_days_away:             toCount(raw.total_days_away),
    total_restricted:            toCount(raw.total_restricted),
    total_other_recordable:      toCount(raw.total_other_recordable),
    total_days_away_count:       toCount(raw.total_days_away_count),
    total_days_restricted_count: toCount(raw.total_days_restricted_count),
    total_hours_worked:          toCount(raw.total_hours_worked),
    annual_avg_employees:        toCount(raw.annual_avg_employees),
  }

  // A year of 0 is the model's "this isn't a 300A" signal. An all-zero
  // payload with no year is equally unusable — reject both so the admin
  // doesn't review an empty form.
  const recordableTotal =
    totals.total_deaths + totals.total_days_away + totals.total_restricted + totals.total_other_recordable
  if (year === 0) throw new NoSummaryFoundError()

  const parsed: AnnualSummaryFields = {
    year,
    ...totals,
    by_injury_type: deriveByInjuryType(raw.by_injury_type, recordableTotal),
  }

  return {
    parsed,
    usage: {
      inputTokens:     response.usage?.input_tokens ?? 0,
      outputTokens:    response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
    },
  }
}

// The 300A's per-type breakdown is frequently left blank on the form.
// When the model reports it, clamp each entry; when it doesn't, fall
// back to assigning every recordable to `injury` (the dominant type)
// and zeroing the illness categories — a defensible default the admin
// can correct before saving.
export function deriveByInjuryType(
  reported: unknown,
  recordableTotal: number,
): Record<InjuryType, number> {
  const base = Object.fromEntries(INJURY_TYPES.map(t => [t, 0])) as Record<InjuryType, number>

  if (reported && typeof reported === 'object') {
    const r = reported as Record<string, unknown>
    let any = false
    for (const t of INJURY_TYPES) {
      const v = toCount(r[t])
      base[t] = v
      if (v > 0) any = true
    }
    if (any) return base
  }

  base.injury = recordableTotal
  return base
}
