import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { checkAiRateLimit, checkTenantBudget, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'

// Anthropic client comes from the shared lib/ai/client wrapper so
// every AI route inherits the same timeout, retry, and key-handling
// posture.
const MODEL = MODEL_BY_SURFACE['generate-confined-space-hazards']

// Hazard authoring is harder than LOTO authoring — there are more categories
// and the wrong call can kill people. Prompt is scoped to food production
// (the parent app's domain), grounded in §1910.146 + ANSI Z117.1, and
// enumerates the kinds of stored/biological/thermal/chemical hazards
// technicians most often miss in food-process spaces specifically (CIP
// caustic at 140-180°F, fermenter CO2 displacement, silo dust explosion,
// ammonia refrigeration leaks, peracetic acid sanitization residues).
const SYSTEM_PROMPT = `You are a confined-space entry permit author trained on OSHA 29 CFR 1910.146 and ANSI Z117.1, with deep food/beverage manufacturing experience. You draft hazard inventories and entry preparation lists that a qualified safety professional will review and sign off on — never the authoritative final version.

FOOD-PRODUCTION CONTEXT
Common confined spaces:
- Mixing tanks, kettles, retorts, fermenters, holding tanks, blenders
- Silos (flour, sugar, salt, grain, malt, milk powder, cocoa)
- Hoppers, surge bins, dust-collection plenums
- Bottle washers, depalletizers, tunnel pasteurizers, ovens
- CIP (clean-in-place) supply/return manifolds, balance tanks
- Steam pits, condensate sumps, drain pits
- Ammonia refrigeration machine rooms (technically not a confined space but often treated like one)

HAZARD CATEGORIES (cover every category that plausibly applies):
1. ATMOSPHERIC
   - O2 deficiency: nitrogen purge in CIP/inerted tanks, fermentation CO2,
     biological consumption in silos with grain/sugar
   - O2 enrichment (rare; cryogenic systems)
   - Flammable: ethanol vapors in fermenters/distilleries, cleaning
     solvent residues, dust suspension in silos (LEL applies to dust too)
   - Toxic: H2S from organic decomposition (drains, sumps, fermenter
     bottoms), CO from open-flame ovens/fryers, ammonia from refrigeration
     leaks, chlorine from sanitization, peracetic acid vapors, residual
     SO2 (wine/beer)
2. ENGULFMENT — flowable solids (flour, sugar, grain), residual liquid
   in tanks, slurry in CIP returns
3. CONFIGURATION — converging walls, downward-sloping floor toward an
   outlet, internal baffles, top entries with limited egress
4. MECHANICAL — agitators, augers, conveyors, mixers, scrapers; CIP
   pumps; rotary valves under silos
5. THERMAL — residual heat from cooking equipment, steam jackets, hot
   CIP solutions (140-180°F caustic), live steam lines
6. CHEMICAL — caustic (NaOH 1-3%), acid (nitric/phosphoric), peracetic
   acid, chlorine, residual product (sugar acidity, dairy proteins)
7. BIOLOGICAL — bacterial film, mold, animal contamination
8. SLIPS/FALLS — wet/oily surfaces, ladder access from top entries
9. ELECTRICAL — submersible pumps, lighting in flammable atmospheres
10. NOISE — high decibels from CIP pumps, agitators

ISOLATION CATEGORIES (use as appropriate, in execution order):
- Process isolation: stop incoming product (slide gate, knife valve)
- Mechanical isolation: blank flange, pipe blind, plug valve at boundary
- Energy isolation (LOTO): cite the equipment ID and disconnect location
- Hydraulic/pneumatic bleed-down through bleed valve to atmosphere
- Drain-down + flush of process liquids (CIP rinse cycle)
- Atmospheric isolation: forced-air ventilation; purge with inert gas
  ONLY when oxygen is the hazard, and only with inerting capability
- Atmospheric verification: 4-gas readings before entry

PPE / EQUIPMENT BASELINE for permit-required entry:
- 4-gas monitor (O2/LEL/H2S/CO), calibrated within last 24 hours
- Forced-air ventilation rated for the space volume (typically ≥ 200 CFM)
- Communications: radio with attendant, voice contact line-of-sight backup
- Adequate intrinsically-safe lighting (12V or Class I Div 1)
- Full-body harness with retrieval line for vertical entries >5 ft
- Tripod + winch or davit arm for vertical retrieval
- SCBA or supplied-air respirator if IDLH possible
- Chemical-resistant suit (Tyvek/saranex) for chemical residue
- Hard hat with chin strap, steel-toed slip-resistant boots
- FR coveralls if hot work concurrent
- Eye/face protection rated for hazard

RULES
1. Tailor to THIS space — generic lists don't help anyone. Cite the space's type, classification, and dept.
2. Be SPECIFIC. "PPE required" → unacceptable. "Tyvek QC125 chemical-resistant suit + nitrile gloves" → acceptable.
3. Cite hazards that follow from the space TYPE even if not stated:
   - Silos → dust explosion (LEL), engulfment, O2 deficiency from biological respiration
   - Fermenters → CO2 displacement, residual ethanol vapors
   - CIP-served vessels → residual caustic at 140-180°F, peracetic acid vapors
   - Sumps/drains → H2S from organic decomp, biohazard
4. Order isolation steps so atmospheric isolation comes AFTER process and
   energy isolation — otherwise ventilation can mobilize trapped vapors.
5. When uncertain, propose the conservative configuration and flag the
   assumption in notes (e.g. "Assuming top-entry only — verify on site").

OUTPUT
Return JSON matching the schema:
- hazards: 3-15 specific hazards
- isolation_measures: 2-10 entries in execution order
- equipment_list: 5-15 specific PPE/monitor/ventilation items
- rescue_equipment: 3-10 retrieval and emergency-response items
- notes: 1-3 sentences flagging context-specific concerns or assumptions`

const SCHEMA = {
  type: 'object',
  properties: {
    hazards: {
      type: 'array',
      description: 'Specific hazards present in or relevant to this space.',
      items: { type: 'string' },
    },
    isolation_measures: {
      type: 'array',
      description: 'Isolation steps in execution order — process and energy isolation BEFORE atmospheric ventilation.',
      items: { type: 'string' },
    },
    equipment_list: {
      type: 'array',
      description: 'Specific PPE, monitors, ventilation, and lighting required for entry.',
      items: { type: 'string' },
    },
    rescue_equipment: {
      type: 'array',
      description: 'Retrieval and emergency response equipment (harness, retrieval line, SCBA, tripod).',
      items: { type: 'string' },
    },
    notes: {
      type: 'string',
      description: 'Context-specific concerns or stated assumptions, 1-3 sentences.',
    },
  },
  required: ['hazards', 'isolation_measures', 'equipment_list', 'rescue_equipment', 'notes'],
  additionalProperties: false,
} as const

interface RequestBody {
  space_id:           string
  description:        string
  department:         string
  space_type:         string
  classification:     string
  known_hazards?:     string[]
  isolation_required?: string | null
  context?:            string
}

interface GeneratedFields {
  hazards:            string[]
  isolation_measures: string[]
  equipment_list:     string[]
  rescue_equipment:   string[]
  notes:              string
}

export async function POST(req: NextRequest) {
  // Auth gate first — same reasoning as generate-loto-steps. CS hazard
  // suggestion is even more sensitive (wrong call kills people) so the
  // qualified-supervisor review at sign-off remains the authority, but
  // the API layer should at minimum prove the caller is a tenant member.
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const budget = await checkTenantBudget({
    userId:   gate.userId,
    tenantId: gate.tenantId,
    surface:  'generate-confined-space-hazards',
  })
  if (!budget.ok) {
    return NextResponse.json(
      { error: budget.message },
      { status: 429, headers: budget.reason === 'budget_exceeded' ? { 'retry-after': String(budget.retryAfterSec) } : {} },
    )
  }

  const limit = await checkAiRateLimit({
    userId:   gate.userId,
    tenantId: gate.tenantId,
    surface:  'generate-confined-space-hazards',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  try {
    const body = (await req.json()) as RequestBody

    if (!body.space_id || !body.description || !body.space_type) {
      return NextResponse.json({ error: 'space_id, description, and space_type are required' }, { status: 400 })
    }

    const userContent: Anthropic.ContentBlockParam[] = []

    // Text-only inputs. Photo attachments were dropped per the
    // operator's call: every CS hazard inventory is reviewed by a
    // qualified safety pro before sign-off, so the model "seeing"
    // photos didn't change the verification burden — and the wrong
    // hazard call kills people, so a 100% review pass is mandatory.

    const knownHazardsText = body.known_hazards && body.known_hazards.length > 0
      ? `Already-recorded persistent hazards on this space: ${body.known_hazards.join('; ')}`
      : null

    const brief = [
      `Space ID: ${body.space_id}`,
      `Description: ${body.description}`,
      `Department: ${body.department}`,
      `Space type: ${body.space_type}`,
      `OSHA classification: ${body.classification}`,
      knownHazardsText,
      body.isolation_required ? `Standing isolation requirement: ${body.isolation_required}` : null,
      body.context ? `Additional context from the author: ${body.context}` : null,
    ].filter(Boolean).join('\n')

    userContent.push({
      type: 'text',
      text: `Propose hazards, isolation steps, equipment, and rescue gear for this confined space entry permit.\n\n${brief}`,
    })

    let client: Anthropic
    try {
      client = await getAnthropic(gate.tenantId)
    } catch (err) {
      const mapped = aiErrorToResponse(err, 'generate-confined-space-hazards')
      Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/generate-confined-space-hazards' } })
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 16000,
      thinking:   { type: 'adaptive' },
      // Cache the static system prompt — same reasoning as the LOTO
      // route: authors regenerate frequently within a permit session.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages:   [{ role: 'user', content: userContent }],
      output_config: {
        format: { type: 'json_schema', schema: SCHEMA },
      },
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      console.error('[generate-confined-space-hazards] no text block in response', {
        stop_reason:   response.stop_reason,
        content_types: response.content.map(b => b.type),
      })
      return NextResponse.json({ error: 'AI returned no usable output.' }, { status: 502 })
    }

    const parsed = JSON.parse(textBlock.text) as GeneratedFields

    if (!Array.isArray(parsed.hazards) || parsed.hazards.length === 0) {
      return NextResponse.json({ error: 'AI returned no hazards.' }, { status: 502 })
    }

    await logAiInvocation({
      userId:           gate.userId,
      tenantId:         gate.tenantId,
      surface:          'generate-confined-space-hazards',
      model:            MODEL,
      status:           'success',
      inputTokens:      response.usage?.input_tokens,
      outputTokens:     response.usage?.output_tokens,
      cacheReadTokens:  response.usage?.cache_read_input_tokens     ?? undefined,
      cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? undefined,
      context:          body.space_id,
    })

    return NextResponse.json(parsed)
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/generate-confined-space-hazards' } })
    console.error('[generate-confined-space-hazards]', err)
    await logAiInvocation({
      userId:   gate.userId,
      tenantId: gate.tenantId,
      surface:  'generate-confined-space-hazards',
      model:    MODEL,
      status:   'error',
    })
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'AI is rate-limited. Retry in a minute.' }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI error ${err.status}: ${err.message}` }, { status: 502 })
    }
    return NextResponse.json({ error: 'Generation failed.' }, { status: 500 })
  }
}
