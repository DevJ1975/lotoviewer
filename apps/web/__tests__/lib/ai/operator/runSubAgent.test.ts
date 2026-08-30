import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'

// Reused-read-handler DB mock (list_risks hits supabaseAdmin).
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

import { runSubAgent } from '@/lib/ai/operator/runSubAgent'

const ctx = { tenantId: 'tenant-A', userId: 'u1', role: 'member' as const, conversationId: 'c1' }

// Minimal Anthropic stub: messages.create returns the queued responses in order.
function clientReturning(responses: unknown[]): Anthropic {
  let i = 0
  return {
    messages: { create: vi.fn(async () => responses[Math.min(i++, responses.length - 1)]) },
  } as unknown as Anthropic
}

beforeEach(() => {
  recorder = { tables: [], eq: [] }
  nextResult = { data: [], error: null }
})

describe('runSubAgent', () => {
  it('returns the model text when no tools are called', async () => {
    const client = clientReturning([
      { content: [{ type: 'text', text: 'All clear.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 4 } },
    ])
    const res = await runSubAgent({ agentId: 'risk', task: 'status?', ctx, client })
    expect(res.text).toBe('All clear.')
    expect(res.modelCalls).toBe(1)
    expect(res.toolCalls).toEqual([])
    expect(res.hitLoopCap).toBe(false)
  })

  it('executes a tool call then returns the follow-up text', async () => {
    const client = clientReturning([
      { content: [{ type: 'tool_use', id: 't1', name: 'list_risks', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 12, output_tokens: 6 } },
      { content: [{ type: 'text', text: 'You have no open risks.' }], stop_reason: 'end_turn', usage: { input_tokens: 8, output_tokens: 5 } },
    ])
    const res = await runSubAgent({ agentId: 'risk', task: 'list risks', ctx, client })
    expect(res.toolCalls).toHaveLength(1)
    expect(res.toolCalls[0].name).toBe('list_risks')
    expect(JSON.parse(res.toolCalls[0].result).ok).toBe(true)
    expect(recorder.eq).toContainEqual(['tenant_id', 'tenant-A'])
    expect(res.text).toContain('no open risks')
    expect(res.modelCalls).toBe(2)
  })

  it('passes only role-filtered tools to the model (viewer gets none for risk)', async () => {
    const client = clientReturning([
      { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} },
    ])
    await runSubAgent({ agentId: 'risk', task: 'x', ctx: { ...ctx, role: 'viewer' }, client })
    expect(client.messages.create).toHaveBeenCalledWith(expect.objectContaining({ tools: [] }))
  })

  it('stops at the loop cap when the model keeps requesting tools', async () => {
    const client = clientReturning([
      { content: [{ type: 'tool_use', id: 't', name: 'list_risks', input: {} }], stop_reason: 'tool_use', usage: {} },
    ])
    const res = await runSubAgent({ agentId: 'risk', task: 'loop', ctx, client, maxLoops: 2 })
    expect((client.messages.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2)
    expect(res.modelCalls).toBe(2)
    expect(res.hitLoopCap).toBe(true)
  })
})
