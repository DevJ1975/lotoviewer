import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic()

export interface LotoAssistRequest {
  equipmentId:        string
  description:        string
  department:         string
  energy_tag:         string | null
  iso_description:    string | null
  iso_procedure:      string | null
  lockout_device:     string | null
  verification_method: string | null
  field?: string   // if set, only regenerate this one field
}

export interface LotoAssistResponse {
  energy_tag:          string
  iso_description:     string
  iso_procedure:       string
  lockout_device:      string
  verification_method: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as LotoAssistRequest

    const current = `
- Energy Tag:          ${body.energy_tag         || '(not set)'}
- ISO Description:     ${body.iso_description    || '(not set)'}
- ISO Procedure:       ${body.iso_procedure      || '(not set)'}
- Lockout Device:      ${body.lockout_device     || '(not set)'}
- Verification Method: ${body.verification_method || '(not set)'}`

    const fieldInstruction = body.field
      ? `Focus only on improving the "${body.field}" field; for all other fields return the existing value unchanged.`
      : 'Generate or improve all fields.'

    const prompt = `You are an industrial safety expert specializing in LOTO (Lockout/Tagout) per OSHA 29 CFR 1910.147.

Equipment:
- ID: ${body.equipmentId}
- Description: ${body.description}
- Department: ${body.department}

Current LOTO documentation (may be empty or incomplete):
${current}

${fieldInstruction}

Guidelines:
- energy_tag: list energy type(s), nominal values, and isolation point location (e.g. "480V 3-phase — Main disconnect MCC-B Row 4")
- iso_description: one sentence describing what is being isolated and where
- iso_procedure: numbered steps to de-energize and lock out (be specific, include tag-out)
- lockout_device: specific device(s) required (e.g. "Panduit PSL-3 hasp + Brady 65396 padlock")
- verification_method: exact test steps confirming zero energy state

Respond ONLY with valid JSON, no markdown fences:
{"energy_tag":"...","iso_description":"...","iso_procedure":"...","lockout_device":"...","verification_method":"..."}`

    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    })

    const text  = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(clean) as LotoAssistResponse
    return NextResponse.json(parsed)
  } catch (err) {
    console.error('[assist-loto]', err)
    return NextResponse.json({ error: 'AI assist failed' }, { status: 500 })
  }
}
