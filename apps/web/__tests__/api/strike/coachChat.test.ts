import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  gateRejects,
  messagesCreateMock,
  queueAnthropic,
  rateLimitBlocks,
  requireTenantMemberMock,
  resetAiMocks,
  logAiInvocationMock,
} from '../ai/_helpers'

// The coach is gated by STRIKE's own module gate, not the plain tenant gate
// the harness mocks, so route it to the same controllable mock.
vi.mock('@/lib/strike/gate', () => ({
  requireStrikeMember: (req: Request) => requireTenantMemberMock(req),
}))

const { captured, queues, tableProxy, retrieveContextMock } = vi.hoisted(() => {
  type Result = { data?: unknown; error?: { message: string } | null }
  const queues = new Map<string, Result[]>()
  const captured = { inserts: [] as Array<{ table: string; payload: Record<string, unknown> }> }
  const next = (table: string): Result => queues.get(table)?.shift() ?? { data: null, error: null }
  function tableProxy(table: string) {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update']) chain[m] = () => chain
    chain.insert = (payload: Record<string, unknown>) => { captured.inserts.push({ table, payload }); return chain }
    chain.maybeSingle = async () => next(table)
    chain.single = async () => next(table)
    chain.then = (resolve: (v: Result) => unknown, reject?: (r: unknown) => unknown) => Promise.resolve(next(table)).then(resolve, reject)
    return chain
  }
  const retrieveContextMock = vi.fn()
  return { captured, queues, tableProxy, retrieveContextMock }
})

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tableProxy(t) }) }))
vi.mock('@/lib/ai/rag', () => ({ retrieveContext: (a: unknown) => retrieveContextMock(a) }))

const MODULE_ID = '22222222-2222-2222-2222-222222222222'
const CONVERSATION_ID = '33333333-3333-3333-3333-333333333333'

function queue(table: string, ...rows: Array<{ data?: unknown; error?: { message: string } | null }>) {
  queues.set(table, [...(queues.get(table) ?? []), ...rows])
}

