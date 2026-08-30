// Agent 1 — Food Production Engineer (vision). Confirms the equipment photo
// shows the described machine and the isolation photo shows a real lockout
// point consistent with the energy steps. Mirrors the proven vision call in
// app/api/assistant/scan-photo (base64 image blocks) + the structured-output
// path from app/api/generate-loto-steps (output_config json_schema).

import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { FPE_SCHEMA, type FpeResult } from '../schemas'
import { FPE_SYSTEM, describeEquipment, describeSteps } from '../prompts'
import { fetchImageAsBase64 } from '../imageFetch'
import { assertNotRefused } from '@/lib/ai/client'

const MODEL = MODEL_BY_SURFACE['loto-audit-fpe']

export interface AgentOutput<T> {
  result: T
  usage:  Anthropic.Usage | null
  model:  string
}

const MISSING_EQUIP: FpeResult['equip_photo'] = {
  verdict: 'missing', confidence: 'low', notes: 'No equipment photo on file.',
}
const MISSING_ISO: FpeResult['iso_photo'] = {
  verdict: 'missing', confidence: 'low', shows_isolation_point: false,
  consistent_with_energy_steps: false, notes: 'No isolation photo on file.',
}

export async function runFpeAgent(
  client: Anthropic,
  equipment: Equipment,
  steps: LotoEnergyStep[],
): Promise<AgentOutput<FpeResult>> {
  const [equipImg, isoImg] = await Promise.all([
    fetchImageAsBase64(equipment.equip_photo_url),
    fetchImageAsBase64(equipment.iso_photo_url),
  ])

  // No usable photos — return synthetic verdicts without burning a vision call.
  if (!equipImg && !isoImg) {
    return { result: { equip_photo: MISSING_EQUIP, iso_photo: MISSING_ISO }, usage: null, model: MODEL }
  }

  const content: Anthropic.ContentBlockParam[] = []
  if (equipImg) content.push({ type: 'image', source: { type: 'base64', media_type: equipImg.mediaType, data: equipImg.base64 } })
  if (isoImg)   content.push({ type: 'image', source: { type: 'base64', media_type: isoImg.mediaType, data: isoImg.base64 } })
  content.push({
    type: 'text',
    text: [
      'Audit the LOTO photos for this equipment.',
      '',
      describeEquipment(equipment),
      '',
      'Energy steps:',
      describeSteps(steps),
      '',
      `Photos attached, in order: ${[equipImg ? 'EQUIPMENT' : null, isoImg ? 'ISOLATION' : null].filter(Boolean).join(', ')}.`,
      equipImg ? '' : 'No equipment photo is attached — return verdict "missing" for equip_photo.',
      isoImg ? '' : 'No isolation photo is attached — return verdict "missing" for iso_photo.',
      'Reply with JSON only per the schema.',
    ].filter(Boolean).join('\n'),
  })

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 2000,
    thinking:   { type: 'disabled' },
    system:     [{ type: 'text', text: FPE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: FPE_SCHEMA } },
  })

  assertNotRefused(response, 'loto-audit-fpe')
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('FPE agent: no text block in response')
  const result = JSON.parse(textBlock.text) as FpeResult

  // A photo we couldn't load is authoritatively "missing", whatever the model said.
  if (!equipImg) result.equip_photo = MISSING_EQUIP
  if (!isoImg)   result.iso_photo   = MISSING_ISO

  return { result, usage: response.usage ?? null, model: MODEL }
}
