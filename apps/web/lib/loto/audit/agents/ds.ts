// Agent 2 — Data Scientist (consistency). Reconciles description ↔ energy
// codes ↔ steps ↔ FPE photo verdicts, grades per-step + per-equipment
// confidence, and decides low_confidence_iso (which drives the placeholder
// flow). Missing OSHA phases are computed DETERMINISTICALLY with the shared
// validator rather than asked of the model.

import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { validateProcedure, type LotoStepType } from '@soteria/core/lotoProcedureValidation'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { DS_SCHEMA, type DsResult, type FpeResult } from '../schemas'
import { DS_SYSTEM, describeEquipment, describeSteps } from '../prompts'
import type { AgentOutput } from './fpe'
import { assertNotRefused } from '@/lib/ai/client'

const MODEL = MODEL_BY_SURFACE['loto-audit-ds']

export interface DsAgentOutput extends AgentOutput<DsResult> {
  missingPhases: LotoStepType[]
}

export async function runDsAgent(
  client: Anthropic,
  equipment: Equipment,
  steps: LotoEnergyStep[],
  fpe: FpeResult,
): Promise<DsAgentOutput> {
  const missingPhases = validateProcedure(
    steps.map(s => ({ step_type: s.step_type, sequence_order: s.sequence_order })),
  ).missing

  const userText = [
    'Audit the consistency of this LOTO equipment record.',
    '',
    describeEquipment(equipment),
    '',
    'Energy steps:',
    describeSteps(steps),
    '',
    'Food Production Engineer photo verdicts:',
    `  Equipment photo: ${fpe.equip_photo.verdict} (confidence ${fpe.equip_photo.confidence}) — ${fpe.equip_photo.notes}`,
    `  Isolation photo: ${fpe.iso_photo.verdict} (confidence ${fpe.iso_photo.confidence}); shows_isolation_point=${fpe.iso_photo.shows_isolation_point}; consistent_with_energy_steps=${fpe.iso_photo.consistent_with_energy_steps} — ${fpe.iso_photo.notes}`,
    '',
    `OSHA phases already missing (computed): ${missingPhases.length ? missingPhases.join(', ') : 'none'}`,
    '',
    'Assess each step (by its id), the equipment overall, and low_confidence_iso. Reply with JSON only.',
  ].join('\n')

  // No extended thinking: it pushed these structured calls past the shared
  // client's 30s timeout. The prompt + schema carry the reasoning, and the
  // EHS safety gate is enforced deterministically in TS regardless.
  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 4000,
    thinking:   { type: 'disabled' },
    system:     [{ type: 'text', text: DS_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: DS_SCHEMA } },
  })

  assertNotRefused(response, 'loto-audit-ds')
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('DS agent: no text block in response')
  const result = JSON.parse(textBlock.text) as DsResult

  return { result, usage: response.usage ?? null, model: MODEL, missingPhases }
}
