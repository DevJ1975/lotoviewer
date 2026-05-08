import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'

// Anthropic client comes from the shared lib/ai/client wrapper so
// every AI route inherits the same timeout, retry, and key-handling
// posture. The wrapper resolves the tenant override (or env fallback)
// and throws typed errors when the configuration is wrong — those map
// to 502/503 responses via aiErrorToResponse.
const MODEL = MODEL_BY_SURFACE['generate-loto-steps']

// LOTO is safety-critical — OSHA 29 CFR 1910.147 governs authoring standards.
// The prompt names concrete food-production equipment classes so the model
// doesn't default to generic industrial examples, and enumerates the stored-
// energy sources technicians most often miss (capacitors, trapped pneumatic
// volume, CIP chemical/thermal energy). "Qualified personnel must review"
// is surfaced in the UI — the model is not allowed to act as the authority.
const SYSTEM_PROMPT = `You are a LOTO (Lockout/Tagout) procedure author for food production equipment, trained on OSHA 29 CFR 1910.147 and ANSI/ASSP Z244.1. You draft procedures that a qualified safety professional will review and sign off on — never the authoritative final version.

FOOD-PRODUCTION CONTEXT
Common equipment: mixers, kneaders, conveyors, fillers, cappers, seal checkers, sealers, depalletizers, palletizers, bottle washers, tunnel pasteurizers, ovens, fryers, extruders, formers, slicers, grinders, CIP (clean-in-place) stations.

ENERGY SOURCE CODES (use exactly these single- or two-letter codes):
- E  Electrical — mains disconnects, VFD isolators, control panel breakers
- G  Gas — natural gas to ovens/fryers/steam generators
- H  Hydraulic — accumulators, rams, forming heads, stored pressure in hoses
- P  Pneumatic — compressed air supplying actuators, sealers, pick-and-place
- N  None — document only when a source formally needs to be declared absent
- O  Mechanical — gravity loads, stored kinetic energy, spring-loaded guards, vertical conveyors, weighted doors
- OG Compressed Gas — CO2, N2, argon (carbonators, modified-atmosphere packaging)

RULES
1. Emit one step per INDEPENDENT energy source. A 480 V line + pneumatic supply = two steps, not one.
2. Name the specific device and its location in tag_description (e.g., "Main disconnect — Panel PDB-5", "Pneumatic FRL at rear service door"). Generic labels like "Disconnect" or "Air supply" are unacceptable.
3. isolation_procedure must include the physical action, the lock/tag attachment point, and any bleed/release step for stored energy. "Turn off and lock" is never sufficient.
4. method_of_verification must be a concrete zero-energy test the technician performs before work begins (meter reading, attempted start, gauge check, visual confirmation of blocking pin). Never just "Verify de-energized."
5. Flag stored energy technicians commonly miss: VFD DC bus capacitors, trapped hydraulic pressure in capped lines, residual pneumatic volume, hot CIP chemicals or steam lines, gravity loads on raised carriages.
6. When the equipment description is ambiguous about the specific configuration, propose the most common arrangement for that equipment class and state your assumption in isolation_procedure (e.g., "Assuming single 480V feed from the MCC — verify on site before use.").
7. Keep each field concise but complete — one or two short sentences. Avoid bullet characters; write in prose.`

// Strict JSON Schema for the structured output. `additionalProperties: false`
// is required on every object for the structured-outputs path to compile.
const STEPS_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      description: 'One entry per independent energy source. At least one step is required.',
      items: {
        type: 'object',
        properties: {
          energy_type: {
            type: 'string',
            enum: ['E', 'G', 'H', 'P', 'N', 'O', 'OG'],
            description: 'Energy classification code.',
          },
          tag_description: {
            type: 'string',
            description: 'The specific energy source and its physical location on the equipment.',
          },
          isolation_procedure: {
            type: 'string',
            description: 'Physical isolation steps including lock/tag attachment and any stored-energy release.',
          },
          method_of_verification: {
            type: 'string',
            description: 'Concrete zero-energy test performed before work begins.',
          },
        },
        required: ['energy_type', 'tag_description', 'isolation_procedure', 'method_of_verification'],
        additionalProperties: false,
      },
    },
  },
  required: ['steps'],
  additionalProperties: false,
} as const

