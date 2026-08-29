// Procedure Author — drafts a CORRECTED energy-control procedure for a machine
// that failed the EHS compliance gate. It reuses the proven generate-loto-steps
// authoring approach (food-production framing, energy-code table, structured
// json_schema output) but works from the existing deficient procedure + the EHS
// findings + DS notes, and is told to address every cited deficiency.
//
// SAFETY POSTURE: this agent is NEVER the authority. Its output is staged as a
// `procedure_draft` change for a qualified safety professional to review, edit,
// and sign through the audit review link before it can touch live steps. The
// honesty rule — never fabricate a site-specific identifier, emit a literal
// "[VERIFY ON SITE: ...]" placeholder instead — is enforced via the prompt and
// the schema field descriptions. No extended thinking (it pushed these
// structured calls past the shared client timeout, same as the other agents).

import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { LOTO_STEP_ORDER, validateProcedure, type LotoStepType } from '@soteria/core/lotoProcedureValidation'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { AUTHOR_SCHEMA, type AuthorResult, type EhsCitation } from '../schemas'
import { AUTHOR_SYSTEM, describeEquipment, describeSteps, describeFindings } from '../prompts'
import type { AgentOutput } from './fpe'

const MODEL = MODEL_BY_SURFACE['loto-audit-author']

export async function runAuthorAgent(
  client: Anthropic,
  equipment: Equipment,
  steps: LotoEnergyStep[],
  ehsCitations: EhsCitation[],
  ehsRecommendations: string[],
  dsNotes: string,
  missingPhases: LotoStepType[],
): Promise<AgentOutput<AuthorResult>> {
  const userText = [
    'Draft a corrected LOTO energy-control procedure for this non-compliant machine.',
    'The existing procedure failed the EHS compliance gate — fix every cited deficiency.',
    '',
    describeEquipment(equipment),
    '',
    'Existing (deficient) energy steps:',
    describeSteps(steps),
    '',
    describeFindings(ehsCitations, ehsRecommendations),
    '',
    `OSHA phases the existing procedure is MISSING: ${missingPhases.length ? missingPhases.join(', ') : 'none'}`,
    `Data-Scientist consistency notes: ${dsNotes || '(none)'}`,
    '',
    'Return the corrected procedure as JSON only. Emit a "[VERIFY ON SITE: <what to confirm>]" placeholder for any site-specific identifier you cannot derive from the data above — never invent one.',
  ].join('\n')

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 8000,
    // Cache the static system prompt — a full audit run drafts for many failed
    // machines in one burst, all sharing this prompt.
    system:     [{ type: 'text', text: AUTHOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: AUTHOR_SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('Author agent: no text block in response')
  const result = JSON.parse(textBlock.text) as AuthorResult

  assertUsableDraft(result, equipment.equipment_id)

  return { result, usage: response.usage ?? null, model: MODEL }
}

/**
 * Refuse a draft that would make the machine LESS safe if approved.
 *
 * Applying a `procedure_draft` REPLACES the machine's whole step set
 * (migration 220: delete-then-insert from `new_value -> 'steps'`). A draft
 * with zero steps therefore deletes the procedure outright and reprints a
 * blank placard for the panel; a draft still missing a required phase ships a
 * shorter, still non-compliant procedure that the audit existed to prevent.
 *
 * Structured output makes both unlikely, not impossible — a truncated or
 * degraded response still parses. `/api/generate-loto-steps` already refuses an
 * empty step list; this is the same guard on the path that can overwrite live
 * data, plus the phase check that path doesn't need.
 *
 * Throwing (rather than staging a bad draft) is deliberate: `processEquipment`
 * records the failure against the machine, so the deficiency stays visible to
 * the reviewer instead of being silently "corrected".
 */
function assertUsableDraft(result: AuthorResult, equipmentId: string): void {
  if (!Array.isArray(result.steps) || result.steps.length === 0) {
    throw new Error(`Author agent: empty step list for ${equipmentId} — refusing to stage a draft that would delete the procedure`)
  }

  const allowed = new Set<string>(LOTO_STEP_ORDER)
  const bad = result.steps.map(s => s.step_type).filter(t => !allowed.has(t))
  if (bad.length > 0) {
    throw new Error(`Author agent: unknown step_type(s) for ${equipmentId}: ${[...new Set(bad)].join(', ')}`)
  }

  // The same validator that flagged the original procedure. A "correction" that
  // still fails it is not a correction.
  const { missing } = validateProcedure(
    result.steps.map((s, i) => ({ step_type: s.step_type as LotoStepType, sequence_order: i })),
  )
  if (missing.length > 0) {
    throw new Error(`Author agent: draft for ${equipmentId} is still missing required phase(s): ${missing.join(', ')}`)
  }
}
