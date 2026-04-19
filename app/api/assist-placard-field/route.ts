import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { energyCodeFor } from '@/lib/energyCodes'

const client = new Anthropic()

export type FieldType =
  | 'description'
  | 'notes'
  | 'tag_description'
  | 'isolation_procedure'
  | 'method_of_verification'

export interface AssistRequest {
  field:        FieldType
  currentValue: string
  equipment: {
    equipment_id: string
    description:  string
    department:   string
  }
  // For energy step fields
  energy_type?: string
  step_number?: number
  // Optional sibling values on the same step for better context
  tag_description?:        string
  isolation_procedure?:    string
  method_of_verification?: string
}

function buildPrompt(req: AssistRequest): string {
  const { field, currentValue, equipment } = req
  const ctx = `Equipment: ${equipment.equipment_id} — ${equipment.description} (Department: ${equipment.department})`

  const instruction = currentValue.trim()
    ? `Improve/rewrite the current value below. Keep the same intent but make it clearer, more specific, and OSHA-compliant.`
    : `Generate a short, practical value from scratch.`

  const guidelines = {
    description: `Guideline: write a 1-line equipment description including type and purpose (e.g. "Case Sealer #3 — Pop Chip line").`,
    notes: `Guideline: write 1-2 short sentences that belong under the LOTO red warning block. Emphasize keep-out, energy hazards, and reference to the lockout procedure. Plain English, no jargon.`,
    tag_description: `Guideline: describe the energy source at this tag in one short sentence. Include energy type, nominal values if inferable, and the physical location (e.g. "480V 3-phase — Main disconnect MCC-B Row 4"). Energy type is ${req.energy_type ? `"${req.energy_type}" (${energyCodeFor(req.energy_type).labelEn})` : 'unspecified'}.`,
    isolation_procedure: `Guideline: write numbered steps to de-energize and lock out this ${req.energy_type ? energyCodeFor(req.energy_type).labelEn.toLowerCase() : ''} source. Include the specific lockout device needed (hasp, padlock, valve cover, etc.). Keep under 5 steps, one per line.`,
    method_of_verification: `Guideline: write the exact test that confirms zero-energy state (e.g. "Press Start; confirm machine does not run" or "Use calibrated voltmeter at terminals L1-L2, L2-L3, L1-L3 — expect 0V"). One short paragraph.`,
  }[field]

  const siblingContext = (field === 'isolation_procedure' || field === 'method_of_verification') && req.tag_description
    ? `\nRelated tag description: ${req.tag_description}`
    : ''

  return `You are an industrial safety expert writing LOTO (Lockout/Tagout) placard content per OSHA 29 CFR 1910.147.

${ctx}

Field: ${field}
${siblingContext}

${instruction}
${guidelines}

Current value:
${currentValue.trim() || '(empty)'}

Respond ONLY with the improved/generated value as plain text. No preamble, no markdown formatting, no quotation marks wrapping the answer. Do not say "Here is" or "I suggest".`
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AssistRequest
    if (!body.field || !body.equipment) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 512,
      messages:   [{ role: 'user', content: buildPrompt(body) }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    if (!text) {
      return NextResponse.json({ error: 'Empty AI response' }, { status: 502 })
    }
    return NextResponse.json({ suggestion: text })
  } catch (err) {
    console.error('[assist-placard-field]', err)
    return NextResponse.json({ error: 'AI assist failed' }, { status: 500 })
  }
}
