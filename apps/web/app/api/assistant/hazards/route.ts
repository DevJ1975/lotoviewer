import type Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { retrieveContext } from '@/lib/ai/rag'

// POST /api/assistant/hazards
//
// Generates a structured hazard report for a piece of equipment.
//
// Body: { equipment_id: string }  (the human-readable id, NOT the
// internal UUID — matches what the user sees on placards.)
//
// Pipeline:
//   1. Load equipment + linked chemicals + linked JHAs from supabase
//   2. Build a focused RAG query from "{equipment_id} {description} hazards"
//      and retrieve top-K regulation + policy chunks
//   3. Ask Claude for a structured report (hazards, energy sources,
//      isolation, PPE, regulatory references).
//
// Caching: a per-(tenant, equipment_id) cache lives in the
// equipment_hazards_cache jsonb column on loto_equipment (PR3 piggybacks
// on the existing internal_notes pattern — see migration 106 for the
// column add). 24h TTL. PR3 ships without the cache column to keep the
// migration minimal; the route runs the full pipeline on every call
// for now and the on-frontend client can debounce. A follow-up wires
// the cache.

const MODEL = MODEL_BY_SURFACE['assistant-hazards']
const MAX_TOKENS = 4000

export const runtime     = 'nodejs'
export const maxDuration = 90

const SYSTEM_PROMPT = `You are Soteria FIELD's hazard-recognition assistant.

You produce a structured hazard report for one piece of industrial equipment, grounded in the retrieved regulation and company-policy chunks at the bottom of this prompt.

OUTPUT
Return JSON ONLY (no markdown, no commentary) matching:
{
  "summary":            string,             // 1–3 sentences describing the equipment and its high-level risk class
  "hazards":            HazardItem[],       // 3–8 items
  "energy_sources":     string[],           // e.g. "480V 3φ electrical", "compressed air 120 PSI", "stored hydraulic pressure"
  "isolation_steps":    string[],           // ordered steps a qualified worker would follow before service
  "required_ppe":       string[],           // e.g. "ANSI Z89 hard hat", "voltage-rated gloves class 2"
  "regulatory_refs":    Citation[],         // from the retrieved context only — never invent
  "company_policy_refs": Citation[],        // company policies cited from the retrieved context
  "warnings":           string[]            // explicit safety boundaries, e.g. "verify lockout — do not assume de-energized"
}

HazardItem = {
  "category":   string,   // "electrical" | "mechanical" | "chemical" | "thermal" | "pressure" | "ergonomic" | other
  "description":string,   // one short sentence
  "severity":   "low" | "medium" | "high" | "critical",
  "controls":   string[], // 1–4 short bullets
  "citations":  string[]  // verbatim cite tags from the retrieved <doc> blocks (or [] if not grounded)
}

Citation = {
  "title":       string,
  "section":     string | null,
  "source_url":  string | null
}

RULES
- Ground every hazard, isolation step, and PPE recommendation in the retrieved context wherever possible. Copy <doc> cite tags verbatim into HazardItem.citations.
- Do NOT invent regulation citations. If a hazard isn't covered by the retrieved context, omit citations for that item rather than fabricating them.
- isolation_steps must be ordered and complete enough to be a starting checklist (NOT a full procedure — that's the LOTO author's job).
- warnings is mandatory. Always include at least: "Soteria's report is a drafting aid. A qualified person must verify isolation and authorize the work." Add equipment-specific warnings as needed.`

interface RequestBody {
  equipment_id?: string
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: RequestBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const equipmentId = (body.equipment_id ?? '').trim()
  if (!equipmentId) {
    return NextResponse.json({ error: 'equipment_id is required.' }, { status: 400 })
  }

