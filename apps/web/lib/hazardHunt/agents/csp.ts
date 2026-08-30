// Certified Safety Professional agent — drafts a citation-backed write-up of a
// completed Hazard Hunt inspection. Pure call + parse + a deterministic hard
// gate; persistence + budget/rate-limit live in the runner (../runWriteUp.ts).

import type Anthropic from '@anthropic-ai/sdk'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import type { HazardHuntFindingRow } from '@soteria/core/hazardHunt'
import { CSP_WRITEUP_SCHEMA, type CspWriteUpResult, type AgentOutput } from './schemas'
import { CSP_SYSTEM } from './prompts'

const MODEL = MODEL_BY_SURFACE['hazard-hunt-csp']

export interface CspInspectionContext {
  title:        string
  templateName: string | null
  submittedAt:  string | null
  score:        number | null
  maxScore:     number | null
  result:       'pass' | 'fail' | null
}

export interface CspResponseLine {
  prompt: string
  result: 'pass' | 'fail' | 'na' | null
  note:   string | null
}

export async function runCspWriteUpAgent(
  client: Anthropic,
  inspection: CspInspectionContext,
  responses: CspResponseLine[],
  findings: HazardHuntFindingRow[],
): Promise<AgentOutput<CspWriteUpResult>> {
  const userText = buildContext(inspection, responses, findings)

  // No extended thinking — the prompt + schema carry the reasoning and the hard
  // gate below is enforced in TS regardless of the model's output.
  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 4000,
    // Explicit, per the posture rule: these are structured-output calls and
    // extended thinking pushes them past the shared token budget. Silence
    // here used to mean "whatever the model defaults to", which changed
    // under the Claude 5 move.
    thinking:   { type: 'disabled' },
    system:     [{ type: 'text', text: CSP_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: CSP_WRITEUP_SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('CSP agent: no text block in response')
  const result = JSON.parse(textBlock.text) as CspWriteUpResult

  // Hard gate (TS, not model goodwill): every finding that is not closed MUST be
  // represented. If the model dropped one, append a deterministic recommendation
  // so an open hazard can never be silently omitted from the write-up.
  for (const f of findings) {
    if (f.status === 'closed') continue
    const ref = f.finding_number ?? f.title
    const mentioned =
      result.recommendations.some(r => r.finding_ref.includes(ref) || r.finding_ref.includes(f.title))
      || result.summary.includes(f.title)
    if (!mentioned) {
      result.recommendations.push({
        item:            `Review and correct the open finding: ${f.title}.`,
        hierarchy_level: 'administrative',
        finding_ref:     ref,
      })
    }
  }

  return { result, usage: response.usage ?? null, model: MODEL }
}

function buildContext(
  inspection: CspInspectionContext,
  responses: CspResponseLine[],
  findings: HazardHuntFindingRow[],
): string {
  const scoreLine = inspection.score != null && inspection.maxScore != null
    ? `${inspection.score}/${inspection.maxScore} (${inspection.result ?? 'n/a'})`
    : (inspection.result ?? 'n/a')

  const failed = responses.filter(r => r.result === 'fail')
  const findingLines = findings.length
    ? findings.map(f =>
        `  - [${f.finding_number ?? f.id}] (${f.hazard_category}${f.severity_hint ? `, ${f.severity_hint}` : ''}) ${f.title}: ${f.description}`,
      ).join('\n')
    : '  (none recorded)'

  return [
    'Write up this completed Hazard Hunt inspection.',
    '',
    `Inspection: ${inspection.title}`,
    `Template: ${inspection.templateName ?? 'n/a'}`,
    `Submitted: ${inspection.submittedAt ?? 'n/a'}`,
    `Score: ${scoreLine}`,
    '',
    `Failed checklist items (${failed.length}):`,
    failed.length
      ? failed.map(r => `  - ${r.prompt}${r.note ? ` — note: ${r.note}` : ''}`).join('\n')
      : '  (none)',
    '',
    `Recorded findings (${findings.length}):`,
    findingLines,
    '',
    'Produce the executive summary, regulatory citations, and ranked corrective actions. JSON only.',
  ].join('\n')
}
