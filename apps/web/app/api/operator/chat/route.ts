import type Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { checkAiRateLimit, checkTenantBudget, logAiInvocation, type AiSurface } from '@/lib/ai/rateLimit'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'
import { ORCHESTRATOR_SURFACE } from '@/lib/ai/operator/agents'
import { runOrchestrator } from '@/lib/ai/operator/runOrchestrator'
import type { OperatorStreamEvent } from '@/lib/ai/operator/streamEvents'
import type { UserRole } from '@/lib/ai/tools'

// POST /api/operator/chat
//
// Operator Console turn. An Opus orchestrator delegates to the domain
// sub-agents (lib/ai/operator/) and synthesizes a reply. Unlike the home
// assistant (/api/assistant/chat), this surface STREAMS its progress as
// Server-Sent Events so the user sees which specialist was consulted and what
// it found, live.
//
// Auth: bearer + x-active-tenant (requireTenantMember) — open to any member;
// the orchestrator restricts which sub-agents each role may use.
// Rate limit: the orchestrator turn (60/hr, 400/day). Fanned-out sub-agents
// are logged per surface for cost attribution but not rate-limited directly.
//
// Wire format: text/event-stream, one event per `data: <json>\n\n` frame; see
// OperatorStreamEvent. Pre-stream failures return plain JSON (a clean 4xx/5xx),
// never a half-open stream.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Opus orchestrator + several Sonnet/Opus sub-agents (each up to 4 tool loops)
// can run long; bound it well under the platform limit.
export const maxDuration = 120

const MAX_MESSAGE_LEN = 4000
const HISTORY_TURNS = 20
const ORCHESTRATOR_TIMEOUT_MS = 60_000

