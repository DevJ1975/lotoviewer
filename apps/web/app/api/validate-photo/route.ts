import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'

const client = new Anthropic()
const MODEL = MODEL_BY_SURFACE['validate-photo']

// Anthropic's vision API accepts up to 5 MB per image (base64 +
// payload overhead pushes the request size higher). Cap inputs
// well below that — 4 MB raw lets a base64-encoded payload fit
// under the 5 MB ceiling without surprises. Most legitimate
// uploads are under 1 MB after the client-side compressor in
// PlacardPhotoSlot.tsx; this cap exists to refuse pathological
// uploads (someone bypassing the compressor, a malformed file)
// before we burn tokens on them.
const MAX_BYTES = 4 * 1024 * 1024  // 4 MB

// Anthropic's vision pipeline accepts these media types; anything
// else we refuse before sending. The client compressor outputs
// jpeg by default; webp comes from some camera intents.
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type AllowedMediaType = typeof ALLOWED_MEDIA_TYPES[number]

// Schema for the validity response. Hand-rolled to avoid pulling
// Zod into this small route — the shape is tiny and the model is
// instructed to match it exactly.
function isValidityResponse(x: unknown): x is { valid: boolean; reason: string } {
  if (!x || typeof x !== 'object') return false
  const r = x as Record<string, unknown>
  return typeof r.valid === 'boolean' && typeof r.reason === 'string'
}

const PROMPTS: Record<string, string> = {
  EQUIP: `You are validating a photo for a LOTO (Lockout/Tagout) safety system.
Determine if this image shows physical industrial equipment such as a machine, motor, pump, panel, valve, conveyor, or similar.
Respond with JSON only: { "valid": true/false, "reason": "one short sentence" }
valid = true if the image clearly shows industrial equipment.
valid = false if it is a blank wall, random object, person, document, or unrelated image.`,

  ISO: `You are validating a photo for a LOTO (Lockout/Tagout) safety system.
Determine if this image shows an ISO or LOTO placard, safety label, lockout procedure document, or energy isolation diagram.
Respond with JSON only: { "valid": true/false, "reason": "one short sentence" }
valid = true if the image clearly shows a safety placard, label, or lockout document.
valid = false if it is a blank wall, random object, person, or unrelated image.`,
}

export async function POST(req: NextRequest) {
  // Auth gate first — anyone POSTing to this endpoint burns a Haiku
  // vision call's tokens. Tenant-member is enough since this is purely
  // a UX-helper validity check; nothing protected is returned.
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const limit = await checkAiRateLimit({
    userId:   gate.userId,
    tenantId: gate.tenantId,
    surface:  'validate-photo',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const type = (formData.get('type') as string) ?? 'EQUIP'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Phase 1.5: cap input size before we burn vision tokens. The
    // Anthropic API itself caps at 5 MB; we cap at 4 MB raw so the
    // base64-inflated payload fits under the API limit too.
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_BYTES / 1024 / 1024} MB.` },
        { status: 413 },
      )
    }

    // Validate the media type before sending. file.type can be
    // empty or wrong on some platforms; if it's not in the allowed
    // list we refuse rather than coerce silently.
    const rawType = (file.type || 'image/jpeg').toLowerCase()
    if (!ALLOWED_MEDIA_TYPES.includes(rawType as AllowedMediaType)) {
      return NextResponse.json(
        { error: `Unsupported image type: ${rawType}. Allowed: ${ALLOWED_MEDIA_TYPES.join(', ')}.` },
        { status: 415 },
      )
    }
    const mediaType = rawType as AllowedMediaType

    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 128,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text',  text: PROMPTS[type] ?? PROMPTS.EQUIP },
          ],
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

    // Strip markdown code fences if model wraps response.
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

    // Phase 1.6: parse + shape-check defensively. A malformed model
    // response should NOT bubble up as a 500 (the previous behaviour
    // — caller saw "Validation failed" with no actionable info and
    // we still spent the tokens). Instead, log + return a 502 with
    // a clear "AI returned malformed output" message.
    let raw: unknown
    try {
      raw = JSON.parse(clean)
    } catch (parseErr) {
      Sentry.captureException(parseErr, {
        tags:   { route: '/api/validate-photo', stage: 'json-parse' },
        extra:  { rawText: text.slice(0, 500) },
      })
      await logAiInvocation({
        userId:   gate.userId,
        tenantId: gate.tenantId,
        surface:  'validate-photo',
        model:    MODEL,
        status:   'error',
        context:  'json-parse-failed',
      })
      return NextResponse.json({ error: 'AI returned malformed output.' }, { status: 502 })
    }

    if (!isValidityResponse(raw)) {
      Sentry.captureMessage('validate-photo: response shape mismatch', {
        level:  'warning',
        tags:   { route: '/api/validate-photo', stage: 'shape-check' },
        extra:  { receivedKeys: typeof raw === 'object' && raw ? Object.keys(raw) : null },
      })
      await logAiInvocation({
        userId:   gate.userId,
        tenantId: gate.tenantId,
        surface:  'validate-photo',
        model:    MODEL,
        status:   'error',
        context:  'shape-mismatch',
      })
      return NextResponse.json({ error: 'AI returned unexpected output shape.' }, { status: 502 })
    }

    const parsed = raw

    await logAiInvocation({
      userId:       gate.userId,
      tenantId:     gate.tenantId,
      surface:      'validate-photo',
      model:        MODEL,
      status:       'success',
      inputTokens:  message.usage?.input_tokens,
      outputTokens: message.usage?.output_tokens,
      context:      type,
    })

    return NextResponse.json(parsed)
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/validate-photo' } })
    console.error('[validate-photo]', err)
    await logAiInvocation({
      userId:   gate.userId,
      tenantId: gate.tenantId,
      surface:  'validate-photo',
      model:    MODEL,
      status:   'error',
    })
    return NextResponse.json({ error: 'Validation failed' }, { status: 500 })
  }
}
