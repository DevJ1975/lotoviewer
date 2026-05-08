import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import Anthropic from '@anthropic-ai/sdk'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getTenantApiKey } from '@/lib/ai/getTenantApiKey'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'

// POST /api/incidents/[id]/classify/ai-suggest
//
// Hands the incident description + injury detail to Claude Haiku
// and asks for a suggested OSHA 1904.7 classification + confidence
// + brief reasoning. NEVER auto-writes — the response is returned
// to the wizard which surfaces it as a hint the human can accept,
// adjust, or override (with a recorded override_reason).
//
// Admin-only (same gate as POST /classify), rate-limited to 30/hr
// per user. Logs every invocation through the existing
// ai_invocations audit table so superadmins can see token spend.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MODEL = MODEL_BY_SURFACE['classify-recordability']

interface RouteContext {
  params: Promise<{ id: string }>
}

const SYSTEM_PROMPT = `You are an OSHA recordkeeping classifier assistant for an EHS application. The user supplies an incident description plus optional injury detail. You apply 29 CFR 1904.7 to suggest the appropriate classification.

Available classifications (pick ONE):
  - "death"             — case resulted in death
  - "days_away"         — case resulted in days away from work
  - "restricted"        — case resulted in restricted work or job transfer
  - "other_recordable"  — recordable but doesn't meet death/days_away/restricted (e.g. medical treatment beyond first aid, loss of consciousness, significant diagnosed condition)
  - null                — not recordable (work-related but doesn't meet recording criteria, OR not work-related, OR continuation of an existing case)

Use the OSHA "most serious wins" rule: pick the highest-severity classification supported by the facts.

Return strict JSON matching this schema:
  {
    "classification": "death" | "days_away" | "restricted" | "other_recordable" | null,
    "confidence":     number between 0.0 and 1.0,
    "reasoning":      string — 2-4 sentences citing the OSHA criteria you applied,
    "missing_info":   array of strings — what additional facts would change or sharpen the classification
  }

Confidence rules:
  - 0.90+ when the description clearly states facts that map to a specific classification (e.g. "worker missed 3 days of work")
  - 0.50-0.80 when the classification is likely but the description omits a relevant detail
  - <0.50 when you genuinely cannot tell — set classification to null and put the questions in missing_info

NEVER fabricate facts. If a needed fact (e.g. days away, treatment received) isn't in the description, list it in missing_info — don't guess.`

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['classification', 'confidence', 'reasoning', 'missing_info'],
  additionalProperties: false,
  properties: {
    classification: {
      anyOf: [
        { type: 'string', enum: ['death', 'days_away', 'restricted', 'other_recordable'] },
        { type: 'null' },
      ],
    },
    // Confidence in [0, 1]. We do NOT use the JSON-schema `minimum` /
    // `maximum` keywords here because Anthropic's structured-output
    // endpoint rejects them ("output_config.format.schema: For 'number'
    // type, properties maximum, minimum are not supported"). The
    // intent is conveyed via the description, and the route handler
    // clamps to [0, 1] server-side after parsing (see line ~187).
    confidence:   { type: 'number', description: 'Confidence in [0, 1]; the server clamps any out-of-range values.' },
    // Same reason: `minLength` is not supported on the Anthropic
    // structured-output schema. The handler treats empty reasoning as
    // a soft failure (renders blank).
    reasoning:    { type: 'string', description: 'One- to two-sentence justification. Required.' },
    missing_info: { type: 'array', items: { type: 'string' } },
  },
}

