// Cal/OSHA Regulator — a veteran compliance officer (CSHO) who adversarially
// re-reviews the internal audit AFTER it runs and BEFORE human review. Two
// surfaces:
//   - runRegulatorMachineReview: per machine, concur/dissent with the EHS
//     verdict and surface the citations / escalations / deficiencies an
//     inspector would write up.
//   - runRegulatorProgramReview: an end-to-end §3314 program audit over the
//     whole run's aggregate.
//
// Mirrors author.ts exactly: a cached system prompt, the structured json_schema
// output path, NO extended thinking (it pushed these structured calls past the
// shared client timeout, same as the other agents), parse the text block and
// throw if none. SAFETY POSTURE: like every audit agent this NEVER writes live
// data — its critique is staged for the existing human review gate.

import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import {
  REGULATOR_MACHINE_SCHEMA, REGULATOR_PROGRAM_SCHEMA,
  type RegulatorMachineResult, type RegulatorProgramResult,
  type DsResult, type EhsResult, type FpeResult,
} from '../schemas'
import { REGULATOR_SYSTEM, REGULATOR_PROGRAM_SYSTEM, describeRegulatorInputs } from '../prompts'
import type { AgentOutput } from './fpe'

const MODEL = MODEL_BY_SURFACE['loto-audit-regulator']

export async function runRegulatorMachineReview(
  client: Anthropic,
  equipment: Equipment,
  steps: LotoEnergyStep[],
  fpe: FpeResult,
  ds: DsResult,
  ehs: EhsResult,
): Promise<AgentOutput<RegulatorMachineResult>> {
  const userText = [
    'Re-review this machine as a Cal/OSHA compliance officer. Concur or dissent with the internal EHS verdict and surface what an inspector would write up.',
    '',
    describeRegulatorInputs(equipment, steps, fpe, ds, ehs),
    '',
    'Set concurs_with_ehs explicitly, cite each additional finding with its regulation, and call out any missing zero-energy verification. Return JSON only.',
  ].join('\n')

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 4000,
    // Cache the static system prompt — a post-audit pass reviews many machines
    // in one burst, all sharing this prompt.
    system:     [{ type: 'text', text: REGULATOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: REGULATOR_MACHINE_SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('Regulator agent: no text block in response')
  const result = JSON.parse(textBlock.text) as RegulatorMachineResult

  return { result, usage: response.usage ?? null, model: MODEL }
}

export async function runRegulatorProgramReview(
  client: Anthropic,
  aggregateText: string,
): Promise<AgentOutput<RegulatorProgramResult>> {
  const userText = [
    'Audit this facility\'s Control of Hazardous Energy program end-to-end from the aggregate below.',
    '',
    aggregateText,
    '',
    'Evaluate each §3314 program element, surface systemic patterns with affected counts, and give ordered top priorities. Return JSON only.',
  ].join('\n')

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 4000,
    system:     [{ type: 'text', text: REGULATOR_PROGRAM_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: REGULATOR_PROGRAM_SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('Regulator program agent: no text block in response')
  const result = JSON.parse(textBlock.text) as RegulatorProgramResult

  return { result, usage: response.usage ?? null, model: MODEL }
}
