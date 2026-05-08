import type Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'
import { buildAssistantSystemPrompt } from '@/lib/ai/systemPrompt'
import { getToolDefinitions, runTool, type UserRole } from '@/lib/ai/tools'
import { retrieveContext, type RetrievedChunk } from '@/lib/ai/rag'

// POST /api/assistant/chat
//
// Home-page assistant. Cross-module conversational AI with tool use.
// Differs from /api/support/chat: that one is for "how do I use the
// app + ticket escalation"; this one is for domain reasoning across
// every tenant module + (PR2) regulatory + policy RAG + (PR3)
// scan-driven hazard reports + alerting/automation.
//
// Auth: bearer token + x-active-tenant header (requireTenantMember).
// Rate limit: 60/hr, 400/day per user (lib/ai/rateLimit.ts).
//
// Contract: non-streaming JSON. Streaming SSE lands in PR2 alongside
// pgvector RAG retrieval.

const MODEL = MODEL_BY_SURFACE['assistant-chat']
const MAX_TOKENS = 2000
const HISTORY_TURNS = 20
const MAX_TOOL_LOOPS = 4   // hard cap on tool-use roundtrips per turn

interface RequestBody {
  conversationId?: string
  message:         string
  pathname?:       string
}

interface PriorMessage {
  role:    'user' | 'assistant' | 'tool'
  content: string
  metadata: Record<string, unknown> | null
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: RequestBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const userText = (body.message ?? '').trim()
  if (!userText) return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  if (userText.length > 4000) {
    return NextResponse.json({ error: 'Message is too long (max 4,000 characters).' }, { status: 400 })
  }

