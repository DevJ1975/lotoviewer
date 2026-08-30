import Anthropic from '@anthropic-ai/sdk'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import {
  GHS_PICTOGRAMS,
  GHS_SIGNAL_WORDS,
  PHYSICAL_STATES,
  type ParsedSdsPayload,
} from '@soteria/core/chemicals'

// Claude SDS parsing — the AI call + schema + payload normalization only.
//
// Extracted from the /sds/[sdsId]/parse route so the SDS-library seeder, the
// adopt-from-library flow, and the paper-SDS capture flow share one parser
// and one schema. Callers own the Anthropic client, rate limiting, storage
// download, invocation logging, and where the parsed payload is persisted —
// this module just turns PDF bytes into a validated ParsedSdsPayload.

export const PARSE_SDS_MODEL = MODEL_BY_SURFACE['parse-sds']

const SYSTEM_PROMPT = `You are an industrial-hygiene technician extracting structured data from a manufacturer Safety Data Sheet (SDS / MSDS) authored under OSHA HazCom 2012 (29 CFR 1910.1200) and GHS (Globally Harmonized System) Rev 8+. Your output drives a workplace chemical management system; downstream users include safety supervisors authoring secondary-container labels, EHS leads filing EPCRA Tier II reports, and the OSHA 300 incident workflow.

EXTRACTION RULES
1. Read every section the SDS contains. Standard 16-section format:
   1 Identification · 2 Hazard ID · 3 Composition · 4 First Aid
   5 Firefighting · 6 Accidental Release · 7 Handling/Storage
   8 Exposure Controls/PPE · 9 Physical/Chemical · 10 Stability
   11 Toxicology · 12 Ecology · 13 Disposal · 14 Transport
   15 Regulatory · 16 Other
2. Copy values verbatim from the SDS where possible. Do NOT paraphrase
   H-codes or P-codes — the regulatory text matters.
3. NEVER invent values. If a field is not in the SDS:
   - string fields  → return "" (empty string)
   - number fields  → return null
   - enum fields    → return null
   - integer fields → return null
   - list fields    → return [] (empty array)
   Do NOT guess.
4. CAS Registry Numbers must match \\d{2,7}-\\d{2}-\\d. Drop anything else.
5. GHS pictograms: only return codes from GHS01..GHS09. The SDS may
   illustrate them; map the illustration to its code:
     GHS01 explosive · GHS02 flame (flammable) · GHS03 flame-over-circle
     (oxidizer) · GHS04 gas cylinder · GHS05 corrosion · GHS06 skull and
     crossbones (acute toxicity) · GHS07 exclamation mark (irritant)
     · GHS08 health hazard (silhouette burst) · GHS09 environment.
6. Signal word must be exactly "danger" or "warning" or null.
7. NFPA 0..4 ratings: only fill from an explicit NFPA 704 diamond on
   the SDS. Do NOT derive from H-codes; the rating systems differ.
8. Numeric fields: convert to the stated unit. flash_point_c and
   boiling_point_c are degrees Celsius; if the SDS gives Fahrenheit,
   convert. vapor_pressure_kpa is kilopascals (mmHg × 0.133322).
9. Exposure limits (Section 8): use OSHA PEL when available, else
   ACGIH TLV. Always ppm for gases/vapors; if SDS quotes mg/m³ only,
   leave the ppm field null and put the original in parser_notes.
10. dot_un_number includes the "UN" prefix (e.g. "UN1090").
11. sds_revision_date is the date this REVISION was published (Section
    16 typically), not the original issue date. ISO yyyy-mm-dd.
12. parser_notes: 1-3 sentences flagging anything the human reviewer
    must double-check — conflicting CAS values, missing sections,
    units in mg/m³, multilingual SDS where you only parsed English, etc.

CONFIDENCE
You self-rate per section group (high / medium / low):
- high  : SDS section was present, unambiguous, and you copied verbatim.
- medium: section present but values were partially illegible, mixed
  units, or you had to interpret a phrase ("avoid skin contact" →
  PPE inference).
- low   : section was missing, contradictory, or you produced your
  best guess to fill the schema.
"overall" should be the worst of the per-section ratings, not the
average. If overall is below "high", a human will review before any
field lands on the product record.

OUTPUT
Return JSON matching the supplied schema exactly. No commentary, no
markdown, no surrounding prose.`

