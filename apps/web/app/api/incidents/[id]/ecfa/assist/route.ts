import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type Anthropic from '@anthropic-ai/sdk'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { aiErrorToResponse, getAnthropic } from '@/lib/ai/client'
import { checkAiRateLimit, checkTenantBudget, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { CAUSAL_FACTOR_CATEGORIES, type EcfaNodeRow } from '@soteria/core/ecfaSchemas'

// An AI route's worst case is `timeout x (retries + 1)`, and it must fit
// inside maxDuration or the platform kills the function mid-flight and the
// caller gets a raw 504 rather than any error this code produces. This route
// asks for up to 1,800 tokens,
// and previously declared no ceiling at all — so it inherited the platform
// default, which is far shorter than a single model call.
export const maxDuration = 60

// POST /api/incidents/[id]/ecfa/assist
//
// AI co-pilot for the Events & Causal Factors Analysis. Two modes:
//   - draft_sequence          → drafts an ordered event sequence (+ candidate
//                               conditions) from the incident narrative.
//   - suggest_causal_factors  → given the current chart, proposes which
//                               nodes are causal factors (with coding) and
//                               flags presumptive items still lacking proof.
//
// CRITICAL: nothing here mutates the chart. It re-reads the incident +
// investigation + existing ECFA nodes SERVER-SIDE, returns suggestions, and
// logs the proposal to incident_ecfa_ai_suggestions. The human accepts each
// suggestion through the normal ECFA POSTs (which stamp ai_origin /
// ai_edited). Admin-only, budget- + rate-limited.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL   = MODEL_BY_SURFACE['ecfa-assist']
const SURFACE = 'ecfa-assist' as const

const ASSIST_MODES = ['draft_sequence', 'suggest_causal_factors'] as const
type AssistMode = typeof ASSIST_MODES[number]

interface RouteContext {
  params: Promise<{ id: string }>
}

const SYSTEM_PROMPT = `You are an incident-investigation facilitator for an industrial EHS platform, helping build an Events & Causal Factors Analysis (ECFA).

An ECFA tells the story of an incident as a chronological chain of EVENTS (discrete actions/happenings) with CONDITIONS (states/circumstances) that shaped them, ending in the loss. You then identify the CAUSAL FACTORS — the events or conditions that, if eliminated, would have prevented the incident or reduced its severity.

Conventions you must follow:
- Write each event as ONE subject + ONE action verb, active voice, past tense, factual and specific (e.g. "Operator opened guard door", not "Safety was compromised").
- Conditions are states, not actions (e.g. "Guard interlock bypassed", "Lighting was poor").
- Only use the facts provided. Do NOT invent times, names, or details. If the narrative is thin, produce fewer, higher-confidence items and say so in the rationale.

Your stance is Human and Organizational Performance (HOP) / Safety-II:
- "Human error" is the START of the analysis, never a causal factor. Never blame a person (careless, complacent, "failed to follow"). Point at the systemic condition — design, procedures, tools, training systems, staffing, time pressure, supervision — that made the outcome likely.

Stay concise and concrete. Write for a busy safety lead.`

// draft_sequence output
const DRAFT_SEQUENCE_SCHEMA = {
  type: 'object',
  required: ['events', 'rationale'],
  additionalProperties: false,
  properties: {
    events: {
      type: 'array',
      description: 'The chronological event chain, at most 12 events. Prefer fewer, well-supported events.',
      // Anthropic's structured-output endpoint rejects `maxItems` and allows
      // `minItems` only with 0 or 1 — count bounds live in the descriptions
      // (here and on the other arrays in this file).
      minItems: 1,
      items: {
        type: 'object',
        required: ['title'],
        additionalProperties: false,
        properties: {
          title:      { type: 'string', description: 'One subject + one action verb, active voice, past tense.' },
          conditions: {
            type: 'array',
            description: 'Up to 4 conditions that shaped this event.',
            items: { type: 'string', description: 'A state/circumstance that shaped this event.' },
          },
        },
      },
    },
    incident: { type: 'string', description: 'The terminal loss statement (the harm/damage that resulted).' },
    rationale: { type: 'string', description: '1-2 sentences on confidence + any facts that are missing.' },
  },
} as const

// suggest_causal_factors output
const CAUSAL_FACTOR_SCHEMA = {
  type: 'object',
  required: ['causal_factors', 'rationale'],
  additionalProperties: false,
  properties: {
    causal_factors: {
      type: 'array',
      description: 'At most 8 causal factors.',
      items: {
        type: 'object',
        required: ['node_id', 'reason'],
        additionalProperties: false,
        properties: {
          node_id:  { type: 'string', description: 'The id of an existing event/condition node that is a causal factor.' },
          category: { type: 'string', enum: [...CAUSAL_FACTOR_CATEGORIES], description: 'The systemic category of this causal factor.' },
          reason:   { type: 'string', description: '1 sentence on why correcting this would have prevented or mitigated the loss.' },
        },
      },
    },
    unverified_gaps: {
      type: 'array',
      description: 'Up to 8 presumptive items or missing links that still need evidence.',
      items: { type: 'string', description: 'A presumptive item or missing link that still needs evidence.' },
    },
    rationale: { type: 'string', description: '1 sentence framing the systemic pattern across the causal factors.' },
  },
} as const

function renderChart(rows: EcfaNodeRow[]): string {
  if (rows.length === 0) return '(no nodes on the chart yet)'
  const events = rows.filter(r => r.node_type === 'event')
    .sort((a, b) => a.sequence_index - b.sequence_index)
  const incident = rows.find(r => r.node_type === 'incident')
  const condsByEvent = new Map<string, EcfaNodeRow[]>()
  for (const r of rows) {
    if (r.node_type !== 'condition' || !r.parent_event_id) continue
    const list = condsByEvent.get(r.parent_event_id) ?? []
    list.push(r)
    condsByEvent.set(r.parent_event_id, list)
  }
  const lines: string[] = []
  events.forEach((e, i) => {
    const v = e.verification_status === 'verified' ? 'verified' : 'presumptive'
    const cf = e.is_causal_factor ? ' [CAUSAL FACTOR]' : ''
    lines.push(`${i + 1}. EVENT [${e.id}] (${v})${cf}: ${e.title}`)
    for (const c of condsByEvent.get(e.id) ?? []) {
      const cv = c.verification_status === 'verified' ? 'verified' : 'presumptive'
      const ccf = c.is_causal_factor ? ' [CAUSAL FACTOR]' : ''
      lines.push(`     └ CONDITION [${c.id}] (${cv})${ccf}: ${c.title}`)
    }
  })
  if (incident) lines.push(`INCIDENT [${incident.id}]: ${incident.title}`)
  return lines.join('\n')
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { mode?: string }
  try { body = (await req.json()) as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const mode = body.mode as AssistMode
  if (!ASSIST_MODES.includes(mode))
    return NextResponse.json({ error: `Invalid mode: ${body.mode ?? '(missing)'}` }, { status: 400 })

  const budget = await checkTenantBudget({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE })
  if (!budget.ok)
    return NextResponse.json(
      { error: budget.message },
      { status: 429, headers: budget.reason === 'budget_exceeded' ? { 'retry-after': String(budget.retryAfterSec) } : {} },
    )
  const limit = await checkAiRateLimit({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE })
  if (!limit.ok)
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )

  try {
    const admin = supabaseAdmin()

    // Re-read everything server-side — never trust client analysis.
    const { data: incident } = await admin
      .from('incidents')
      .select('id, description, immediate_action_taken, location_text, severity_actual, incident_type, occurred_at')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const { data: inv } = await admin
      .from('incident_investigations')
      .select('id, sequence_of_events')
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!inv) return NextResponse.json({ error: 'Investigation not started' }, { status: 404 })

    const { data: nodeRows } = await admin
      .from('incident_ecfa_nodes')
      .select('*')
      .eq('investigation_id', inv.id)
      .order('sequence_index')
    const nodes = (nodeRows ?? []) as EcfaNodeRow[]

    if (mode === 'suggest_causal_factors' && nodes.length === 0)
      return NextResponse.json({ error: 'Add some events and conditions before asking for causal factors.' }, { status: 400 })

    const inc = incident as {
      description: string; immediate_action_taken: string | null; location_text: string | null
      severity_actual: string; incident_type: string; occurred_at: string
    }

    const brief = [
      `Incident type: ${inc.incident_type}`,
      `Severity: ${inc.severity_actual}`,
      `Location: ${inc.location_text ?? '(not specified)'}`,
      `Occurred: ${inc.occurred_at}`,
      '',
      `What happened:\n${inc.description}`,
      inc.immediate_action_taken ? `\nImmediate action taken:\n${inc.immediate_action_taken}` : '',
      inv.sequence_of_events ? `\nInvestigator's sequence notes:\n${inv.sequence_of_events}` : '',
      '',
      `Current ECFA chart:\n${renderChart(nodes)}`,
      '',
      mode === 'draft_sequence'
        ? 'Task: from the narrative above, draft the chronological sequence of EVENTS (with any CONDITIONS that shaped each) and the terminal INCIDENT. Prefer fewer, well-supported events over speculation.'
        : 'Task: from the chart above, identify which existing nodes are CAUSAL FACTORS (reference them by their [id]), assign each a systemic category, and list any presumptive items or missing links that still need evidence.',
    ].join('\n')

    let client: Anthropic
    try {
      client = await getAnthropic(gate.tenantId, { timeoutMs: 40_000, maxRetries: 0 })
    } catch (err) {
      const mapped = aiErrorToResponse(err, SURFACE)
      Sentry.captureException(err, { tags: { ...mapped.tags, route: 'ecfa/assist' } })
      await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error', context: 'client init' })
      return NextResponse.json(mapped.body, { status: mapped.status })
    }

    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 1800,
      thinking:   { type: 'adaptive' },
      system:     [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages:   [{ role: 'user', content: brief }],
      output_config: {
        format: { type: 'json_schema', schema: mode === 'draft_sequence' ? DRAFT_SEQUENCE_SCHEMA : CAUSAL_FACTOR_SCHEMA },
      },
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error', context: 'no text block' })
      return NextResponse.json({ error: 'AI returned no usable output.' }, { status: 502 })
    }

    let suggestion: unknown
    try {
      suggestion = JSON.parse(textBlock.text)
    } catch {
      await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error', context: 'JSON parse failed' })
      return NextResponse.json({ error: 'AI returned malformed JSON.' }, { status: 502 })
    }

    // Persist the proposal for audit + tuning. accepted=false until the
    // human commits it through the normal POSTs. Best-effort.
    await admin.from('incident_ecfa_ai_suggestions').insert({
      tenant_id:        gate.tenantId,
      investigation_id: inv.id,
      mode,
      suggestion:       suggestion as object,
      model:            MODEL,
      created_by:       gate.userId,
    })

    await logAiInvocation({
      userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'success',
      inputTokens:      response.usage?.input_tokens,
      outputTokens:     response.usage?.output_tokens,
      cacheReadTokens:  response.usage?.cache_read_input_tokens     ?? undefined,
      cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? undefined,
      context:          incidentId,
    })

    return NextResponse.json({ mode, suggestion })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'ecfa/assist' } })
    await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error', context: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