function post(body: unknown) {
  return new Request('http://x/api/strike/coach/chat', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'x-active-tenant': 'tenant-1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function systemText(): string {
  const args = messagesCreateMock.mock.calls.at(-1)?.[0] as unknown as { system: Array<{ text: string }> }
  return args.system.map(b => b.text).join('\n')
}

const RETRIEVED = {
  contextBlock: '<retrieved_context>\n  <doc title="LOTO Coach: Group lockout and shift change" cite="[LOTO Coach: Group lockout and shift change § 1910.147(f)(3)–(f)(4)]">Every worker adds their own lock.</doc>\n</retrieved_context>',
  chunks: [{
    chunk_id: 'c1', document_id: 'doc-1', chunk_index: 0, text: 'Every worker adds their own lock.',
    metadata: { section: '1910.147(f)(3)–(f)(4)' }, source_type: 'training',
    title: 'LOTO Coach: Group lockout and shift change', jurisdiction: null, effective_date: null,
    source_url: null, doc_tenant_id: null, similarity: 0.82,
  }],
  voyageTokens: 12,
}

beforeEach(() => {
  resetAiMocks()
  queues.clear()
  captured.inserts.length = 0
  retrieveContextMock.mockReset()
  retrieveContextMock.mockResolvedValue(RETRIEVED)
})

describe('POST /api/strike/coach/chat', () => {
  it('returns the gate status when the caller is not signed in', async () => {
    gateRejects(401, 'Missing bearer token')
    const { POST } = await import('@/app/api/strike/coach/chat/route')
    expect((await POST(post({ message: 'hi' }))).status).toBe(401)
  })

  it('returns 403 when STRIKE is off for the tenant', async () => {
    gateRejects(403, 'Module not enabled')
    const { POST } = await import('@/app/api/strike/coach/chat/route')
    expect((await POST(post({ message: 'hi' }))).status).toBe(403)
  })

  it('returns 429 with a retry hint once the coach rate limit is hit', async () => {
    rateLimitBlocks('hourly', 120)
    const { POST } = await import('@/app/api/strike/coach/chat/route')
    const res = await POST(post({ message: 'Can I use just a tag?' }))
    expect(res.status).toBe(429)
    expect((await res.json()).retryAfterSec).toBe(120)
    expect(messagesCreateMock).not.toHaveBeenCalled()
  })

  it('rejects an empty or oversized message before any model call', async () => {
    const { POST } = await import('@/app/api/strike/coach/chat/route')
    expect((await POST(post({ message: '   ' }))).status).toBe(400)
    expect((await POST(post({ message: 'x'.repeat(2001) }))).status).toBe(400)
    expect(messagesCreateMock).not.toHaveBeenCalled()
  })

  it('answers grounded in retrieved training docs, persists both turns, and logs the call', async () => {
    queue('tenants', { data: { name: 'Snak King' } })
    queue('strike_modules', { data: { title: 'LOTO 101', tenant_id: null, library_scope: 'global', status: 'published' } })
    queue('assistant_conversations', { data: { id: CONVERSATION_ID } })
    queue('assistant_messages', { data: null }, { data: [{ role: 'user', content: 'Do I need my own lock?', created_at: '2026-10-20T00:00:00Z' }] }, { data: { id: 'm2' } })
    queueAnthropic('Yes. Put your own lock on the group lockbox [LOTO Coach: Group lockout and shift change § 1910.147(f)(3)–(f)(4)].')

    const { POST } = await import('@/app/api/strike/coach/chat/route')
    const res = await POST(post({ message: 'Do I need my own lock?', module_id: MODULE_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reply).toContain('own lock')
    expect(body.citations).toEqual([expect.objectContaining({ document_id: 'doc-1', section: '1910.147(f)(3)–(f)(4)' })])

    expect(retrieveContextMock).toHaveBeenCalledWith(expect.objectContaining({ sources: expect.arrayContaining(['training', 'regulation']) }))
    expect(systemText()).toContain('cite="[LOTO Coach: Group lockout and shift change')
    expect(systemText()).toContain('The worker is in the STRIKE module "LOTO 101"')

    const conversation = captured.inserts.find(i => i.table === 'assistant_conversations')?.payload
    expect(conversation).toEqual(expect.objectContaining({ surface: 'strike_coach', user_id: 'user-1', tenant_id: 'tenant-1' }))
    const messages = captured.inserts.filter(i => i.table === 'assistant_messages').map(i => i.payload.role)
    expect(messages).toEqual(['user', 'assistant'])
    expect(logAiInvocationMock).toHaveBeenCalledWith(expect.objectContaining({ surface: 'strike-coach', status: 'success' }))
  })

  // The server decides, from the learner's own completions: a browser that
  // says the quiz is closed must not unlock graded answers.
  it.each([
    ['not yet passed the module', { data: [], error: null }, { attempt_open: false }, true],
    ['passed the module', { data: [{ id: 'c1' }], error: null }, { attempt_open: true }, false],
    ['a completion lookup that failed', { data: null, error: { message: 'boom' } }, { attempt_open: false }, true],
  ])('holds back graded answers for a learner who has %s, whatever the browser claims', async (_, completions, claim, expectRule) => {
    queue('strike_completions', completions)
    queue('assistant_conversations', { data: { id: CONVERSATION_ID } })
    queue('assistant_messages', { data: null }, { data: [{ role: 'user', content: 'Is the answer B?', created_at: 'x' }] })
    queueAnthropic('Let me explain the concept instead.')
    const { POST } = await import('@/app/api/strike/coach/chat/route')
    await POST(post({ message: 'Is the answer B?', module_id: MODULE_ID, ...claim }))
    if (expectRule) expect(systemText()).toContain('KNOWLEDGE CHECK IN PROGRESS')
    else expect(systemText()).not.toContain('KNOWLEDGE CHECK IN PROGRESS')
  })

  it('does not apply the quiz rule to general questions outside a module', async () => {
    queue('assistant_conversations', { data: { id: CONVERSATION_ID } })
    queue('assistant_messages', { data: null }, { data: [{ role: 'user', content: 'What is LOTO?', created_at: 'x' }] })
    queueAnthropic('LOTO is...')
    const { POST } = await import('@/app/api/strike/coach/chat/route')
    await POST(post({ message: 'What is LOTO?' }))
    expect(systemText()).not.toContain('KNOWLEDGE CHECK IN PROGRESS')
  })

  it('caches the static guardrail block and keeps it identical across calls', async () => {
    queue('assistant_conversations', { data: { id: CONVERSATION_ID } })
    queue('assistant_messages', { data: null }, { data: [{ role: 'user', content: 'hi', created_at: 'x' }] })
    queueAnthropic('Hello.')
    const { POST } = await import('@/app/api/strike/coach/chat/route')
    await POST(post({ message: 'hi' }))
    const args = messagesCreateMock.mock.calls.at(-1)?.[0] as unknown as { system: Array<{ text: string; cache_control?: unknown }> }
    expect(args.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(args.system[0].text).toContain('never authorize')
  })

  it("refuses to continue another user's or another surface's conversation", async () => {
    queue('assistant_conversations', { data: { id: CONVERSATION_ID, user_id: 'user-1', surface: 'assistant' } })
    const { POST } = await import('@/app/api/strike/coach/chat/route')
    const res = await POST(post({ message: 'hi', conversation_id: CONVERSATION_ID }))
    expect(res.status).toBe(404)
    expect(messagesCreateMock).not.toHaveBeenCalled()
  })
})
