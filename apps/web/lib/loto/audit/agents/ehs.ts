// Agent 3 — Senior EHS Specialist (Cal/OSHA gate). Verifies the procedure
// against Cal/OSHA Title 8 §3314 + 1910.147 and holds sign-off authority.
//
// The model cites the regulations from the prompt's encoded requirements; the
// ingested Cal/OSHA T8 corpus (scripts/ingest-cal-osha-t8.mjs) can later
// augment this via RAG. Whatever the model returns, the HARD safety rules are
// re-enforced in TS below so a placeholder / missing-verification procedure can
// never pass — the gate is not allowed to depend on model goodwill.

import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import type { LotoStepType } from '@soteria/core/lotoProcedureValidation'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { EHS_SCHEMA, type EhsResult, type DsResult, type FpeResult } from '../schemas'
import { EHS_SYSTEM, describeEquipment, describeSteps } from '../prompts'
import type { AgentOutput } from './fpe'

const MODEL = MODEL_BY_SURFACE['loto-audit-ehs']

export async function runEhsAgent(
  client: Anthropic,
  equipment: Equipment,
  steps: LotoEnergyStep[],
  ds: DsResult,
  fpe: FpeResult,
  missingPhases: LotoStepType[],
): Promise<AgentOutput<EhsResult>> {
  // What the deterministic + upstream signals already tell us. The model is
  // asked to reason as the authority, but these are the non-negotiables.
  const isoUnverified =
    fpe.iso_photo.verdict === 'missing' ||
    fpe.iso_photo.verdict === 'mismatch' ||
    ds.low_confidence_iso
  const missingZeroEnergy = missingPhases.includes('verify_zero_energy')

  const userText = [
    'Run the Cal/OSHA compliance gate on this LOTO procedure.',
    '',
    describeEquipment(equipment),
    '',
    'Energy steps:',
    describeSteps(steps),
    '',
    `OSHA phases missing: ${missingPhases.length ? missingPhases.join(', ') : 'none'}`,
    `Isolation photo verdict: ${fpe.iso_photo.verdict}; Data-Scientist low_confidence_iso: ${ds.low_confidence_iso}`,
    `Data-Scientist notes: ${ds.notes}`,
    '',
    'Decide pass, cite each deficiency with its regulation code, and recommend fixes. Reply with JSON only.',
  ].join('\n')

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 4000,
    thinking:   { type: 'adaptive' },
    system:     [{ type: 'text', text: EHS_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: EHS_SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('EHS agent: no text block in response')
  const result = JSON.parse(textBlock.text) as EhsResult

  // ── Hard gate (enforced regardless of model output) ───────────────────────
  if (missingZeroEnergy || isoUnverified) {
    result.pass = false
    if (missingZeroEnergy && !result.citations.some(c => /verif|zero[- ]?energy|tryout/i.test(`${c.code} ${c.text}`))) {
      result.citations.push({
        code: '29 CFR 1910.147(c)(4)(ii) / Cal/OSHA T8 §3314(g)',
        text: 'Procedure lacks a documented zero-energy verification (tryout) step before work begins.',
        severity: 'critical',
      })
    }
    if (isoUnverified && !result.citations.some(c => /isolation point|placeholder|photo/i.test(`${c.code} ${c.text}`))) {
      result.citations.push({
        code: 'Cal/OSHA T8 §3314(g)(4)',
        text: 'Isolation point is unverified (placeholder, missing, or mismatched photo); the lock-application location cannot be confirmed.',
        severity: 'high',
      })
    }
  }

  return { result, usage: response.usage ?? null, model: MODEL }
}
