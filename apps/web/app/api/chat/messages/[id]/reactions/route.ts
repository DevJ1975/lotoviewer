import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadChannelMembership } from '@/lib/chat/membership'

// POST   /api/chat/messages/[id]/reactions   Body: { emoji }
// DELETE /api/chat/messages/[id]/reactions?emoji=...   Remove the caller's
//                                                       reaction with that
//                                                       emoji.
//
// PK is (message_id, user_id, emoji); a user can react with multiple
// distinct emoji on the same message but not duplicate the same one.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMOJI_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️☝✌✋✊❤]{1,8}$/u

interface RouteContext { params: Promise<{ id: string }> }

type GateAndMessage =
  | { ok: true; gate: Extract<Awaited<ReturnType<typeof requireTenantMember>>, { ok: true }>; admin: ReturnType<typeof supabaseAdmin>; msg: { id: string; channel_id: string; deleted_at: string | null; tenant_id: string } }
  | { ok: false; status: number; message: string }

async function gateAndLoadMessage(req: Request, msgId: string): Promise<GateAndMessage> {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return { ok: false, status: gate.status, message: gate.message }
  const admin = supabaseAdmin()
  const { data } = await admin
    .from('chat_messages')
    .select('id, channel_id, deleted_at, tenant_id')
    .eq('id', msgId)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  const msg = data as { id: string; channel_id: string; deleted_at: string | null; tenant_id: string } | null
  if (!msg || msg.deleted_at) {
    return { ok: false, status: 404, message: 'Message not found' }
  }
  const me = await loadChannelMembership(admin, msg.channel_id, gate.userId, gate.tenantId)
  if (!me) return { ok: false, status: 403, message: 'Not a member of this channel.' }
  return { ok: true, gate, admin, msg }
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id: msgId } = await ctx.params
  if (!UUID_RE.test(msgId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: { emoji?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const emoji = (body.emoji ?? '').trim()
  if (!emoji || emoji.length > 32 || !EMOJI_RE.test(emoji)) {
    return NextResponse.json({ error: 'emoji must be 1-8 emoji characters' }, { status: 400 })
  }

  const result = await gateAndLoadMessage(req, msgId)
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }
  const { gate, admin } = result

  try {
    // Idempotent insert: PK conflict is a no-op.
    const { error } = await admin
      .from('chat_message_reactions')
      .upsert({
        message_id: msgId,
        user_id:    gate.userId,
        tenant_id:  gate.tenantId,
        emoji,
      }, { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: true })
    if (error) {
      Sentry.captureException(error, { tags: { route: 'chat-reactions/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-reactions/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id: msgId } = await ctx.params
  if (!UUID_RE.test(msgId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const url = new URL(req.url)
  const emoji = (url.searchParams.get('emoji') ?? '').trim()
  if (!emoji) return NextResponse.json({ error: 'emoji query param required' }, { status: 400 })

  const result = await gateAndLoadMessage(req, msgId)
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }
  const { gate, admin } = result

  try {
    const { error } = await admin
      .from('chat_message_reactions')
      .delete()
      .eq('message_id', msgId)
      .eq('user_id', gate.userId)
      .eq('tenant_id', gate.tenantId)
      .eq('emoji', emoji)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'chat-reactions/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-reactions/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
