import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

const client = new Anthropic()

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
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const type = (formData.get('type') as string) ?? 'EQUIP'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const base64  = Buffer.from(buffer).toString('base64')
    const mediaType = (file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif') || 'image/jpeg'

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
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

    // Strip markdown code fences if model wraps response
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

    const parsed = JSON.parse(clean) as { valid: boolean; reason: string }
    return NextResponse.json(parsed)
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/validate-photo' } })
    console.error('[validate-photo]', err)
    return NextResponse.json({ error: 'Validation failed' }, { status: 500 })
  }
}
