import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getAnthropic, AnthropicNotConfiguredError } from '@/lib/ai/client'
import { MalformedTenantKeyError } from '@/lib/ai/getTenantApiKey'
import { checkAiRateLimit, checkTenantBudget, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { OBLIGATION_CATEGORIES, OBLIGATION_FREQUENCIES } from '@soteria/core/compliance'

// POST /api/compliance/ai-suggest-obligations
//
// Body: { legal_register_id: uuid }
//
// Given a registry entry, ask Sonnet to propose a list of calendar
// obligations (training cycle, inspection cadence, reporting deadline,
// drill schedule). Admin picks which to materialize via the UI —
// nothing is auto-inserted.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL   = MODEL_BY_SURFACE['suggest-compliance-obligations']
const SURFACE = 'suggest-compliance-obligations' as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SCHEMA = {
  type: 'object',
  properties: {
    obligations: {
      type: 'array',
      minItems: 0,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          title:       { type: 'string', description: 'Short imperative title (e.g. "Annual LOTO procedure audit").' },
          description: { type: 'string', description: 'One paragraph describing what doing this obligation entails.' },
          category:    { type: 'string', enum: [...OBLIGATION_CATEGORIES] },
          frequency:   { type: 'string', enum: [...OBLIGATION_FREQUENCIES] },
          frequency_days: {
            type: ['integer', 'null'],
            description: 'Required when frequency=custom_days; otherwise null.',
          },
          responsible_party: { type: 'string', description: 'Role (not person) responsible (e.g. "EHS manager").' },
          evidence_required: { type: 'boolean', description: 'Should completion require an evidence URL?' },
          rationale:   { type: 'string', description: '1-2 sentences explaining why this obligation matters for the citation.' },
        },
        required: ['title', 'description', 'category', 'frequency', 'responsible_party', 'evidence_required', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['obligations'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `You are a compliance-program designer for Soteria FIELD, a multi-tenant industrial safety platform. Given a legal-registry entry (citation + title + jurisdiction + summary), propose 0-8 concrete compliance calendar obligations a safety admin should put on their schedule to demonstrate compliance.

Guidelines:
- Each obligation should be ACTIONABLE and SCHEDULABLE: it must produce evidence on a definite cadence. "Stay aware of changes" is not an obligation; "Review applicability annually" is.
- Pick the smallest cadence that satisfies the citation. Many citations only require *annual* attention; don't suggest quarterly busy-work.
- Use frequency=custom_days when the citation prescribes a non-standard interval (e.g. "every 18 months" → custom_days=548). Leave frequency_days null otherwise.
- The admin will REVIEW your suggestions. Better to propose 3 high-confidence items than 8 padded ones. An empty array is acceptable if the citation requires no scheduled action (rare but possible — e.g. a definitional statute).
- responsible_party should be a ROLE, not a person ("EHS manager", "Maintenance supervisor", "HR records clerk").`

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { legal_register_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const id = body.legal_register_id?.trim() ?? ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'legal_register_id is required' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data: entry, error: fetchErr } = await admin
    .from('legal_register')
    .select('id, tenant_id, citation, title, jurisdiction, authority, summary, applicability_note')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!entry)   return NextResponse.json({ error: 'Registry entry not found' }, { status: 404 })

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

  const brief = [
    `Citation: ${entry.citation}`,
    `Title: ${entry.title}`,
    `Jurisdiction: ${entry.jurisdiction}`,
    entry.authority          ? `Issuing authority: ${entry.authority}`            : null,
    entry.summary            ? `Existing summary:\n${entry.summary}`              : null,
    entry.applicability_note ? `Applicability note:\n${entry.applicability_note}` : null,
  ].filter(Boolean).join('\n\n')

  let client
  try {
    client = await getAnthropic(gate.tenantId)
  } catch (err) {
    if (err instanceof AnthropicNotConfiguredError) {
      return NextResponse.json({ error: 'AI is not configured for this tenant' }, { status: 502 })
    }
    if (err instanceof MalformedTenantKeyError) {
      return NextResponse.json({ error: 'Tenant AI key is malformed' }, { status: 502 })
    }
    throw err
  }

  let parsed: { obligations: Array<{
    title: string; description: string; category: string; frequency: string;
    frequency_days: number | null; responsible_party: string;
    evidence_required: boolean; rationale: string
  }> }
  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 3500,
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
    Sentry.captureException(err, { tags: { route: '/api/compliance/ai-suggest-obligations' } })
    await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error', context: id })
    return NextResponse.json({ error: 'AI suggestion failed' }, { status: 502 })
  }

  return NextResponse.json({
    suggestions: parsed.obligations,
    model:       MODEL,
    legal_register_id: id,
  })
}
