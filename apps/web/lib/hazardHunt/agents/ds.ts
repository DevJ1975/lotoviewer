// Data Scientist agent — narrates the DETERMINISTIC hazard-finding metrics into
// a trend read. It never computes the metrics or the EHS score; it interprets
// the numbers it is handed (summarizeHazardHuntMetrics).

import type Anthropic from '@anthropic-ai/sdk'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import type { HazardHuntMetrics } from '@soteria/core/hazardHuntMetrics'
import { DS_TRENDS_SCHEMA, type DsTrendsResult, type AgentOutput } from './schemas'
import { DS_SYSTEM } from './prompts'

const MODEL = MODEL_BY_SURFACE['hazard-hunt-ds']

export async function runDsTrendsAgent(
  client: Anthropic,
  metrics: HazardHuntMetrics,
): Promise<AgentOutput<DsTrendsResult>> {
  const userText = describeMetrics(metrics)

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 2000,
    // Explicit, per the posture rule: these are structured-output calls and
    // extended thinking pushes them past the shared token budget. Silence
    // here used to mean "whatever the model defaults to", which changed
    // under the Claude 5 move.
    thinking:   { type: 'disabled' },
    system:     [{ type: 'text', text: DS_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: DS_TRENDS_SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('DS agent: no text block in response')
  const result = JSON.parse(textBlock.text) as DsTrendsResult

  return { result, usage: response.usage ?? null, model: MODEL }
}

function describeMetrics(m: HazardHuntMetrics): string {
  const byCat = m.byCategory
    .filter(c => c.count > 0)
    .map(c => `  - ${c.category}: ${c.count}`)
    .join('\n') || '  (no findings)'

  return [
    'Interpret these deterministic Hazard Hunt metrics. Do not recompute them.',
    '',
    `Total findings: ${m.totalFindings} (open ${m.openFindings}, resolved ${m.resolvedFindings})`,
    `Cadence adherence: ${(m.cadenceAdherence * 100).toFixed(0)}%`,
    `Trend (recent vs prior window): ${m.trend.recentOpened} vs ${m.trend.priorOpened} opened (delta ${m.trend.delta >= 0 ? '+' : ''}${m.trend.delta})`,
    '',
    'Findings by hazard category:',
    byCat,
    '',
    'Return top_categories (copy the counts above), a short narrative, and watch_items. JSON only.',
  ].join('\n')
}
