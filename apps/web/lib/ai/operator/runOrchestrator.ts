import type Anthropic from '@anthropic-ai/sdk'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import type { AiSurface } from '@/lib/ai/rateLimit'
import type { ToolContext, UserRole } from '@/lib/ai/tools'
import { OPERATOR_AGENTS, ORCHESTRATOR_SURFACE, operatorAgentsForRole } from './agents'
import { buildOrchestratorSystemPrompt } from './prompts'
import { runSubAgent, type SubAgentResult } from './runSubAgent'
import type { OperatorStreamEvent } from './streamEvents'
import { roleMeets, type OperatorAgentId } from './types'

// The orchestrator turn: a bounded tool-use loop whose ONE tool is
// `delegate_to_agent`. The orchestrator (Opus) decides which specialist
// sub-agent owns a request, hands it a self-contained task, folds the
// sub-agent's answer back in as a tool_result, and synthesizes a final reply —
// optionally delegating several times across a turn.
//
// This is the analogue of runSubAgent one level up, and it keeps the same
// discipline: the Anthropic client is INJECTED (the route owns getAnthropic +
// tenant-key resolution) and this function NEVER logs, touches Supabase, or
// references HTTP. Streaming is decoupled via an optional `onEvent` callback the
// route wires to SSE; per-surface logging is the route's job, fed by
// `usageBySurface`.
//
// Streaming caveat: runSubAgent runs to completion before returning, so a
// sub-agent's `agent_tool_call` milestones are emitted right after it finishes
// (a burst), not live as each tool runs. That is acceptable at milestone
// granularity; live per-tool streaming would mean threading `onEvent` into
// runSubAgent (a later slice).

export const ORCHESTRATOR_MAX_LOOPS = 6
const ORCHESTRATOR_MAX_TOKENS = 4000
const DELEGATE_TOOL = 'delegate_to_agent'

export interface OrchestratorDelegation {
  agentId: OperatorAgentId
  task: string
  result: SubAgentResult
}

export interface SurfaceUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  modelCalls: number
}

export interface OrchestratorResult {
  /** The orchestrator's final synthesized answer. */
  text: string
  /** One entry per successful delegation, in order. */
  delegations: OrchestratorDelegation[]
  /** Token usage keyed by AI surface — the orchestrator's own plus each
   *  delegated sub-agent's — so the route can write one ai_invocations row per
   *  surface for cost attribution. */
  usageBySurface: Partial<Record<AiSurface, SurfaceUsage>>
  /** Orchestrator model round-trips. */
  modelCalls: number
  /** True when the loop hit its cap before the orchestrator stopped delegating. */
  hitLoopCap: boolean
}

export interface RunOrchestratorArgs {
  /** The user's current turn. */
  message: string
  /** Prior turns already in SDK shape (route maps them from the DB). */
  history?: Anthropic.MessageParam[]
  ctx: ToolContext
  /** Injected, tenant-configured Anthropic client (shared with sub-agents). */
  client: Anthropic
  tenantName?: string | null
  tenantModules?: Record<string, boolean> | null
  /** Milestone callback the route forwards to SSE. Synchronous. */
  onEvent?: (e: OperatorStreamEvent) => void
  /** Override the loop cap (tests). */
  maxLoops?: number
}

/** The role-limited delegate tool: its `agentId` enum is exactly the agents the
 *  caller's role may interact with, so the model can't even propose a forbidden
 *  one. `allowed` is returned too for a defense-in-depth re-check at call time. */
function buildDelegateTool(role: UserRole): { tool: Anthropic.Tool; allowed: Set<OperatorAgentId> } {
  const agents = operatorAgentsForRole(minRole => roleMeets(role, minRole))
  const tool: Anthropic.Tool = {
    name: DELEGATE_TOOL,
    description:
      'Hand a self-contained task to the specialist sub-agent that owns that domain. ' +
      'Choose exactly one agent per call; you may call this several times in sequence and ' +
      'synthesize their results. The sub-agent uses its own tools and returns a short answer.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          enum: agents.map(a => a.id),
          description: agents.map(a => `${a.id}: ${a.purpose}`).join('  |  '),
        },
        task: {
          type: 'string',
          description:
            'A complete, standalone instruction for the sub-agent. Include every detail it needs — ' +
            'it cannot see this conversation.',
        },
      },
      required: ['agentId', 'task'],
    },
  }
  return { tool, allowed: new Set(agents.map(a => a.id)) }
}

