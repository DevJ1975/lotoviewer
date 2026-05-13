import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getAnthropic, AnthropicNotConfiguredError } from '@/lib/ai/client'
import { MalformedTenantKeyError } from '@/lib/ai/getTenantApiKey'
import { checkAiRateLimit, checkTenantBudget, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'

// POST /api/compliance/registry/[id]/ai-summarize
//
// Given a stored registry row (citation + title + jurisdiction + any
// applicability_note the user already typed), ask Sonnet for:
//   - a 2-3 paragraph plain-English summary
//   - 3-6 applicability questions the admin should answer before
//     marking this entry "applies to us"
//   - a suggested review cadence
//
// The route does NOT auto-write the summary onto the row — it returns
// the proposal and the UI shows it inline with "Accept" / "Edit" /
// "Discard" controls. The admin presses save, the PATCH route writes
// the chosen fields with ai_generated=true.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL   = MODEL_BY_SURFACE['summarize-legal-citation']
const SURFACE = 'summarize-legal-citation' as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: '2-3 paragraphs plain-English summary of the citation. Identify the regulator, what it requires, who it applies to, and the major obligations it creates.',
    },
    applicability_questions: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 6,
      description: '3-6 yes/no or short-answer questions the admin should answer to decide whether the citation applies to their operation.',
    },
    suggested_review_frequency: {
      type: 'string',
      enum: ['one_time', 'quarterly', 'semiannual', 'annual', 'biennial', 'triennial'],
      description: 'How often the admin should re-review this entry. Pick "annual" by default; "quarterly" only for citations that genuinely churn (e.g. state COVID guidance).',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      minItems: 0,
      maxItems: 8,
      description: 'Short lowercase-with-hyphens domain tags (e.g. "lockout-tagout", "respiratory-protection", "iso-45001"). Used for filtering.',
    },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'How certain you are about the citation. LOW if you do not recognize the citation; the admin should treat the summary as a starting point.',
    },
  },
  required: ['summary', 'applicability_questions', 'suggested_review_frequency', 'tags', 'confidence'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `You are a compliance-research assistant for Soteria FIELD, a multi-tenant industrial safety platform. Given a legal citation (regulation, standard, internal policy, or audit framework) you produce a structured summary that a safety admin can read in under 60 seconds.

Calibration:
- The admin will REVIEW your output before saving it. Be accurate over impressive. If you do not recognize a citation, say so explicitly in the summary and set confidence="low".
- Do NOT manufacture statutory citations or section numbers you are not confident about. It is better to write "this internal-sounding identifier appears to be a company policy" than to invent OSHA chapter numbers.
- Applicability questions should be specific and operational (e.g. "Do you have employees who service equipment with stored energy >= 600V?"). Avoid generic prompts ("Is this relevant?").

Tone: factual, neutral, no marketing language.`

interface RegistryRow {
  id:                 string
  tenant_id:          string
  citation:           string
  title:              string
  jurisdiction:       string
  authority:          string | null
  applicability_note: string | null
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data: row, error } = await admin
    .from('legal_register')
    .select('id, tenant_id, citation, title, jurisdiction, authority, applicability_note')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const entry = row as unknown as RegistryRow

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
    entry.authority ? `Issuing authority: ${entry.authority}` : null,
    entry.applicability_note ? `Admin's applicability note (verbatim):\n${entry.applicability_note}` : null,
  ].filter(Boolean).join('\n')

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

  let parsed: {
    summary: string
    applicability_questions: string[]
    suggested_review_frequency: 'one_time' | 'quarterly' | 'semiannual' | 'annual' | 'biennial' | 'triennial'
    tags: string[]
    confidence: 'low' | 'medium' | 'high'
  }
  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 2000,
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
    Sentry.captureException(err, { tags: { route: '/api/compliance/registry/ai-summarize' } })
    await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error', context: id })
    return NextResponse.json({ error: 'AI summarization failed' }, { status: 502 })
  }

  return NextResponse.json({
    proposal: parsed,
    model:    MODEL,
    // Returned but NOT yet persisted. Front-end pipes "Accept" through
    // the registry PATCH route with the chosen fields.
    generated_at: new Date().toISOString(),
  })
}
