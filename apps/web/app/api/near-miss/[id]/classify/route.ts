import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { checkAiRateLimit, checkTenantBudget, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { getTenantApiKey } from '@/lib/ai/getTenantApiKey'

// POST /api/near-miss/[id]/classify
//
// Generate (or return cached) AI triage insights for a near-miss row:
// themes, escalation-risk band, and a 1-2 sentence rationale.
//
// Caching: if a row exists in near_miss_ai_insights for this near-miss
// generated within the last 7 days, return it as-is. Pass ?force=1
// to bypass and regenerate.
//
// Auth: tenant-admin (admin/owner). The insights table's RLS allows
// tenant members to *read*, but classification is an admin-only
// authoring step — same posture as the existing escalate flow.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL    = MODEL_BY_SURFACE['classify-near-miss']
const SURFACE  = 'classify-near-miss' as const
const FRESH_DAYS = 7

const SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      description: '2-5 short keyword themes describing the incident (e.g. "PPE-gap", "electrical-arc", "near-fall"). lowercase-with-hyphens.',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 8,
    },
    escalation_risk: {
      type: 'string',
      description: 'Likelihood this represents a durable systemic hazard worth escalating to the risk register. low / medium / high.',
      enum: ['low', 'medium', 'high'],
    },
    rationale: {
      type: 'string',
      description: '1-2 sentences explaining the escalation_risk choice. Reference specific facts from the description.',
    },
  },
  required: ['themes', 'escalation_risk', 'rationale'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `You are a near-miss triage analyst for a multi-tenant industrial safety platform (Soteria FIELD). Your job: given the description of an incident plus a small sample of adjacent recent near-misses in the same hazard category, classify the new report.

Output:
- themes: 2-5 short keyword tags
- escalation_risk: low / medium / high
- rationale: 1-2 sentences

Calibration:
- HIGH escalation_risk: the description suggests a durable systemic hazard (engineering control missing, recurring root cause, repeat occurrence visible in the adjacent samples). Or: severity_potential is "extreme" with credible mechanism.
- MEDIUM: notable but situational. Could plausibly recur, mitigation partially in place.
- LOW: clearly a one-off (e.g. trip on a stray cord that's already been removed). No pattern in adjacent samples.

Use only the data provided. Do not invent facts. Do not auto-escalate; that's the admin's call. Your job is to surface the signal.`

interface NearMissRow {
  id:                 string
  tenant_id:          string
  description:        string
  hazard_category:    string
  severity_potential: 'low' | 'moderate' | 'high' | 'extreme'
  occurred_at:        string
  location:           string | null
  immediate_action_taken: string | null
  status:             string
}

interface ClassifyResponse {
  near_miss_id:    string
  themes:          string[]
  escalation_risk: 'low' | 'medium' | 'high'
  rationale:       string
  model:           string
  generated_at:    string
  cached:          boolean
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid near-miss id' }, { status: 400 })
  }

  const url   = new URL(req.url)
  const force = url.searchParams.get('force') === '1'
  const admin = supabaseAdmin()

  // Existing fresh insight → short-circuit. Tenant scoping double-
  // checked even though the gate already enforced tenant membership.
  if (!force) {
    const { data: existing } = await admin
      .from('near_miss_ai_insights')
      .select('themes, escalation_risk, rationale, model, generated_at')
      .eq('near_miss_id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (existing) {
      const ageDays = (Date.now() - new Date(existing.generated_at as string).getTime()) / 86_400_000
      if (ageDays < FRESH_DAYS) {
        return NextResponse.json({
          near_miss_id:     id,
          themes:           existing.themes        as string[],
          escalation_risk:  existing.escalation_risk as 'low' | 'medium' | 'high',
          rationale:        (existing.rationale ?? '') as string,
          model:            existing.model        as string,
          generated_at:     existing.generated_at as string,
          cached:           true,
        } as ClassifyResponse)
      }
    }
  }

  // Budget + rate limit. Same order as elsewhere.
  const budget = await checkTenantBudget({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE })
  if (!budget.ok) {
    return NextResponse.json(
      { error: budget.message },
      { status: 429, headers: budget.reason === 'budget_exceeded' ? { 'retry-after': String(budget.retryAfterSec) } : {} },
    )
  }
  const limit = await checkAiRateLimit({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  // Fetch the row + a few adjacent recent same-category samples
  // for soft anchoring. Service-role + explicit tenant filter.
  const { data: row, error: rowErr } = await admin
    .from('near_misses')
    .select('id, tenant_id, description, hazard_category, severity_potential, occurred_at, location, immediate_action_taken, status')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 })
  if (!row)   return NextResponse.json({ error: 'Near-miss not found' }, { status: 404 })

  const nm = row as unknown as NearMissRow

  const { data: adjacent } = await admin
    .from('near_misses')
    .select('description, severity_potential, occurred_at, status')
    .eq('tenant_id', gate.tenantId)
    .eq('hazard_category', nm.hazard_category)
    .neq('id', id)
    .order('occurred_at', { ascending: false })
    .limit(5)

  const adjacentLines = (adjacent ?? []).map((a, i) => {
    const desc = String(a.description ?? '').slice(0, 280)
    return `${i + 1}. [${a.severity_potential}, ${String(a.occurred_at).slice(0, 10)}, ${a.status}] ${desc}`
  })

  const brief = [
    `Hazard category: ${nm.hazard_category}`,
    `Severity potential: ${nm.severity_potential}`,
    `Occurred: ${nm.occurred_at}`,
    `Location: ${nm.location ?? '(not specified)'}`,
    `Status: ${nm.status}`,
    '',
    `Description:`,
    nm.description,
    '',
    nm.immediate_action_taken
      ? `Immediate action taken:\n${nm.immediate_action_taken}`
      : null,
    '',
    adjacentLines.length > 0
      ? `Recent adjacent reports in the same hazard category (most recent first):\n${adjacentLines.join('\n')}`
      : 'No prior near-misses in the same hazard category for this tenant.',
  ].filter(Boolean).join('\n')

  const client = new Anthropic({ apiKey: await getTenantApiKey(gate.tenantId) })

  let parsed: { themes: string[]; escalation_risk: 'low' | 'medium' | 'high'; rationale: string }
  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 1500,
      thinking:   { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: brief }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    })
    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new Error('No text block in response')
    parsed = JSON.parse(textBlock.text)
    await logAiInvocation({
      userId:           gate.userId,
      tenantId:         gate.tenantId,
      surface:          SURFACE,
      model:            MODEL,
      status:           'success',
      inputTokens:      response.usage?.input_tokens,
      outputTokens:     response.usage?.output_tokens,
      cacheReadTokens:  response.usage?.cache_read_input_tokens     ?? undefined,
      cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? undefined,
      context:          id,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/near-miss/classify' } })
    await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error', context: id })
    return NextResponse.json({ error: 'AI classification failed' }, { status: 502 })
  }

  // Upsert with the new generated_at — overwrites stale rows.
  const generatedAt = new Date().toISOString()
  const { error: upsertErr } = await admin
    .from('near_miss_ai_insights')
    .upsert({
      near_miss_id:    id,
      tenant_id:       gate.tenantId,
      themes:          parsed.themes,
      escalation_risk: parsed.escalation_risk,
      rationale:       parsed.rationale,
      model:           MODEL,
      generated_at:    generatedAt,
    }, { onConflict: 'near_miss_id' })
  if (upsertErr) {
    Sentry.captureException(upsertErr, { tags: { route: '/api/near-miss/classify', stage: 'upsert' } })
    // Return the parsed result anyway — the user gets the value, we just lose the cache.
  }

  return NextResponse.json({
    near_miss_id:    id,
    themes:          parsed.themes,
    escalation_risk: parsed.escalation_risk,
    rationale:       parsed.rationale,
    model:           MODEL,
    generated_at:    generatedAt,
    cached:          false,
  } as ClassifyResponse)
}

export type { ClassifyResponse }
