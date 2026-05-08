import type Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'

// POST /api/assistant/scan-photo
//
// Multipart upload of a single image of an equipment nameplate. Claude
// vision extracts the equipment_id (if visible), brand, model, serial,
// and a guessed equipment type. We then look the equipment_id up in
// loto_equipment and return matching candidates so the user can confirm.
//
// Why a vision call instead of OCR-via-tesseract: nameplates are often
// scratched, oily, partially obscured. Claude's robustness on degraded
// industrial labels materially beats off-the-shelf OCR, and we already
// pay for the SDK + key. Cost is bounded — rate-limited per user.
//
// Auth: requireTenantMember + x-active-tenant.
// Rate limit: assistant-scan-photo (30/hr, 100/day).

const MODEL = MODEL_BY_SURFACE['assistant-scan-photo']
const MAX_BYTES = 5 * 1024 * 1024  // 5 MB pre-encode cap on the image
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

export const runtime     = 'nodejs'
export const maxDuration = 60

const SYSTEM_PROMPT = `You read industrial equipment nameplates and labels.

OUTPUT
Return JSON ONLY (no markdown, no commentary) matching:
{
  "equipment_id":  string | null,
  "brand":         string | null,
  "model":         string | null,
  "serial":        string | null,
  "type":          string | null,
  "voltage":       string | null,
  "confidence":    "high" | "medium" | "low",
  "notes":         string
}

RULES
- equipment_id: copy the asset/equipment ID printed on the placard exactly. Common formats: alphanumeric like "MIX-04", "P-101", "EQ-1234". Do NOT invent one — null is correct when no asset ID is visible.
- type: e.g. "centrifugal pump", "industrial mixer", "VFD drive", "boiler". One short noun phrase.
- voltage: copy verbatim if shown, e.g. "480V 3φ".
- confidence: 'high' if the nameplate is clearly readable; 'medium' if partially obscured but you're sure of the equipment_id; 'low' if you're guessing or only a brand sticker is visible.
- notes: one short sentence explaining what you can/can't see (e.g. "label is oily, equipment_id partly obscured").
- If the image is not of an equipment nameplate at all, return all-null values with confidence='low' and notes describing what the image actually shows.`

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const limit = await checkAiRateLimit({
    userId:   gate.userId,
    tenantId: gate.tenantId,
    surface:  'assistant-scan-photo',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `You have hit the ${limit.reason} scan limit. Try again later.`, retryAfterSec: limit.retryAfterSec },
      { status: 429 },
    )
  }

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data body.' }, { status: 400 }) }

  const file = form.get('image')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'An "image" field is required.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Image exceeds the ${MAX_BYTES / 1024 / 1024}MB cap.` }, { status: 413 })
  }
  const mime = file.type
  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    return NextResponse.json(
      { error: `Unsupported image type ${mime}. Use JPEG, PNG, WebP, or HEIC.` },
      { status: 415 },
    )
  }

  let client: Anthropic
  try { client = await getAnthropic(gate.tenantId) }
  catch (err) {
    const mapped = aiErrorToResponse(err, 'assistant-scan-photo')
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/assistant/scan-photo' } })
    return NextResponse.json(mapped.body, { status: mapped.status })
  }

  // Vision call. Anthropic accepts image as base64 'image' content.
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
  // Vision models won't accept 'image/heif' / 'image/heic' directly —
  // remap to image/jpeg. Most modern phones ship HEIC and the upstream
  // Anthropic accepts mislabelled HEIC bytes as JPEG fine in practice;
  // if it ever breaks we'll add server-side conversion here.
  const sendMime = (mime === 'image/heic' || mime === 'image/heif') ? 'image/jpeg' : mime

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model:      MODEL,
      max_tokens: 1500,
      system:     SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: sendMime, data: base64 },
          },
          { type: 'text', text: 'Extract the nameplate fields per the system instructions. Reply with JSON only.' },
        ],
      }],
    } as Parameters<Anthropic['messages']['create']>[0])
  } catch (err) {
    const mapped = aiErrorToResponse(err, 'assistant-scan-photo')
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/assistant/scan-photo' } })
    await logAiInvocation({
      userId:  gate.userId, tenantId: gate.tenantId, surface: 'assistant-scan-photo',
      model:   MODEL, status: 'error',
      context: err instanceof Error ? err.message.slice(0, 200) : 'create threw',
    })
    return NextResponse.json(mapped.body, { status: mapped.status })
  }

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return NextResponse.json({ error: 'AI returned no usable output.' }, { status: 502 })
  }

  let parsed: NameplateExtraction
  try {
    // Strip a possible markdown fence if the model added one despite instructions.
    const txt = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
    parsed = JSON.parse(txt) as NameplateExtraction
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/assistant/scan-photo', stage: 'parse' } })
    return NextResponse.json({ error: 'AI returned malformed JSON.' }, { status: 502 })
  }

  // Look up matching equipment in this tenant. We try exact + ilike to
  // tolerate case differences ("mix-04" vs "MIX-04"). Only return rows
  // visible to the gate's tenant.
  const candidates: Array<{ id: string; equipment_id: string; description: string | null; department: string | null }> = []
  const equipmentId = (parsed.equipment_id ?? '').trim()
  if (equipmentId) {
    const admin = supabaseAdmin()
    const { data } = await admin
      .from('loto_equipment')
      .select('id, equipment_id, description, department')
      .eq('tenant_id', gate.tenantId)
      .ilike('equipment_id', equipmentId)
      .limit(5)
    for (const row of (data ?? [])) {
      candidates.push(row as typeof candidates[number])
    }
  }

  await logAiInvocation({
    userId:           gate.userId,
    tenantId:         gate.tenantId,
    surface:          'assistant-scan-photo',
    model:            MODEL,
    status:           'success',
    inputTokens:      response.usage?.input_tokens ?? 0,
    outputTokens:     response.usage?.output_tokens ?? 0,
    cacheReadTokens:  response.usage?.cache_read_input_tokens ?? 0,
    context:          equipmentId || 'no-id-detected',
  })

  return NextResponse.json({
    extraction: parsed,
    candidates,
  })
}

interface NameplateExtraction {
  equipment_id: string | null
  brand:        string | null
  model:        string | null
  serial:       string | null
  type:         string | null
  voltage:      string | null
  confidence:   'high' | 'medium' | 'low'
  notes:        string
}
