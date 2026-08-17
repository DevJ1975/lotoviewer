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
import type { LotoStepType } from '@soteria/core/lotoProcedureValidation'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { AUTHOR_SCHEMA, type AuthorResult, type EhsCitation } from '../schemas'
import { AUTHOR_SYSTEM, describeEquipment, describeSteps, describeFindings } from '../prompts'
import type { AgentOutput } from './fpe'
import { assertNotRefused } from '@/lib/ai/client'

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
    thinking:   { type: 'disabled' },
    // Cache the static system prompt — a full audit run drafts for many failed
    // machines in one burst, all sharing this prompt.
    system:     [{ type: 'text', text: AUTHOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: AUTHOR_SCHEMA } },
  })

  assertNotRefused(response, 'loto-audit-author')
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('Author agent: no text block in response')
  const result = JSON.parse(textBlock.text) as AuthorResult

  return { result, usage: response.usage ?? null, model: MODEL }
}