  const limit = await checkAiRateLimit({
    userId:   gate.userId,
    tenantId: gate.tenantId,
    surface:  'assistant-hazards',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Hazard report limit hit (${limit.reason}). Try again later.`, retryAfterSec: limit.retryAfterSec },
      { status: 429 },
    )
  }

  const admin = supabaseAdmin()
  const { data: equipRow, error: equipErr } = await admin
    .from('loto_equipment')
    .select('id, equipment_id, description, department, internal_notes')
    .eq('tenant_id', gate.tenantId)
    .ilike('equipment_id', equipmentId)
    .maybeSingle()
  if (equipErr) {
    Sentry.captureException(equipErr, { tags: { route: '/api/assistant/hazards' } })
    return NextResponse.json({ error: 'Equipment lookup failed.' }, { status: 500 })
  }
  if (!equipRow) {
    return NextResponse.json({ error: 'Equipment not found in your active tenant.' }, { status: 404 })
  }
  const equipment = equipRow as {
    id: string; equipment_id: string; description: string | null;
    department: string | null; internal_notes: string | null;
  }

  // Build the RAG query. "Hazards for X" rather than just "X" steers
  // retrieval toward §1910.147, §1910.146, etc. Including department +
  // description gives the embedder more concrete signal than the bare id.
  const ragQuery = [
    `Hazards and isolation procedure for ${equipment.equipment_id}`,
    equipment.description,
    equipment.department ? `Department: ${equipment.department}` : null,
  ].filter(Boolean).join('. ')

  const retrieved = await retrieveContext({ query: ragQuery, tenantId: gate.tenantId, k: 10 })

  let client: Anthropic
  try { client = await getAnthropic(gate.tenantId) }
  catch (err) {
    const mapped = aiErrorToResponse(err, 'assistant-hazards')
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/assistant/hazards' } })
    return NextResponse.json(mapped.body, { status: mapped.status })
  }

  const userPrompt = [
    `EQUIPMENT`,
    `equipment_id: ${equipment.equipment_id}`,
    `description: ${equipment.description ?? '(none on file)'}`,
    `department: ${equipment.department ?? '(none)'}`,
    equipment.internal_notes ? `internal_notes: ${equipment.internal_notes}` : null,
    ``,
    `RETRIEVED CONTEXT`,
    retrieved.contextBlock || '(no matching documents in the knowledge base)',
    ``,
    `Generate the structured hazard report per the system instructions. JSON only.`,
  ].filter(Boolean).join('\n')

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    })
  } catch (err) {
    const mapped = aiErrorToResponse(err, 'assistant-hazards')
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/assistant/hazards' } })
    await logAiInvocation({
      userId:  gate.userId, tenantId: gate.tenantId, surface: 'assistant-hazards',
      model:   MODEL, status: 'error',
      context: equipment.equipment_id,
    })
    return NextResponse.json(mapped.body, { status: mapped.status })
  }

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return NextResponse.json({ error: 'AI returned no usable output.' }, { status: 502 })
  }

  let report: HazardReport
  try {
    const txt = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
    report = JSON.parse(txt) as HazardReport
  } catch {
    return NextResponse.json({ error: 'AI returned malformed JSON.' }, { status: 502 })
  }

  await logAiInvocation({
    userId:           gate.userId,
    tenantId:         gate.tenantId,
    surface:          'assistant-hazards',
    model:            MODEL,
    status:           'success',
    inputTokens:      response.usage?.input_tokens ?? 0,
    outputTokens:     response.usage?.output_tokens ?? 0,
    cacheReadTokens:  response.usage?.cache_read_input_tokens ?? 0,
    context:          equipment.equipment_id,
  })

  return NextResponse.json({
    equipment: {
      id:           equipment.id,
      equipment_id: equipment.equipment_id,
      description:  equipment.description,
      department:   equipment.department,
    },
    report,
    sources: retrieved.chunks.map(c => ({
      title:        c.title,
      source_type:  c.source_type,
      jurisdiction: c.jurisdiction,
      source_url:   c.source_url,
      similarity:   c.similarity,
    })),
    usage: {
      inputTokens:     response.usage?.input_tokens ?? 0,
      outputTokens:    response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
      voyageTokens:    retrieved.voyageTokens,
    },
  })
}

interface HazardReport {
  summary:             string
  hazards:             Array<{
    category:    string
    description: string
    severity:    'low' | 'medium' | 'high' | 'critical'
    controls:    string[]
    citations:   string[]
  }>
  energy_sources:      string[]
  isolation_steps:     string[]
  required_ppe:        string[]
  regulatory_refs:     Array<{ title: string; section: string | null; source_url: string | null }>
  company_policy_refs: Array<{ title: string; section: string | null; source_url: string | null }>
  warnings:            string[]
}