const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'product_name', 'manufacturer', 'product_code', 'recommended_use', 'emergency_phone',
    'cas_numbers', 'synonyms',
    'physical_state', 'appearance',
    'flash_point_c', 'boiling_point_c', 'vapor_pressure_kpa',
    'ghs_signal_word', 'ghs_pictograms', 'hazard_statements', 'precautionary_statements',
    'nfpa_health', 'nfpa_flammability', 'nfpa_instability', 'nfpa_special',
    'pel_twa_ppm', 'stel_ppm', 'idlh_ppm', 'ppe_required',
    'first_aid', 'firefighting', 'spill_cleanup',
    'storage_class', 'incompatibilities',
    'dot_un_number', 'dot_hazard_class', 'dot_packing_group',
    'sds_revision_date', 'sds_language',
    'confidence', 'parser_notes',
  ],
  properties: {
    product_name:    { type: 'string' },
    manufacturer:    { type: 'string' },
    product_code:    { type: 'string' },
    recommended_use: { type: 'string' },
    emergency_phone: { type: 'string' },

    cas_numbers: { type: 'array', items: { type: 'string' } },
    synonyms:    { type: 'array', items: { type: 'string' } },

    physical_state: {
      anyOf: [
        { type: 'string', enum: [...PHYSICAL_STATES] },
        { type: 'null' },
      ],
    },
    appearance:         { type: 'string' },
    flash_point_c:      { type: ['number', 'null'] },
    boiling_point_c:    { type: ['number', 'null'] },
    vapor_pressure_kpa: { type: ['number', 'null'] },

    ghs_signal_word: {
      anyOf: [
        { type: 'string', enum: [...GHS_SIGNAL_WORDS] },
        { type: 'null' },
      ],
    },
    ghs_pictograms: {
      type:  'array',
      items: { type: 'string', enum: [...GHS_PICTOGRAMS] },
    },
    hazard_statements: {
      type:  'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'text'],
        properties: { code: { type: 'string' }, text: { type: 'string' } },
      },
    },
    precautionary_statements: {
      type:  'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'text'],
        properties: { code: { type: 'string' }, text: { type: 'string' } },
      },
    },

    nfpa_health: {
      anyOf: [
        { type: 'integer', enum: [0, 1, 2, 3, 4] },
        { type: 'null' },
      ],
    },
    nfpa_flammability: {
      anyOf: [
        { type: 'integer', enum: [0, 1, 2, 3, 4] },
        { type: 'null' },
      ],
    },
    nfpa_instability: {
      anyOf: [
        { type: 'integer', enum: [0, 1, 2, 3, 4] },
        { type: 'null' },
      ],
    },
    nfpa_special: { type: 'string' },

    pel_twa_ppm:  { type: ['number', 'null'] },
    stel_ppm:     { type: ['number', 'null'] },
    idlh_ppm:     { type: ['number', 'null'] },
    ppe_required: { type: 'array', items: { type: 'string' } },

    first_aid: {
      type: 'object',
      additionalProperties: false,
      required: ['inhalation', 'skin', 'eyes', 'ingestion', 'notes'],
      properties: {
        inhalation: { type: 'string' },
        skin:       { type: 'string' },
        eyes:       { type: 'string' },
        ingestion:  { type: 'string' },
        notes:      { type: 'string' },
      },
    },
    firefighting: {
      type: 'object',
      additionalProperties: false,
      required: ['suitable_extinguishers', 'unsuitable_extinguishers', 'special_hazards', 'protective_equipment'],
      properties: {
        suitable_extinguishers:   { type: 'array', items: { type: 'string' } },
        unsuitable_extinguishers: { type: 'array', items: { type: 'string' } },
        special_hazards:          { type: 'string' },
        protective_equipment:     { type: 'string' },
      },
    },
    spill_cleanup: {
      type: 'object',
      additionalProperties: false,
      required: ['personal_precautions', 'environmental_precautions', 'containment_methods', 'cleanup_methods'],
      properties: {
        personal_precautions:      { type: 'string' },
        environmental_precautions: { type: 'string' },
        containment_methods:       { type: 'string' },
        cleanup_methods:           { type: 'string' },
      },
    },

    storage_class:     { type: 'string' },
    incompatibilities: { type: 'array', items: { type: 'string' } },

    dot_un_number:     { type: 'string' },
    dot_hazard_class:  { type: 'string' },
    dot_packing_group: { type: 'string' },

    sds_revision_date: { type: 'string' },
    sds_language:      { type: 'string' },

    confidence: {
      type: 'object',
      additionalProperties: false,
      required: [
        'overall', 'identification', 'hazards', 'physical', 'exposure',
        'first_aid', 'firefighting', 'spill_cleanup', 'transport',
      ],
      properties: {
        overall:        { type: 'string', enum: ['high', 'medium', 'low'] },
        identification: { type: 'string', enum: ['high', 'medium', 'low'] },
        hazards:        { type: 'string', enum: ['high', 'medium', 'low'] },
        physical:       { type: 'string', enum: ['high', 'medium', 'low'] },
        exposure:       { type: 'string', enum: ['high', 'medium', 'low'] },
        first_aid:      { type: 'string', enum: ['high', 'medium', 'low'] },
        firefighting:   { type: 'string', enum: ['high', 'medium', 'low'] },
        spill_cleanup:  { type: 'string', enum: ['high', 'medium', 'low'] },
        transport:      { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
    parser_notes: { type: 'string' },
  },
} as const

// Anthropic's structured-output validator caps "Parameters with union types"
// (anyOf or type-as-array including null) at 16 across the whole schema.
// We keep null only where it's load-bearing — the nullable enum/integer
// fields that can't represent "absent" with an empty string, plus the
// numeric fields where 0 is a meaningful value. String fields drop the
// null branch and the model emits "" when absent; we normalize those back
// to null before persisting so downstream consumers (apply route, UI,
// label generators) keep their existing null semantics.
export function nullifyEmptyStrings<T>(value: T): T {
  if (value === '') return null as unknown as T
  if (Array.isArray(value)) return value.map(nullifyEmptyStrings) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = nullifyEmptyStrings(v)
    }
    return out as unknown as T
  }
  return value
}

