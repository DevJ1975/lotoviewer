import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'
import {
  GHS_PICTOGRAMS,
  GHS_SIGNAL_WORDS,
  PHYSICAL_STATES,
  type ParsedSdsPayload,
} from '@soteria/core/chemicals'

// POST /api/chemicals/products/[id]/sds/[sdsId]/parse
//
// Reads the SDS PDF for {sdsId} from the chemical-sds bucket, sends it
// to Claude Sonnet with a strict JSON schema, and writes the parsed
// payload back to chemical_sds_documents.parsed_payload (along with
// model, confidence, and parse_review_status='pending').
//
// The endpoint never modifies the chemical_products row directly — that
// happens via the sibling /apply endpoint after a human approves the
// proposed fields. This keeps "what the AI suggested" and "what the
// safety lead approved" cleanly separated for audit.

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL    = MODEL_BY_SURFACE['parse-sds']
const MAX_PDF_BYTES = 25_000_000

interface Ctx { params: Promise<{ id: string; sdsId: string }> }

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
3. NEVER invent values. If a field is not in the SDS, return null
   (or an empty array for list fields). Do NOT guess.
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
    manufacturer:    { type: ['string', 'null'] },
    product_code:    { type: ['string', 'null'] },
    recommended_use: { type: ['string', 'null'] },
    emergency_phone: { type: ['string', 'null'] },

    cas_numbers: { type: 'array', items: { type: 'string' } },
    synonyms:    { type: 'array', items: { type: 'string' } },

    physical_state: {
      anyOf: [
        { type: 'string', enum: [...PHYSICAL_STATES] },
        { type: 'null' },
      ],
    },
    appearance:         { type: ['string', 'null'] },
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

    nfpa_health:       { type: ['integer', 'null'], minimum: 0, maximum: 4 },
    nfpa_flammability: { type: ['integer', 'null'], minimum: 0, maximum: 4 },
    nfpa_instability:  { type: ['integer', 'null'], minimum: 0, maximum: 4 },
    nfpa_special:      { type: ['string', 'null'] },

    pel_twa_ppm:  { type: ['number', 'null'] },
    stel_ppm:     { type: ['number', 'null'] },
    idlh_ppm:     { type: ['number', 'null'] },
    ppe_required: { type: 'array', items: { type: 'string' } },

    first_aid: {
      type: 'object',
      additionalProperties: false,
      required: ['inhalation', 'skin', 'eyes', 'ingestion', 'notes'],
      properties: {
        inhalation: { type: ['string', 'null'] },
        skin:       { type: ['string', 'null'] },
        eyes:       { type: ['string', 'null'] },
        ingestion:  { type: ['string', 'null'] },
        notes:      { type: ['string', 'null'] },
      },
    },
    firefighting: {
      type: 'object',
      additionalProperties: false,
      required: ['suitable_extinguishers', 'unsuitable_extinguishers', 'special_hazards', 'protective_equipment'],
      properties: {
        suitable_extinguishers:   { type: 'array', items: { type: 'string' } },
        unsuitable_extinguishers: { type: 'array', items: { type: 'string' } },
        special_hazards:          { type: ['string', 'null'] },
        protective_equipment:     { type: ['string', 'null'] },
      },
    },
    spill_cleanup: {
      type: 'object',
      additionalProperties: false,
      required: ['personal_precautions', 'environmental_precautions', 'containment_methods', 'cleanup_methods'],
      properties: {
        personal_precautions:      { type: ['string', 'null'] },
        environmental_precautions: { type: ['string', 'null'] },
        containment_methods:       { type: ['string', 'null'] },
        cleanup_methods:           { type: ['string', 'null'] },
      },
    },

    storage_class:     { type: ['string', 'null'] },
    incompatibilities: { type: 'array', items: { type: 'string' } },

    dot_un_number:     { type: ['string', 'null'] },
    dot_hazard_class:  { type: ['string', 'null'] },
    dot_packing_group: { type: ['string', 'null'] },

    sds_revision_date: { type: ['string', 'null'] },
    sds_language:      { type: ['string', 'null'] },

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
    parser_notes: { type: ['string', 'null'] },
  },
} as const