function addUsage(
  acc: Partial<Record<AiSurface, SurfaceUsage>>,
  surface: AiSurface,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number },
  modelCalls: number,
): void {
  const cur = acc[surface] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, modelCalls: 0 }
  cur.inputTokens += usage.inputTokens
  cur.outputTokens += usage.outputTokens
  cur.cacheReadTokens += usage.cacheReadTokens
  cur.modelCalls += modelCalls
  acc[surface] = cur
}

function refuseDelegation(reason: string): string {
  return JSON.stringify({ ok: false, refusal: reason })
}

export async function runOrchestrator(args: RunOrchestratorArgs): Promise<OrchestratorResult> {
  const { message, ctx, client, onEvent } = args
  const model = MODEL_BY_SURFACE[ORCHESTRATOR_SURFACE]
  const { tool: delegateTool, allowed } = buildDelegateTool(ctx.role)
  const { staticBlock, dynamicBlock } = buildOrchestratorSystemPrompt({
    role: ctx.role,
    tenantName: args.tenantName ?? null,
    tenantModules: args.tenantModules ?? null,
  })

  const messages: Anthropic.MessageParam[] = [
    ...(args.history ?? []),
    { role: 'user', content: message },
  ]

  const textOut: string[] = []
  const delegations: OrchestratorDelegation[] = []
  const usageBySurface: Partial<Record<AiSurface, SurfaceUsage>> = {}
  let modelCalls = 0
  let hitLoopCap = false
  let delegationIndex = 0

  const maxLoops = args.maxLoops ?? ORCHESTRATOR_MAX_LOOPS

  for (let loop = 0; loop < maxLoops; loop++) {
    const response = await client.messages.create({
      model,
      max_tokens: ORCHESTRATOR_MAX_TOKENS,
      thinking:   { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: staticBlock, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamicBlock },
      ],
      tools: [delegateTool],
      messages,
    })
    modelCalls++
    addUsage(usageBySurface, ORCHESTRATOR_SURFACE, {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
    }, 1)

    for (const block of response.content) {
      if (block.type === 'text') textOut.push(block.text)
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    if (toolUses.length === 0 || response.stop_reason !== 'tool_use') break

    const toolResultBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
    for (const tu of toolUses) {
      if (tu.name !== DELEGATE_TOOL) {
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: refuseDelegation(`Unknown tool '${tu.name}'. Use ${DELEGATE_TOOL}.`),
        })
        continue
      }

      const input = (tu.input ?? {}) as { agentId?: unknown; task?: unknown }
      const task = typeof input.task === 'string' ? input.task.trim() : ''

      // Defense in depth: the enum already constrains agentId, but the model can
      // still hallucinate one — never call runSubAgent for a forbidden agent.
      if (typeof input.agentId !== 'string' || !allowed.has(input.agentId as OperatorAgentId)) {
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: refuseDelegation(
            `Cannot delegate to '${String(input.agentId)}': not a permitted agent for this user's role. ` +
            `Permitted: ${[...allowed].join(', ')}.`,
          ),
        })
        continue
      }

      const agentId = input.agentId as OperatorAgentId
      const spec = OPERATOR_AGENTS[agentId]
      const index = delegationIndex++
      onEvent?.({ type: 'delegation_start', agentId, title: spec.title, task, index })

      const result = await runSubAgent({
        agentId,
        task,
        ctx,
        client,
        tenantName: args.tenantName ?? null,
        tenantModules: args.tenantModules ?? null,
      })
      addUsage(usageBySurface, spec.surface, result.usage, result.modelCalls)
      delegations.push({ agentId, task, result })

      for (const call of result.toolCalls) {
        onEvent?.({ type: 'agent_tool_call', agentId, tool: call.name, index })
      }
      onEvent?.({
        type: 'agent_done',
        agentId,
        index,
        text: result.text,
        toolCalls: result.toolCalls.length,
        hitLoopCap: result.hitLoopCap,
      })

      const content = result.text.trim().length > 0
        ? result.text
        : `(The ${spec.title} finished but returned no text${result.hitLoopCap ? '; it reached its step limit.' : '.'})`
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content })
    }

    messages.push({ role: 'assistant', content: response.content as Anthropic.ContentBlockParam[] })
    messages.push({ role: 'user', content: toolResultBlocks })

    if (loop === maxLoops - 1) hitLoopCap = true
  }

  return {
    text: textOut.join('\n').trim(),
    delegations,
    usageBySurface,
    modelCalls,
    hitLoopCap,
  }
}
