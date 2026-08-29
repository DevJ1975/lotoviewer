import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type Anthropic from '@anthropic-ai/sdk'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { aiErrorToResponse, getAnthropic } from '@/lib/ai/client'
import { checkAiRateLimit, checkTenantBudget, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { INCIDENT_ACTION_TYPES } from '@soteria/core/incidentAction'
import type { FiveWhysRow } from '@soteria/core/rcaSchemas'

// An AI route's worst case is `timeout x (retries + 1)`, and it must fit
// inside maxDuration or the platform kills the function mid-flight and the
// caller gets a raw 504 rather than any error this code produces. This route
// asks for up to 1,500 tokens,
// and previously declared no ceiling at all — so it inherited the platform
// default, which is far shorter than a single model call.
export const maxDuration = 60

// POST /api/incidents/[id]/rca/assist
//
// AI co-pilot for the 5 Whys investigation. Two modes:
//   - next_why              → suggests the next "why" answer + question,
//                             continuing the chain (optionally from a
//                             specific parent node).
//   - draft_root_and_actions → drafts a root-cause statement plus 1-3
//                             corrective actions from the whole chain.
//
// CRITICAL: nothing in this route mutates the investigation. It re-reads
// the chain + incident SERVER-SIDE (never trusts client-supplied
// analysis), returns suggestions, and logs the proposal to
// incident_rca_ai_suggestions. The human edits and accepts through the
// normal RCA / actions POSTs (which stamp ai_origin / ai_edited). That is
// the whole point of "AI-assisted, human-approved."
//
// Admin-only, budget- + rate-limited via the shared ai_invocations infra.
// The deterministic detectSymptomLanguage guardrail runs client-side, so
// the editor stays fully usable when this route is unavailable.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL   = MODEL_BY_SURFACE['rca-assist']
const SURFACE = 'rca-assist' as const

const ASSIST_MODES = ['next_why', 'draft_root_and_actions'] as const
type AssistMode = typeof ASSIST_MODES[number]

interface RouteContext {
  params: Promise<{ id: string }>
}

const SYSTEM_PROMPT = `You are a root-cause-analysis facilitator for an industrial EHS platform, coaching an investigator through a 5 Whys analysis.

Your stance is Human and Organizational Performance (HOP) / Safety-II:
- People do not come to work to fail. "Human error" is the START of an investigation, never the end.
- NEVER propose a root cause that blames a person (careless, complacent, distracted, "should have known", "failed to follow"). Push past the behaviour to the systemic condition that made the behaviour likely: design, procedures, tools, training systems, staffing, time pressure, supervision, communication.
- A good root cause is something the organisation can change to make recurrence far less likely.
- Reject "retrain the worker" / "remind staff" as a root cause — it is a symptom-level fix.

Use ONLY the facts provided. Do not invent details. If the chain is too thin to reach a defensible root, say so in your rationale and keep the suggestion modest.

Stay concise and concrete. Write for a busy safety lead.`

// next_why output
const NEXT_WHY_SCHEMA = {
  type: 'object',
  required: ['question', 'answer', 'rationale'],
  additionalProperties: false,
  properties: {
    question:  { type: 'string', description: 'The next "why" question, echoing the answer it interrogates.' },
    answer:    { type: 'string', description: 'A plausible, systemic answer to that why, grounded in the facts. One or two sentences.' },
    rationale: { type: 'string', description: '1 sentence on why this is the right next step and how it avoids person-blame.' },
  },
} as const

// draft_root_and_actions output
const DRAFT_SCHEMA = {
  type: 'object',
  required: ['root_cause', 'actions'],
  additionalProperties: false,
  properties: {
    root_cause: {
      type: 'string',
      description: 'A single, systemic root-cause statement the organisation can act on. No person-blame.',
    },
    actions: {
      type: 'array',
      description: '1-3 corrective actions that would prevent recurrence.',
      // Anthropic's structured-output endpoint rejects `maxItems` and allows
      // `minItems` only with 0 or 1 — the 1-3 bound lives in the description.
      minItems: 1,
      items: {
        type: 'object',
        required: ['description', 'action_type'],
        additionalProperties: false,
        properties: {
          description: { type: 'string', description: 'A concrete corrective action.' },
          action_type: { type: 'string', enum: [...INCIDENT_ACTION_TYPES] },
        },
      },
    },
  },
} as const

function renderChain(rows: FiveWhysRow[]): string {
  if (rows.length === 0) return '(no whys recorded yet)'
  const byId = new Map(rows.map(r => [r.id, r]))
  return [...rows]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map(r => {
      const parent = r.parent_id ? byId.get(r.parent_id) : undefined
      const lineage = parent ? ` (answers: "${(parent.answer ?? '').slice(0, 60)}")` : ''
      const root = r.is_root ? ' [marked ROOT]' : ''
      return `${r.ordinal}. Q: ${r.question ?? 'Why?'}\n   A: ${r.answer}${lineage}${root}`
    })
    .join('\n')
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { mode?: string; parent_node_id?: string | null }
  try { body = (await req.json()) as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const mode = body.mode as AssistMode
  if (!ASSIST_MODES.includes(mode))
    return NextResponse.json({ error: `Invalid mode: ${body.mode ?? '(missing)'}` }, { status: 400 })

  // Budget + rate limit, same order as the other AI surfaces.
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
      .select('id, description, location_text, severity_actual, incident_type, occurred_at')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const { data: inv } = await admin
      .from('incident_investigations')
      .select('id, rca_method')
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!inv) return NextResponse.json({ error: 'Investigation not started' }, { status: 404 })
    if (inv.rca_method !== '5_whys')
      return NextResponse.json({ error: 'AI assist currently supports the 5 Whys method.' }, { status: 400 })

    const { data: chainRows } = await admin
      .from('incident_rca_5whys')
      .select('*')
      .eq('investigation_id', inv.id)
      .order('ordinal')
    const chain = (chainRows ?? []) as FiveWhysRow[]

    const inc = incident as {
      description: string; location_text: string | null
      severity_actual: string; incident_type: string; occurred_at: string
    }

    const brief = [
      `Incident type: ${inc.incident_type}`,
      `Severity: ${inc.severity_actual}`,
      `Location: ${inc.location_text ?? '(not specified)'}`,
      `Occurred: ${inc.occurred_at}`,
      '',
      `What happened:\n${inc.description}`,
      '',
      `5 Whys chain so far:\n${renderChain(chain)}`,
      '',
      mode === 'next_why'
        ? 'Task: propose the NEXT "why" that drills one level deeper toward a systemic root cause. Echo the answer it interrogates in the question.'
        : 'Task: from the chain above, draft ONE systemic root-cause statement and 1-3 corrective actions that would prevent recurrence.',
    ].join('\n')

    let client: Anthropic
    try {
      client = await getAnthropic(gate.tenantId, { timeoutMs: 40_000, maxRetries: 0 })
    } catch (err) {
      const mapped = aiErrorToResponse(err, SURFACE)
      Sentry.captureException(err, { tags: { ...mapped.tags, route: 'rca/assist' } })
      await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error', context: 'client init' })
      return NextResponse.json(mapped.body, { status: mapped.status })
    }

    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 1500,
      thinking:   { type: 'adaptive' },
      system:     [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages:   [{ role: 'user', content: brief }],
      output_config: {
        format: { type: 'json_schema', schema: mode === 'next_why' ? NEXT_WHY_SCHEMA : DRAFT_SCHEMA },
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
    await admin.from('incident_rca_ai_suggestions').insert({
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
    Sentry.captureException(e, { tags: { route: 'rca/assist' } })
    await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error', context: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