  // Rate limit BEFORE any other work — same posture as the other AI surfaces.
  const limit = await checkAiRateLimit({
    userId:   gate.userId,
    tenantId: gate.tenantId,
    surface:  'assistant-chat',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `You have hit the ${limit.reason} message limit. Try again later.`, retryAfterSec: limit.retryAfterSec },
      { status: 429 },
    )
  }

  const admin = supabaseAdmin()

  // Tenant context for the system prompt.
  const { data: tenantRow } = await admin
    .from('tenants')
    .select('id, name, modules')
    .eq('id', gate.tenantId)
    .maybeSingle()
  const tenantName    = (tenantRow?.name ?? null) as string | null
  const tenantModules = (tenantRow?.modules ?? null) as Record<string, boolean> | null

  // Load or create the conversation.
  let conversationId: string
  if (body.conversationId) {
    const { data: existing } = await admin
      .from('assistant_conversations')
      .select('id, user_id')
      .eq('id', body.conversationId)
      .maybeSingle()
    if (!existing || existing.user_id !== gate.userId) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }
    conversationId = existing.id as string
  } else {
    const { data: created, error: createErr } = await admin
      .from('assistant_conversations')
      .insert({
        user_id:     gate.userId,
        tenant_id:   gate.tenantId,
        title:       userText.slice(0, 80),
        origin_path: body.pathname ?? null,
      })
      .select('id')
      .maybeSingle()
    if (createErr || !created) {
      Sentry.captureException(createErr, { tags: { route: '/api/assistant/chat', stage: 'create-conversation' } })
      return NextResponse.json({ error: 'Could not start a conversation.' }, { status: 500 })
    }
    conversationId = created.id as string
  }

  // Persist the user turn first so it's not lost if the model call fails.
  await admin.from('assistant_messages').insert({
    conversation_id: conversationId,
    role:            'user',
    content:         userText,
  })

  // Pull recent history (chronological, capped).
  const { data: priorRows } = await admin
    .from('assistant_messages')
    .select('role, content, metadata, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(HISTORY_TURNS)
  const prior: PriorMessage[] = (priorRows ?? [])
    .filter((r): r is PriorMessage & { created_at: string } =>
      r.role === 'user' || r.role === 'assistant' || r.role === 'tool',
    )
    .map(r => ({ role: r.role, content: r.content, metadata: r.metadata ?? null }))

  // RAG retrieval. Embeds the user's query via Voyage and matches it
  // against the knowledge_chunks corpus (regulations + this tenant's
  // policies). Failures degrade silently — the assistant still answers,
  // just without grounded citations.
  let retrieved: { contextBlock: string; chunks: RetrievedChunk[]; voyageTokens: number } = {
    contextBlock: '', chunks: [], voyageTokens: 0,
  }
  try {
    retrieved = await retrieveContext({ query: userText, tenantId: gate.tenantId, k: 8 })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/assistant/chat', stage: 'rag' } })
  }

  // System prompt with cache-control on the static block. The dynamic
  // block now includes the retrieved chunks so citation rules in the
  // static block have something concrete to anchor to.
  const { staticBlock, dynamicBlock } = buildAssistantSystemPrompt({
    tenant:           { id: gate.tenantId, name: tenantName, modules: tenantModules },
    user:             { role: gate.role as UserRole },
    pathname:         body.pathname ?? null,
    retrievedContext: retrieved.contextBlock,
    retrievedChunks:  retrieved.chunks,
  })

  // Get a configured client. getAnthropic throws on missing/malformed keys;
  // aiErrorToResponse maps both to clean HTTP responses.
  let client: Anthropic
  try {
    client = await getAnthropic(gate.tenantId)
  } catch (err) {
    const mapped = aiErrorToResponse(err, 'assistant-chat')
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/assistant/chat' } })
    return NextResponse.json(mapped.body, { status: mapped.status })
  }

  // Translate prior messages into the Anthropic SDK shape. Tool turns
  // need to be expanded back into tool_use / tool_result blocks; for
  // PR1 we replay them as plain text on the model side (cheap, slightly
  // noisier prompt) and revisit when streaming + structured tool replay
  // land in PR2. The model still sees its own prior tool calls — the
  // metadata column carries the tool_use_id + name when needed.
  const sdkMessages = prior.map(m => {
    if (m.role === 'tool') {
      // Render as a system-style note the assistant can read.
      return {
        role: 'user' as const,
        content: `[tool result] ${m.content}`,
      }
    }
    return { role: m.role, content: m.content }
  })

  // Tool-use loop. We let the model call tools up to MAX_TOOL_LOOPS times
  // before forcing a final text reply.
  const tools = getToolDefinitions()
  let totalInputTokens  = 0
  let totalOutputTokens = 0
  let totalCacheRead    = 0
  let lastResponse: Anthropic.Message | null = null
  const assistantBlocks: Anthropic.ContentBlock[] = []
  const toolHistory: Array<{ name: string; input: unknown; result: string }> = []

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system: [{
          type: 'text',
          text: staticBlock,
          // Static block is identical across calls — cache it. Subsequent
          // turns within the cache window pay ~10% of input tokens.
          cache_control: { type: 'ephemeral' },
        }, {
          type: 'text',
          text: dynamicBlock,
        }],
        tools,
        messages: sdkMessages,
      })
    } catch (err) {
      const mapped = aiErrorToResponse(err, 'assistant-chat')
      Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/assistant/chat', stage: `loop-${loop}` } })
      await logAiInvocation({
        userId:   gate.userId,
        tenantId: gate.tenantId,
        surface:  'assistant-chat',
        model:    MODEL,
        status:   'error',
        context:  err instanceof Error ? err.message.slice(0, 200) : 'create threw',
      })
      return NextResponse.json(mapped.body, { status: mapped.status })
    }

    lastResponse = response
    totalInputTokens  += response.usage?.input_tokens  ?? 0
    totalOutputTokens += response.usage?.output_tokens ?? 0
    totalCacheRead    += response.usage?.cache_read_input_tokens ?? 0

    // Collect any text blocks for the final reply.
    for (const block of response.content) {
      if (block.type === 'text') assistantBlocks.push(block)
    }

    // Stop if the model has nothing more to ask for.
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0 || response.stop_reason !== 'tool_use') break

    // Run each tool call; queue the results as a single user turn for the next loop.
    const toolResultBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
    for (const tu of toolUses) {
      const result = await runTool(tu.name, tu.input, {
        tenantId:       gate.tenantId,
        userId:         gate.userId,
        role:           gate.role as UserRole,
        conversationId,
      })
      toolHistory.push({ name: tu.name, input: tu.input, result })
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
    }

    // Append the assistant's tool-use turn + the tool results to the
    // history we hand back to the SDK on the next loop iteration.
    sdkMessages.push({ role: 'assistant', content: response.content as Anthropic.ContentBlockParam[] })
    sdkMessages.push({ role: 'user',      content: toolResultBlocks })
  }

  const reply = assistantBlocks.map(b => b.text).join('\n').trim()
                || 'I do not have an answer for that. Try rephrasing your question, or open a support ticket.'

  // Citation summary for the UI. We only ship a small projection (id,
  // title, source_type, jurisdiction, source_url, similarity) so the
  // payload stays lean — the full chunk text already lived in the
  // model's context, no need to send it back to the browser.
  const citations = retrieved.chunks.map(c => ({
    document_id:  c.document_id,
    chunk_index:  c.chunk_index,
    title:        c.title,
    source_type:  c.source_type,
    jurisdiction: c.jurisdiction,
    source_url:   c.source_url,
    similarity:   c.similarity,
  }))

  // Persist the assistant turn (with tool history + citations in metadata).
  const { data: assistantRow } = await admin
    .from('assistant_messages')
    .insert({
      conversation_id:    conversationId,
      role:               'assistant',
      content:            reply,
      metadata: (toolHistory.length > 0 || citations.length > 0)
        ? { tools: toolHistory.length > 0 ? toolHistory : undefined,
            citations: citations.length > 0 ? citations : undefined }
        : null,
      input_tokens:       totalInputTokens,
      output_tokens:      totalOutputTokens,
      cache_read_tokens:  totalCacheRead,
    })
    .select('id')
    .maybeSingle()

  await admin
    .from('assistant_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)

  await logAiInvocation({
    userId:           gate.userId,
    tenantId:         gate.tenantId,
    surface:          'assistant-chat',
    model:            MODEL,
    status:           'success',
    inputTokens:      totalInputTokens,
    outputTokens:     totalOutputTokens,
    cacheReadTokens:  totalCacheRead,
    context:          conversationId,
  })

  return NextResponse.json({
    conversationId,
    messageId:    assistantRow?.id ?? null,
    reply,
    tools:        toolHistory,
    citations,
    stopReason:   lastResponse?.stop_reason ?? null,
    usage: {
      inputTokens:     totalInputTokens,
      outputTokens:    totalOutputTokens,
      cacheReadTokens: totalCacheRead,
      voyageTokens:    retrieved.voyageTokens,
    },
  })
}