interface SuggestResponse {
  classification: 'death' | 'days_away' | 'restricted' | 'other_recordable' | null
  confidence:     number
  reasoning:      string
  missing_info:   string[]
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  // Rate limit BEFORE the body parse — the body is small but the
  // rate limit costs no Anthropic tokens and protects us from
  // bot loops.
  const limit = await checkAiRateLimit({
    userId:   gate.userId,
    tenantId: gate.tenantId,
    surface:  'classify-recordability',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  try {
    // Pull the incident + (if present) the primary injured person.
    const admin = supabaseAdmin()
    const { data: incident } = await admin
      .from('incidents')
      .select('id, incident_type, occurred_at, description, location_text, severity_actual')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const { data: person } = await admin
      .from('incident_people')
      .select('full_name, body_part, injury_nature, injury_source, treatment_facility')
      .eq('incident_id', incidentId)
      .eq('person_role', 'injured')
      .eq('is_primary', true)
      .maybeSingle()

    const { data: care } = await admin
      .from('incident_care_cases')
      .select('days_away_from_work, days_restricted, days_lost, diagnosis')
      .eq('incident_id', incidentId)
      .maybeSingle()

    const inc = incident as {
      incident_type: string; occurred_at: string; description: string;
      location_text: string | null; severity_actual: string;
    }
    const personRow = person as { body_part: string[] | null; injury_nature: string | null;
      injury_source: string | null; treatment_facility: string | null } | null
    const careRow = care as { days_away_from_work: number; days_restricted: number;
      days_lost: number; diagnosis: string | null } | null

    const userBrief = [
      `Incident type: ${inc.incident_type}`,
      `Severity (intake estimate): ${inc.severity_actual}`,
      `Location: ${inc.location_text ?? '(not specified)'}`,
      `Description:\n${inc.description}`,
      personRow?.body_part?.length ? `Body part(s): ${personRow.body_part.join(', ')}` : null,
      personRow?.injury_nature     ? `Injury nature: ${personRow.injury_nature}` : null,
      personRow?.injury_source     ? `Source: ${personRow.injury_source}` : null,
      personRow?.treatment_facility ? `Treatment facility: ${personRow.treatment_facility}` : null,
      careRow?.diagnosis           ? `Diagnosis: ${careRow.diagnosis}` : null,
      careRow ? `Days counters: ${careRow.days_away_from_work} away · ${careRow.days_restricted} restricted · ${careRow.days_lost} lost` : null,
    ].filter(Boolean).join('\n')

    // Short-circuit when no API key is configured — clearer 503
    // than the SDK's opaque 401 from a missing key.
    const apiKey = await getTenantApiKey(gate.tenantId)
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI is not configured for this deployment. Contact your administrator.' },
        { status: 503 },
      )
    }
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userBrief }],
      output_config: {
        format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
      },
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      await logAiInvocation({
        userId: gate.userId, tenantId: gate.tenantId,
        surface: 'classify-recordability',
        status: 'error', model: MODEL,
        context: 'no text block in response',
      })
      return NextResponse.json({ error: 'AI returned no usable output.' }, { status: 502 })
    }

    let parsed: SuggestResponse
    try {
      parsed = JSON.parse(textBlock.text) as SuggestResponse
    } catch {
      await logAiInvocation({
        userId: gate.userId, tenantId: gate.tenantId,
        surface: 'classify-recordability',
        status: 'error', model: MODEL,
        context: 'JSON parse failed',
      })
      return NextResponse.json({ error: 'AI returned malformed JSON.' }, { status: 502 })
    }

    // Normalise: clamp confidence, ensure missing_info is array of
    // strings, drop empties.
    const conf = Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
    const missing = Array.isArray(parsed.missing_info)
      ? parsed.missing_info.map(s => String(s).trim()).filter(Boolean)
      : []

    await logAiInvocation({
      userId: gate.userId, tenantId: gate.tenantId,
      surface: 'classify-recordability',
      status: 'success', model: MODEL,
      inputTokens:  response.usage?.input_tokens  ?? undefined,
      outputTokens: response.usage?.output_tokens ?? undefined,
    })

    return NextResponse.json({
      suggestion: {
        classification: parsed.classification ?? null,
        confidence:     conf,
        reasoning:      String(parsed.reasoning ?? ''),
        missing_info:   missing,
      },
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'classify/ai-suggest' } })
    await logAiInvocation({
      userId: gate.userId, tenantId: gate.tenantId,
      surface: 'classify-recordability',
      status: 'error', model: MODEL,
      context: e instanceof Error ? e.message : String(e),
    })
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
