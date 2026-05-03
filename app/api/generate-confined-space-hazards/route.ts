import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

const client = new Anthropic()

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
1. Tailor to THIS space — generic lists don't help anyone. Cite the space's type, classification, dept, and any visible details from photos.
2. Be SPECIFIC. "PPE required" → unacceptable. "Tyvek QC125 chemical-resistant suit + nitrile gloves" → acceptable.
3. Reference visible equipment in attached photos (manways, disconnects, drains, agitator shafts, CIP connections).
4. Cite hazards that follow from the space TYPE even if not stated:
   - Silos → dust explosion (LEL), engulfment, O2 deficiency from biological respiration
   - Fermenters → CO2 displacement, residual ethanol vapors
   - CIP-served vessels → residual caustic at 140-180°F, peracetic acid vapors
   - Sumps/drains → H2S from organic decomp, biohazard
5. Order isolation steps so atmospheric isolation comes AFTER process and
   energy isolation — otherwise ventilation can mobilize trapped vapors.
6. When uncertain, propose the conservative configuration and flag the
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
  equip_photo_url?:    string | null
  interior_photo_url?: string | null
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
  try {
    const body = (await req.json()) as RequestBody

    if (!body.space_id || !body.description || !body.space_type) {
      return NextResponse.json({ error: 'space_id, description, and space_type are required' }, { status: 400 })
    }

    const userContent: Anthropic.ContentBlockParam[] = []

    // Photos massively improve hazard ID — interior shots especially because
    // residue, agitator shafts, drain configuration, and visible chemical
    // staining are all there to be seen. Both URLs are public Supabase
    // storage links, so the API can fetch directly.
    if (body.equip_photo_url) {
      userContent.push({
        type:   'image',
        source: { type: 'url', url: body.equip_photo_url },
      })
    }
    if (body.interior_photo_url) {
      userContent.push({
        type:   'image',
        source: { type: 'url', url: body.interior_photo_url },
      })
    }

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
      text: `Propose hazards, isolation steps, equipment, and rescue gear for this confined space entry permit. If photos are attached, identify visible disconnects, drains, manways, agitator shafts, CIP connections, and chemical residues, and reference them in your output.\n\n${brief}`,
    })

    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 16000,
      thinking:   { type: 'adaptive' },
      system:     SYSTEM_PROMPT,
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

    return NextResponse.json(parsed)
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/generate-confined-space-hazards' } })
    console.error('[generate-confined-space-hazards]', err)
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'AI is rate-limited. Retry in a minute.' }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI error ${err.status}: ${err.message}` }, { status: 502 })
    }
    return NextResponse.json({ error: 'Generation failed.' }, { status: 500 })
  }
}
