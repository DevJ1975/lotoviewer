import type Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireStrikeMember } from '@/lib/strike/gate'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'
import { toSendableHistory } from '@/lib/ai/conversationWindow'
import { retrieveContext, type KnowledgeSource, type RetrievedChunk } from '@/lib/ai/rag'
import { parseStrikeContent } from '@soteria/core/strikeContent'
import { buildCoachDynamicPrompt, LOTO_COACH_STATIC_PROMPT, practiceCheckPrompts } from '@/lib/strike/coachPrompt'

// Worst case is timeout × (retries + 1); it must fit inside maxDuration.
export const runtime     = 'nodejs'
export const maxDuration = 60

// POST /api/strike/coach/chat
//
// The LOTO Coach: a guarded, retrieval-grounded explainer that sits beside
// a STRIKE module. Same shape as /api/assistant/chat (gate → rate limit →
// conversation → RAG → cached system prompt → persist → log) minus tools —
// it explains, it never reads or changes tenant data.

const SURFACE = 'strike-coach' as const
const CONVERSATION_SURFACE = 'strike_coach'
const MODEL = MODEL_BY_SURFACE[SURFACE]
// max_tokens caps thinking plus reply; 2,000 leaves room for low-effort
// adaptive thinking ahead of a short answer.
const MAX_TOKENS = 2000
const HISTORY_TURNS = 12
const MAX_MESSAGE_CHARS = 2000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Training guidance first, then the regulation text and the tenant's own
// manuals/policies the RPC scopes in by tenant.
const COACH_SOURCES: KnowledgeSource[] = ['training', 'regulation', 'state_reg', 'manual', 'company_policy']

interface RequestBody {
  message?:         unknown
  conversation_id?: unknown
  module_id?:       unknown
  module_version_id?: unknown
}