export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const tenantId = gate.tenantId
  const userId   = gate.userId

  const { id: productId, sdsId } = await ctx.params
  if (!UUID_RE.test(productId) || !UUID_RE.test(sdsId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const limit = await checkAiRateLimit({
    userId, tenantId, surface: 'parse-sds',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  try {
    const admin = supabaseAdmin()

    const { data: sds, error: sErr } = await admin
      .from('chemical_sds_documents')
      .select('id, storage_path, file_bytes, product_id, tenant_id')
      .eq('id', sdsId)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .maybeSingle()
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!sds) return NextResponse.json({ error: 'SDS not found' }, { status: 404 })

    if (sds.file_bytes && sds.file_bytes > MAX_PDF_BYTES) {
      return NextResponse.json({
        error: `SDS PDF too large to parse (${(sds.file_bytes / 1_000_000).toFixed(1)} MB > ${MAX_PDF_BYTES / 1_000_000} MB)`,
      }, { status: 413 })
    }

    const { data: blob, error: dlErr } = await admin
      .storage
      .from('chemical-sds')
      .download(sds.storage_path)
    if (dlErr || !blob) {
      return NextResponse.json({ error: dlErr?.message ?? 'Failed to download SDS' }, { status: 500 })
    }

    const buf = Buffer.from(await blob.arrayBuffer())
    const base64 = buf.toString('base64')

    let client: Anthropic
    try {
      client = await getAnthropic(tenantId)
    } catch (err) {
      const mapped = aiErrorToResponse(err, 'parse-sds')
      Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/chemicals/products/sds/parse' } })
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 16000,
      thinking:   { type: 'adaptive' },
      system:     SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type:       'base64',
              media_type: 'application/pdf',
              data:       base64,
            },
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
      console.error('[parse-sds] no text block in response', {
        stop_reason:   response.stop_reason,
        content_types: response.content.map(b => b.type),
      })
      await logAiInvocation({
        userId, tenantId, surface: 'parse-sds', model: MODEL, status: 'error',
        context: sdsId,
      })
      return NextResponse.json({ error: 'AI returned no usable output.' }, { status: 502 })
    }

    let parsed: ParsedSdsPayload
    try {
      parsed = JSON.parse(textBlock.text) as ParsedSdsPayload
    } catch {
      await logAiInvocation({
        userId, tenantId, surface: 'parse-sds', model: MODEL, status: 'error',
        context: sdsId,
      })
      return NextResponse.json({ error: 'AI returned invalid JSON.' }, { status: 502 })
    }

    if (!parsed.product_name || !parsed.confidence) {
      await logAiInvocation({
        userId, tenantId, surface: 'parse-sds', model: MODEL, status: 'error',
        context: sdsId,
      })
      return NextResponse.json({ error: 'AI returned an incomplete payload.' }, { status: 502 })
    }

    const numericConfidence = ({ high: 1, medium: 0.66, low: 0.33 } as const)[parsed.confidence.overall] ?? 0
    const reviewStatus: 'pending' | 'approved' = 'pending'

    const { data: updated, error: upErr } = await admin
      .from('chemical_sds_documents')
      .update({
        parsed_payload:      parsed,
        parse_model:         MODEL,
        parse_confidence:    numericConfidence,
        parse_review_status: reviewStatus,
      })
      .eq('id',        sdsId)
      .eq('tenant_id', tenantId)
      .select('id, parse_model, parse_confidence, parse_review_status')
      .single()
    if (upErr) {
      await logAiInvocation({
        userId, tenantId, surface: 'parse-sds', model: MODEL, status: 'error',
        context: sdsId,
      })
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    await logAiInvocation({
      userId, tenantId, surface: 'parse-sds', model: MODEL, status: 'success',
      inputTokens:  response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      context:      sdsId,
    })

    return NextResponse.json({
      sds:    updated,
      parsed,
    }, { status: 200 })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/chemicals/sds/parse' } })
    console.error('[parse-sds]', err)
    await logAiInvocation({
      userId, tenantId, surface: 'parse-sds', model: MODEL, status: 'error',
      context: sdsId,
    })
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'AI is rate-limited. Retry in a minute.' }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI error ${err.status}: ${err.message}` }, { status: 502 })
    }
    return NextResponse.json({ error: 'Parse failed.' }, { status: 500 })
  }
}