interface RequestBody {
  message:        string
  conversationId?: string
  pathname?:      string
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: RequestBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const userText = (body.message ?? '').trim()
  if (!userText) return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  if (userText.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: `Message is too long (max ${MAX_MESSAGE_LEN.toLocaleString()} characters).` }, { status: 400 })
  }

  // Rate limit + tenant budget BEFORE any model work — same posture as the
  // other AI surfaces. Both log their own rows on rejection.
  const limit = await checkAiRateLimit({ userId: gate.userId, tenantId: gate.tenantId, surface: ORCHESTRATOR_SURFACE })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `You have hit the ${limit.reason} message limit. Try again later.`, retryAfterSec: limit.retryAfterSec },
      { status: 429 },
    )
  }
  const budget = await checkTenantBudget({ tenantId: gate.tenantId, surface: ORCHESTRATOR_SURFACE, userId: gate.userId })
  if (!budget.ok) {
    const status = budget.reason === 'budget_exceeded' ? 429 : 403
    return NextResponse.json({ error: budget.message }, { status })
  }

  const admin = supabaseAdmin()

  // Tenant context for the orchestrator prompt.
  const { data: tenantRow } = await admin
    .from('tenants')
    .select('id, name, modules')
    .eq('id', gate.tenantId)
    .maybeSingle()
  const tenantName    = (tenantRow?.name ?? null) as string | null
  const tenantModules = (tenantRow?.modules ?? null) as Record<string, boolean> | null

  // Load or create the conversation (own-row).
  let conversationId: string
  if (body.conversationId) {
    const { data: existing } = await admin
      .from('operator_conversations')
      .select('id, user_id')
      .eq('id', body.conversationId)
      .maybeSingle()
    if (!existing || existing.user_id !== gate.userId) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }
    conversationId = existing.id as string
  } else {
    const { data: created, error: createErr } = await admin
      .from('operator_conversations')
      .insert({
        user_id:     gate.userId,
        tenant_id:   gate.tenantId,
        title:       userText.slice(0, 80),
        origin_path: body.pathname ?? null,
      })
      .select('id')
      .maybeSingle()
    if (createErr || !created) {
      Sentry.captureException(createErr, { tags: { route: '/api/operator/chat', stage: 'create-conversation' } })
      return NextResponse.json({ error: 'Could not start a conversation.' }, { status: 500 })
    }
    conversationId = created.id as string
  }

  // Load prior turns (most recent, chronological) BEFORE persisting this turn so
  // the history we hand the orchestrator is exactly the prior context.
  const { data: priorRows } = await admin
    .from('operator_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS)
  const history: Anthropic.MessageParam[] = (priorRows ?? [])
    .filter((r): r is { role: 'user' | 'assistant'; content: string; created_at: string } =>
      r.role === 'user' || r.role === 'assistant')
    .reverse()
    .map(r => ({ role: r.role, content: r.content }))

  // Persist the user turn (so it survives a mid-stream failure).
  await admin.from('operator_messages').insert({
    conversation_id: conversationId,
    role:            'user',
    content:         userText,
  })

  // Configured client (longer timeout — the orchestrator fans out). getAnthropic
  // throws on missing/malformed keys; map to a clean pre-stream response.
  let client: Anthropic
  try {
    client = await getAnthropic(gate.tenantId, { timeoutMs: ORCHESTRATOR_TIMEOUT_MS })
  } catch (err) {
    const mapped = aiErrorToResponse(err, ORCHESTRATOR_SURFACE)
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/operator/chat' } })
    return NextResponse.json(mapped.body, { status: mapped.status })
  }

  const role = gate.role as UserRole
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: OperatorStreamEvent) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)) }
        catch { /* client disconnected — enqueue after close throws; ignore */ }
      }

      // Emit the conversation id first so the client can store it even if a
      // later frame errors.
      send({ type: 'conversation', conversationId })

      let result
      try {
        result = await runOrchestrator({
          message:       userText,
          history,
          ctx:           { tenantId: gate.tenantId, userId: gate.userId, role, conversationId },
          client,
          tenantName,
          tenantModules,
          onEvent:       send,
        })
      } catch (err) {
        const mapped = aiErrorToResponse(err, ORCHESTRATOR_SURFACE)
        Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/operator/chat', stage: 'orchestrator' } })
        send({ type: 'error', message: mapped.body.error })
        await logAiInvocation({
          userId: gate.userId, tenantId: gate.tenantId, surface: ORCHESTRATOR_SURFACE,
          model: MODEL_BY_SURFACE[ORCHESTRATOR_SURFACE], status: 'error',
          context: err instanceof Error ? err.message.slice(0, 200) : 'orchestrator threw',
        })
        controller.close()
        return
      }

      const reply = result.text.length > 0 ? result.text : '(no answer)'

      // Persist the assistant turn with the delegation log.
      await admin.from('operator_messages').insert({
        conversation_id:   conversationId,
        role:              'assistant',
        content:           reply,
        metadata: result.delegations.length > 0
          ? { delegations: result.delegations.map(d => ({
              agentId:   d.agentId,
              task:      d.task,
              text:      d.result.text,
              toolCalls: d.result.toolCalls.map(t => ({ name: t.name })),
              hitLoopCap: d.result.hitLoopCap,
            })) }
          : null,
        input_tokens:      result.usageBySurface[ORCHESTRATOR_SURFACE]?.inputTokens     ?? 0,
        output_tokens:     result.usageBySurface[ORCHESTRATOR_SURFACE]?.outputTokens    ?? 0,
        cache_read_tokens: result.usageBySurface[ORCHESTRATOR_SURFACE]?.cacheReadTokens ?? 0,
      })
      await admin
        .from('operator_conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId)

      // One ai_invocations row per surface — the orchestrator's own turn plus
      // each delegated sub-agent — for per-surface cost attribution.
      for (const [surface, usage] of Object.entries(result.usageBySurface)) {
        if (!usage) continue
        await logAiInvocation({
          userId:          gate.userId,
          tenantId:        gate.tenantId,
          surface:         surface as AiSurface,
          model:           MODEL_BY_SURFACE[surface as AiSurface],
          status:          'success',
          inputTokens:     usage.inputTokens,
          outputTokens:    usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          context:         conversationId,
        })
      }

      send({ type: 'final', text: reply })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':         'text/event-stream; charset=utf-8',
      'Cache-Control':        'no-cache, no-transform',
      'Connection':           'keep-alive',
      'X-Accel-Buffering':    'no',
    },
  })
}