export async function POST(req: Request) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: RequestBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const userText = typeof body.message === 'string' ? body.message.trim() : ''
  if (!userText) return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  if (userText.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: `Message is too long (max ${MAX_MESSAGE_CHARS.toLocaleString()} characters).` }, { status: 400 })
  }
  const conversationIdIn = typeof body.conversation_id === 'string' && UUID_RE.test(body.conversation_id) ? body.conversation_id : null
  const moduleId = typeof body.module_id === 'string' && UUID_RE.test(body.module_id) ? body.module_id : null
  const moduleVersionId = typeof body.module_version_id === 'string' && UUID_RE.test(body.module_version_id) ? body.module_version_id : null

  const limit = await checkAiRateLimit({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `You have hit the ${limit.reason} question limit for the LOTO Coach. Try again later.`, retryAfterSec: limit.retryAfterSec },
      { status: 429 },
    )
  }

  const admin = supabaseAdmin()

  const [{ data: tenantRow }, visibleModule, attemptOpen] = await Promise.all([
    admin.from('tenants').select('name').eq('id', gate.tenantId).maybeSingle(),
    moduleId ? loadVisibleModule(admin, moduleId, moduleVersionId, gate.tenantId) : Promise.resolve(null),
    moduleId ? knowledgeCheckOpen(admin, gate.tenantId, gate.userId, moduleId) : Promise.resolve(false),
  ])

  let conversationId: string
  if (conversationIdIn) {
    const { data: existing } = await admin
      .from('assistant_conversations')
      .select('id, user_id, surface')
      .eq('id', conversationIdIn)
      .maybeSingle()
    if (!existing || existing.user_id !== gate.userId || existing.surface !== CONVERSATION_SURFACE) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }
    conversationId = existing.id as string
  } else {
    const { data: created, error: createErr } = await admin
      .from('assistant_conversations')
      .insert({
        user_id:     gate.userId,
        tenant_id:   gate.tenantId,
        surface:     CONVERSATION_SURFACE,
        title:       userText.slice(0, 80),
        origin_path: moduleId ? `/strike?module=${moduleId}` : '/strike',
      })
      .select('id')
      .maybeSingle()
    if (createErr || !created) {
      Sentry.captureException(createErr, { tags: { route: '/api/strike/coach/chat', stage: 'create-conversation' } })
      return NextResponse.json({ error: 'Could not start a conversation.' }, { status: 500 })
    }
    conversationId = created.id as string
  }

  await admin.from('assistant_messages').insert({ conversation_id: conversationId, role: 'user', content: userText })

  // Newest-first so LIMIT keeps the latest turns; toSendableHistory restores order.
  const { data: priorRows } = await admin
    .from('assistant_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS)
  const history = toSendableHistory(
    (priorRows ?? [])
      .filter((r): r is { role: 'user' | 'assistant'; content: string; created_at: string } => r.role === 'user' || r.role === 'assistant')
      .map(r => ({ role: r.role, content: r.content })),
  )

  let retrieved: { contextBlock: string; chunks: RetrievedChunk[]; voyageTokens: number } = { contextBlock: '', chunks: [], voyageTokens: 0 }
  try {
    retrieved = await retrieveContext({ query: userText, tenantId: gate.tenantId, k: 6, sources: COACH_SOURCES })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/strike/coach/chat', stage: 'rag' } })
  }

  let client: Anthropic
  try {
    client = await getAnthropic(gate.tenantId, { timeoutMs: 45_000, maxRetries: 0 })
  } catch (err) {
    const mapped = aiErrorToResponse(err, SURFACE)
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/strike/coach/chat' } })
    return NextResponse.json(mapped.body, { status: mapped.status })
  }

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      thinking:   { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: LOTO_COACH_STATIC_PROMPT, cache_control: { type: 'ephemeral' } },
        {
          type: 'text',
          text: buildCoachDynamicPrompt({
            tenantName: (tenantRow?.name as string | undefined) ?? null,
            moduleTitle: visibleModule?.title ?? null,
            attemptOpen,
            practiceChecks: visibleModule?.practiceChecks ?? [],
            retrievedContext: retrieved.contextBlock,
          }),
        },
      ],
      messages: history,
    })
  } catch (err) {
    const mapped = aiErrorToResponse(err, SURFACE)
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/strike/coach/chat' } })
    await logAiInvocation({
      userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL,
      status: 'error', context: err instanceof Error ? err.message.slice(0, 200) : 'create threw',
    })
    return NextResponse.json(mapped.body, { status: mapped.status })
  }

  const reply = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim() || "I don't have an answer for that. Please ask your supervisor."

  const citations = retrieved.chunks.map(c => ({
    document_id: c.document_id,
    chunk_index: c.chunk_index,
    title:       c.title,
    source_type: c.source_type,
    source_url:  c.source_url,
    section:     typeof c.metadata?.section === 'string' ? c.metadata.section : null,
  }))

  const inputTokens = response.usage?.input_tokens ?? 0
  const outputTokens = response.usage?.output_tokens ?? 0
  const cacheReadTokens = response.usage?.cache_read_input_tokens ?? 0

  const { data: assistantRow } = await admin
    .from('assistant_messages')
    .insert({
      conversation_id:   conversationId,
      role:              'assistant',
      content:           reply,
      metadata:          { surface: CONVERSATION_SURFACE, attempt_open: attemptOpen, citations: citations.length > 0 ? citations : undefined },
      input_tokens:      inputTokens,
      output_tokens:     outputTokens,
      cache_read_tokens: cacheReadTokens,
    })
    .select('id')
    .maybeSingle()

  await admin.from('assistant_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)

  await logAiInvocation({
    userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'success',
    inputTokens, outputTokens, cacheReadTokens, context: conversationId,
  })

  return NextResponse.json({
    conversationId,
    messageId: assistantRow?.id ?? null,
    reply,
    citations,
  })
}

async function loadVisibleModule(
  admin: ReturnType<typeof supabaseAdmin>,
  moduleId: string,
  moduleVersionId: string | null,
  tenantId: string,
): Promise<{ title: string; practiceChecks: string[] } | null> {
  const [{ data }, { data: version }] = await Promise.all([
    admin.from('strike_modules').select('title, tenant_id, library_scope, status').eq('id', moduleId).maybeSingle(),
    moduleVersionId
      ? admin.from('strike_module_versions').select('content, status').eq('id', moduleVersionId).eq('module_id', moduleId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (!data || data.status !== 'published') return null
  if (data.library_scope === 'tenant' && data.tenant_id !== tenantId) return null
  const parsed = version?.status === 'published' && version.content != null ? parseStrikeContent(version.content) : null
  return { title: data.title as string, practiceChecks: parsed?.ok ? practiceCheckPrompts(parsed.content) : [] }
}

/**
 * Whether the coach must hold back graded-quiz answers: inside a module, until
 * this learner has passed it. Decided here, never by the browser, which could
 * simply say the quiz is closed. A failed lookup keeps the rule on.
 */
async function knowledgeCheckOpen(admin: ReturnType<typeof supabaseAdmin>, tenantId: string, userId: string, moduleId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('strike_completions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('module_id', moduleId)
    .eq('passed', true)
    .limit(1)
  if (error) return true
  return (data ?? []).length === 0
}