export type ParseSdsFailure = 'no_output' | 'invalid_json' | 'incomplete'

export interface ParseSdsSuccess {
  parsed:       ParsedSdsPayload
  inputTokens:  number | undefined
  outputTokens: number | undefined
}

export type ParseSdsResult =
  | { ok: true;  value: ParseSdsSuccess }
  | { ok: false; failure: ParseSdsFailure; stopReason?: string | null; contentTypes?: string[] }

/**
 * Send a base64-encoded SDS PDF to Claude and return a validated payload.
 *
 * The caller supplies the Anthropic client (so per-tenant keys + the existing
 * error mapping stay at the route boundary) and is responsible for logging
 * the invocation and persisting the result.
 */
export async function parseSdsDocument(
  client:    Anthropic,
  pdfBase64: string,
): Promise<ParseSdsResult> {
  const response = await client.messages.create({
    model:      PARSE_SDS_MODEL,
    max_tokens: 16000,
    thinking:   { type: 'adaptive' },
    system:     SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        },
        {
          type: 'text',
          text: 'Extract the SDS into the supplied JSON schema. Return JSON only.',
        },
      ],
    }],
    output_config: {
      format: { type: 'json_schema', schema: PARSE_SCHEMA },
    },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return {
      ok: false,
      failure: 'no_output',
      stopReason: response.stop_reason,
      contentTypes: response.content.map(b => b.type),
    }
  }

  let parsed: ParsedSdsPayload
  try {
    parsed = nullifyEmptyStrings(JSON.parse(textBlock.text) as ParsedSdsPayload)
  } catch {
    return { ok: false, failure: 'invalid_json' }
  }

  if (!parsed.product_name || !parsed.confidence) {
    return { ok: false, failure: 'incomplete' }
  }

  return {
    ok: true,
    value: {
      parsed,
      inputTokens:  response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    },
  }
}

// Map the model's self-rated overall confidence to the numeric
// parse_confidence column. Worst-case 0 for an unrecognized value.
export function parsedConfidenceToNumeric(
  overall: 'high' | 'medium' | 'low',
): number {
  return ({ high: 1, medium: 0.66, low: 0.33 } as const)[overall] ?? 0
}
