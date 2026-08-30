import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { OperatorStreamEvent } from '@/lib/ai/operator/streamEvents'

// Reused-read-handler DB mock — a delegated sub-agent's tools (e.g. list_risks)
// hit supabaseAdmin. Same thenable-builder idiom as runSubAgent.test.ts.
interface Recorder { tables: string[]; eq: Array<[string, unknown]> }
let recorder: Recorder
let nextResult: { data: unknown; error: { message: string } | null }

function makeBuilder() {
  const b: Record<string, unknown> = {}
  const ret = () => b
  for (const m of ['select', 'order', 'limit', 'ilike', 'in', 'lt', 'lte', 'gt', 'gte', 'not', 'is', 'maybeSingle']) {
    b[m] = ret
  }
  b.eq = (col: string, val: unknown) => { recorder.eq.push([col, val]); return b }
  b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(nextResult).then(onF, onR)
  return b
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => { recorder.tables.push(table); return makeBuilder() },
  }),
}))

import { runOrchestrator } from '@/lib/ai/operator/runOrchestrator'

const ctx = { tenantId: 'tenant-A', userId: 'u1', role: 'member' as const, conversationId: 'c1' }

// An orchestrator call is the one whose tool list contains delegate_to_agent;
// everything else is a sub-agent call. Two independent response queues let a
// test script both layers without their turns interleaving by index.
function isOrchestratorCall(arg: unknown): boolean {
  const tools = (arg as { tools?: Array<{ name?: string }> }).tools
  return Array.isArray(tools) && tools.some(t => t?.name === 'delegate_to_agent')
}

function clientWithQueues(orchestrator: unknown[], subAgent: unknown[]): Anthropic {
  let oi = 0
  let si = 0
  return {
    messages: {
      create: vi.fn(async (arg: unknown) =>
        isOrchestratorCall(arg)
          ? orchestrator[Math.min(oi++, orchestrator.length - 1)]
          : subAgent[Math.min(si++, subAgent.length - 1)],
      ),
    },
  } as unknown as Anthropic
}

const text = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 3 } })
const delegate = (agentId: string, task: string) => ({
  content: [{ type: 'tool_use', id: `d-${agentId}`, name: 'delegate_to_agent', input: { agentId, task } }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 12, output_tokens: 6 },
})
const subToolUse = (name: string) => ({
  content: [{ type: 'tool_use', id: `t-${name}`, name, input: {} }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 8, output_tokens: 4 },
})

beforeEach(() => {
  recorder = { tables: [], eq: [] }
  nextResult = { data: [], error: null }
})

describe('runOrchestrator', () => {
  it('delegates to a sub-agent then synthesizes a final answer', async () => {
    const client = clientWithQueues(
      [delegate('risk', 'list open risks'), text('You have no open risks.')],
      [text('No open risks found.')],
    )
    const res = await runOrchestrator({ message: 'any open risks?', ctx, client })

    expect(res.delegations).toHaveLength(1)
    expect(res.delegations[0].agentId).toBe('risk')
    expect(res.delegations[0].result.text).toBe('No open risks found.')
    expect(res.text).toBe('You have no open risks.')
    expect(res.modelCalls).toBe(2)            // two orchestrator round-trips
    expect(res.hitLoopCap).toBe(false)
  })

  it('builds the delegate enum from the caller role (viewer → knowledge only)', async () => {
    const client = clientWithQueues([text('hi')], [])
    await runOrchestrator({ message: 'hello', ctx: { ...ctx, role: 'viewer' }, client })

    const firstCall = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const enumValues: string[] = firstCall.tools[0].input_schema.properties.agentId.enum
    expect(enumValues).toContain('knowledge')
    expect(enumValues).not.toContain('risk')   // member-gated
    expect(enumValues).not.toContain('osha')   // admin-gated
    expect(enumValues).not.toContain('admin')
  })

  it('excludes admin-only agents for a member but includes them for an admin', async () => {
    const memberClient = clientWithQueues([text('hi')], [])
    await runOrchestrator({ message: 'x', ctx, client: memberClient })
    const memberEnum: string[] = (memberClient.messages.create as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].tools[0].input_schema.properties.agentId.enum
    expect(memberEnum).toContain('risk')
    expect(memberEnum).not.toContain('osha')

    const adminClient = clientWithQueues([text('hi')], [])
    await runOrchestrator({ message: 'x', ctx: { ...ctx, role: 'admin' }, client: adminClient })
    const adminEnum: string[] = (adminClient.messages.create as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].tools[0].input_schema.properties.agentId.enum
    expect(adminEnum).toEqual(expect.arrayContaining(['risk', 'osha', 'admin', 'home']))
  })

  it('refuses to delegate to an agent the role cannot use, without invoking the sub-agent', async () => {
    // member tries to be routed to the admin-only osha agent (mock ignores the enum).
    const client = clientWithQueues(
      [delegate('osha', 'certify the 300A'), text('That needs an OSHA-authorized admin.')],
      [text('SHOULD NOT RUN')],
    )
    const events: OperatorStreamEvent[] = []
    const res = await runOrchestrator({ message: 'certify our 300A', ctx, client, onEvent: e => events.push(e) })

    expect(res.delegations).toHaveLength(0)
    expect(events.some(e => e.type === 'delegation_start')).toBe(false)
    // No sub-agent call happened: the only create() calls were the two orchestrator turns.
    expect((client.messages.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2)
    expect(res.text).toContain('OSHA-authorized admin')
  })

  it('emits milestones in order: delegation_start → agent_tool_call → agent_done', async () => {
    const client = clientWithQueues(
      [delegate('risk', 'count risks'), text('done')],
      [subToolUse('list_risks'), text('one risk')],
    )
    const events: OperatorStreamEvent[] = []
    await runOrchestrator({ message: 'count risks', ctx, client, onEvent: e => events.push(e) })

    expect(events.map(e => e.type)).toEqual(['delegation_start', 'agent_tool_call', 'agent_done'])
    const toolCall = events.find(e => e.type === 'agent_tool_call')
    expect(toolCall && toolCall.type === 'agent_tool_call' && toolCall.tool).toBe('list_risks')
  })

  it('aggregates usage per surface (orchestrator + each delegated sub-agent)', async () => {
    const client = clientWithQueues(
      [delegate('risk', 'x'), text('synth')],
      [text('sub answer')],
    )
    const res = await runOrchestrator({ message: 'x', ctx, client })

    expect(res.usageBySurface['operator-orchestrator']?.modelCalls).toBe(2)
    expect(res.usageBySurface['operator-orchestrator']?.inputTokens).toBeGreaterThan(0)
    expect(res.usageBySurface['operator-risk']?.modelCalls).toBe(1)
    expect(res.usageBySurface['operator-risk']?.inputTokens).toBeGreaterThan(0)
  })

  it('stops at the loop cap when the orchestrator keeps delegating', async () => {
    const client = clientWithQueues(
      [delegate('risk', 'again')],   // repeats: orchestrator never stops delegating
      [text('sub done')],            // each sub-agent finishes immediately
    )
    const res = await runOrchestrator({ message: 'loop', ctx, client, maxLoops: 2 })

    expect(res.modelCalls).toBe(2)
    expect(res.hitLoopCap).toBe(true)
    expect(res.delegations).toHaveLength(2)
  })
})
