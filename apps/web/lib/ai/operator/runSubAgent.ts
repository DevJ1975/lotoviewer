import type Anthropic from '@anthropic-ai/sdk'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import type { ToolContext } from '@/lib/ai/tools'
import { OPERATOR_AGENTS } from './agents'
import { buildSubAgentSystemPrompt } from './prompts'
import { getOperatorToolDefinitions, runOperatorTool } from './registry'
import type { OperatorAgentId } from './types'

// Runs ONE operator sub-agent to completion: a bounded tool-use loop with only
// that agent's role-filtered tools, its own system prompt, and its own model.
// This is the analogue of the LOTO audit's per-item agent loop, and it mirrors
// the home assistant's loop in app/api/assistant/chat/route.ts.
//
// The Anthropic client is injected (not constructed here) so the orchestrator
// route owns getAnthropic/tenant-key resolution and so this is unit-testable
// with a mock client.

export const MAX_SUBAGENT_LOOPS = 4
const SUBAGENT_MAX_TOKENS = 3000

export interface SubAgentToolCall {
  name: string
  input: unknown
  result: string
}

export interface SubAgentResult {
  agent: OperatorAgentId
  /** The sub-agent's final natural-language answer to its delegated task. */
  text: string
  toolCalls: SubAgentToolCall[]
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
  /** Number of model round-trips this sub-agent made (for cost attribution). */
  modelCalls: number
  /** True when the loop hit its cap before the model stopped asking for tools. */
  hitLoopCap: boolean
}

export interface RunSubAgentArgs {
  agentId: OperatorAgentId
  /** The self-contained task the orchestrator handed this sub-agent. */
  task: string
  ctx: ToolContext
  /** Injected, tenant-configured Anthropic client. */
  client: Anthropic
  tenantName?: string | null
  tenantModules?: Record<string, boolean> | null
  /** Override the loop cap (tests). */
  maxLoops?: number
}

export async function runSubAgent(args: RunSubAgentArgs): Promise<SubAgentResult> {
  const { agentId, task, ctx, client } = args
  const spec = OPERATOR_AGENTS[agentId]
  const model = MODEL_BY_SURFACE[spec.surface]
  const tools = getOperatorToolDefinitions(agentId, ctx.role)
  const { staticBlock, dynamicBlock } = buildSubAgentSystemPrompt(agentId, {
    role: ctx.role,
    tenantName: args.tenantName ?? null,
    tenantModules: args.tenantModules ?? null,
  })

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task }]
  const textOut: string[] = []
  const toolCalls: SubAgentToolCall[] = []
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let modelCalls = 0
  let hitLoopCap = false

  const maxLoops = args.maxLoops ?? MAX_SUBAGENT_LOOPS

  for (let loop = 0; loop < maxLoops; loop++) {
    const response = await client.messages.create({
      model,
      max_tokens: SUBAGENT_MAX_TOKENS,
      thinking:   { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: staticBlock, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamicBlock },
      ],
      tools,
      messages,
    })
    modelCalls++
    inputTokens += response.usage?.input_tokens ?? 0
    outputTokens += response.usage?.output_tokens ?? 0
    cacheReadTokens += response.usage?.cache_read_input_tokens ?? 0

    for (const block of response.content) {
      if (block.type === 'text') textOut.push(block.text)
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    if (toolUses.length === 0 || response.stop_reason !== 'tool_use') break

    const toolResultBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
    for (const tu of toolUses) {
      const result = await runOperatorTool(agentId, tu.name, tu.input, ctx)
      toolCalls.push({ name: tu.name, input: tu.input, result })
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
    }

    messages.push({ role: 'assistant', content: response.content as Anthropic.ContentBlockParam[] })
    messages.push({ role: 'user', content: toolResultBlocks })

    if (loop === maxLoops - 1) hitLoopCap = true
  }

  return {
    agent: agentId,
    text: textOut.join('\n').trim(),
    toolCalls,
    usage: { inputTokens, outputTokens, cacheReadTokens },
    modelCalls,
    hitLoopCap,
  }
}
