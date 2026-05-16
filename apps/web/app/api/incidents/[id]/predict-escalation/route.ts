import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type Anthropic from '@anthropic-ai/sdk'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { aiErrorToResponse, getAnthropic } from '@/lib/ai/client'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import type { IncidentSeverity } from '@soteria/core/incidentEscalation'

// POST /api/incidents/[id]/predict-escalation
//
// Calls Claude Haiku with the incident description and asks: did the
// reporter under-classify the severity? Persists the prediction to
// incident_predictions and returns the structured payload. The UI
// surfaces the result; nothing in this route auto-mutates the
// incident's severity.
//
// Admin-only — predictions can be noisy and an admin's the right
// reader. Rate-limited via the shared ai_invocations infra.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MODEL = MODEL_BY_SURFACE['predict-incident-escalation']
const PROMPT_VERSION = 'v1'

interface RouteContext {
  params: Promise<{ id: string }>
}

const SYSTEM_PROMPT = `You are an OSHA recordkeeping severity classifier for an EHS application.

Given an incident description (and optional injury detail), output the most appropriate severity classification from this strictly-ordered list (most serious first):

  - "catastrophic"  — multiple fatalities, major facility damage, regulatory shutdown
  - "fatality"      — a worker died
  - "lost_time"     — at least one full day away from work as a direct result
  - "medical"       — medical treatment beyond first aid
  - "first_aid"     — first aid only, no medical treatment
  - "none"          — no injury or impact

Confidence rules:
  - 0.90+ when the description states facts that map directly to a tier (e.g. "broken arm requiring surgery")
  - 0.60-0.85 when the tier is likely from context but the description is short on detail
  - <0.60 when you cannot tell — pick "none" and lower the confidence

NEVER invent facts. If the description is ambiguous, pick the lower severity and lower the confidence.

Return strict JSON matching this schema:
  {
    "predicted_severity": "catastrophic" | "fatality" | "lost_time" | "medical" | "first_aid" | "none",
    "confidence":         number between 0.0 and 1.0,
    "reasoning":          string — 1-3 sentences justifying the pick
  }`

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['predicted_severity', 'confidence', 'reasoning'],
  additionalProperties: false,
  properties: {
    predicted_severity: {
      type: 'string',
      enum: ['catastrophic', 'fatality', 'lost_time', 'medical', 'first_aid', 'none'],
    },
    // Anthropic's structured-output endpoint rejects minimum/maximum
    // on `number` — clamp server-side.
    confidence: { type: 'number', description: 'Confidence in [0, 1]; the server clamps.' },
    reasoning:  { type: 'string', description: '1-3 sentence justification.' },
  },
}

interface PredictionPayload {
  predicted_severity: IncidentSeverity
  confidence:         number
  reasoning:          string
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const limit = await checkAiRateLimit({
    userId:   gate.userId,
    tenantId: gate.tenantId,
    surface:  'predict-incident-escalation',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  try {
    const admin = supabaseAdmin()
    const { data: incident } = await admin
      .from('incidents')
      .select('id, description, location_text, severity_actual, incident_type, occurred_at')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const inc = incident as {
      id: string
      description: string
      location_text: string | null
      severity_actual: string
      incident_type: string
      occurred_at: string
    }

    const userBrief = [
      `Incident type: ${inc.incident_type}`,
      `Reporter classified severity: ${inc.severity_actual}`,
      `Location: ${inc.location_text ?? '(not specified)'}`,
      `Description:\n${inc.description}`,
    ].join('\n')

    let client: Anthropic
    try {
      client = await getAnthropic(gate.tenantId)
    } catch (err) {
      const mapped = aiErrorToResponse(err, 'predict-incident-escalation')
      Sentry.captureException(err, { tags: { ...mapped.tags, route: 'predict-escalation' } })
      return NextResponse.json(mapped.body, { status: mapped.status })
    }

    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 1024,
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
        surface: 'predict-incident-escalation',
        status: 'error', model: MODEL,
        context: 'no text block in response',
      })
      return NextResponse.json({ error: 'AI returned no usable output.' }, { status: 502 })
    }

    let parsed: PredictionPayload
    try {
      parsed = JSON.parse(textBlock.text) as PredictionPayload
    } catch {
      await logAiInvocation({
        userId: gate.userId, tenantId: gate.tenantId,
        surface: 'predict-incident-escalation',
        status: 'error', model: MODEL,
        context: 'JSON parse failed',
      })
      return NextResponse.json({ error: 'AI returned malformed JSON.' }, { status: 502 })
    }

    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0))

    // Persist for audit + future A/B comparisons.
    const { data: row, error: insertErr } = await admin
      .from('incident_predictions')
      .insert({
        tenant_id:          gate.tenantId,
        incident_id:        incidentId,
        predicted_severity: parsed.predicted_severity,
        confidence,
        model:              MODEL,
        prompt_version:     PROMPT_VERSION,
        raw_response:       parsed,
      })
      .select('id, predicted_severity, confidence, model, prompt_version, predicted_at, raw_response')
      .single()
    if (insertErr) {
      Sentry.captureException(insertErr, { tags: { route: 'predict-escalation', stage: 'persist' } })
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await logAiInvocation({
      userId: gate.userId, tenantId: gate.tenantId,
      surface: 'predict-incident-escalation',
      status:  'success', model: MODEL,
      inputTokens:  response.usage?.input_tokens  ?? undefined,
      outputTokens: response.usage?.output_tokens ?? undefined,
    })

    return NextResponse.json({
      prediction: {
        ...row,
        reasoning: parsed.reasoning,
      },
      current_severity: inc.severity_actual,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'predict-escalation' } })
    await logAiInvocation({
      userId: gate.userId, tenantId: gate.tenantId,
      surface: 'predict-incident-escalation',
      status: 'error', model: MODEL,
      context: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