interface RequestBody {
  equipment_id:    string
  description:     string
  department:      string
  notes?:          string | null
  context?:        string
}

interface GeneratedStep {
  energy_type:            string
  tag_description:        string
  isolation_procedure:    string
  method_of_verification: string
}

export async function POST(req: NextRequest) {
  // Auth gate first — burning Anthropic tokens without authentication
  // is a P0 abuse vector. Tenant-member is the right granularity:
  // anyone in the tenant can author steps; the qualified-personnel
  // review gate is enforced at sign-off, not at draft time.
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  // Rate limit before reading the body — body parsing burns no
  // Anthropic tokens but it's still better to fail fast.
  const limit = await checkAiRateLimit({
    userId:   gate.userId,
    tenantId: gate.tenantId,
    surface:  'generate-loto-steps',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  try {
    const body = (await req.json()) as RequestBody

    if (!body.equipment_id || !body.description) {
      return NextResponse.json({ error: 'equipment_id and description are required' }, { status: 400 })
    }

    const userContent: Anthropic.ContentBlockParam[] = []

    // Text-only inputs. Photo attachments were dropped per the
    // operator's call: every AI draft gets reviewed by a human anyway,
    // and the supervisor cross-checks against the actual placard +
    // disconnect locations on site, so the model "seeing" photos
    // didn't change the verification burden.

    const brief = [
      `Equipment ID: ${body.equipment_id}`,
      `Description: ${body.description}`,
      `Department: ${body.department}`,
      body.notes   ? `Public warning text on the placard: ${body.notes}` : null,
      body.context ? `Additional context from the author: ${body.context}` : null,
    ].filter(Boolean).join('\n')

    userContent.push({
      type: 'text',
      text: `Propose LOTO energy-isolation steps for this food-production equipment. Return one step per independent energy source.\n\n${brief}`,
    })

    // Resolve the Anthropic client for this tenant. Throws when the
    // env key is missing (503) or when the tenant override is mangled
    // (502) — aiErrorToResponse maps both to clear operator messages.
    let client: Anthropic
    try {
      client = await getAnthropic(gate.tenantId)
    } catch (err) {
      const mapped = aiErrorToResponse(err, 'generate-loto-steps')
      Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/generate-loto-steps' } })
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 16000,
      thinking:   { type: 'adaptive' },
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userContent }],
      output_config: {
        format: { type: 'json_schema', schema: STEPS_SCHEMA },
      },
    })

    // With json_schema output, the response is a text block containing valid
    // JSON matching the schema. Find it — there may also be a thinking block
    // earlier in content when adaptive thinking fired.
    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      console.error('[generate-loto-steps] no text block in response', {
        stop_reason: response.stop_reason,
        content_types: response.content.map(b => b.type),
      })
      return NextResponse.json({ error: 'AI returned no usable output.' }, { status: 502 })
    }

    const parsed = JSON.parse(textBlock.text) as { steps: GeneratedStep[] }

    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return NextResponse.json({ error: 'AI returned no steps.' }, { status: 502 })
    }

    await logAiInvocation({
      userId:       gate.userId,
      tenantId:     gate.tenantId,
      surface:      'generate-loto-steps',
      model:        MODEL,
      status:       'success',
      inputTokens:  response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      context:      body.equipment_id,
    })

    return NextResponse.json(parsed)
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/generate-loto-steps' } })
    console.error('[generate-loto-steps]', err)
    await logAiInvocation({
      userId:   gate.userId,
      tenantId: gate.tenantId,
      surface:  'generate-loto-steps',
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
