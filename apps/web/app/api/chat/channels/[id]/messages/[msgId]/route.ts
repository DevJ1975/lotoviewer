import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadChannelMembership } from '@/lib/chat/membership'
import { extractMentionTokens, resolveMentions } from '@/lib/notifications/mentions'

// PATCH  /api/chat/channels/[id]/messages/[msgId]   Edit body (author only).
// DELETE /api/chat/channels/[id]/messages/[msgId]   Soft-delete (author or
//                                                   tenant admin/owner).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string; msgId: string }>
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id: channelId, msgId } = await ctx.params
  if (!UUID_RE.test(channelId) || !UUID_RE.test(msgId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { body?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text = (body.body ?? '').trim()
  if (!text) return NextResponse.json({ error: 'body is required' }, { status: 400 })
  if (text.length > 10000) return NextResponse.json({ error: 'body too long' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const me = await loadChannelMembership(admin, channelId, gate.userId, gate.tenantId)
    if (!me && gate.role !== 'superadmin')
      return NextResponse.json({ error: 'Not a member of this channel.' }, { status: 403 })

    const { data: existing } = await admin
      .from('chat_messages')
      .select('id, channel_id, author_user_id, deleted_at')
      .eq('id', msgId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    const e = existing as { id: string; channel_id: string; author_user_id: string; deleted_at: string | null } | null
    if (!e || e.channel_id !== channelId || e.deleted_at) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }
    if (e.author_user_id !== gate.userId) {
      return NextResponse.json({ error: 'Only the author can edit' }, { status: 403 })
    }

    const tokens = extractMentionTokens(text)
    const mentioned = await resolveMentions({ client: admin, tenantId: gate.tenantId, tokens })
    const mentionedIds = mentioned.map(m => m.user_id).filter(uid => uid !== gate.userId)

    const { data: updated, error: updErr } = await admin
      .from('chat_messages')
      .update({
        body:           text,
        body_mentions:  mentionedIds,
        edited_at:      new Date().toISOString(),
      })
      .eq('id', msgId)
      .eq('tenant_id', gate.tenantId)
      .select('id, body, body_mentions, edited_at')
      .single()
    if (updErr) {
      Sentry.captureException(updErr, { tags: { route: 'chat-messages/PATCH', stage: 'update' } })
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    // Reconcile mention rows. No new push on edit (recipient already
    // got notified when the message first landed).
    const { data: existingMentions } = await admin
      .from('mentions')
      .select('id, mentioned_user_id')
      .eq('source_type', 'channel_message')
      .eq('source_id',   msgId)
      .eq('tenant_id',   gate.tenantId)
    const existingByUid = new Map<string, string>()
    for (const r of (existingMentions ?? []) as Array<{ id: string; mentioned_user_id: string }>) {
      existingByUid.set(r.mentioned_user_id, r.id)
    }
    const stillMentioned = new Set(mentionedIds)
    const toDelete = Array.from(existingByUid.entries())
      .filter(([uid]) => !stillMentioned.has(uid))
      .map(([, id]) => id)
    const toInsert = mentionedIds
      .filter(uid => !existingByUid.has(uid))
      .map(uid => ({
        tenant_id:         gate.tenantId,
        source_type:       'channel_message',
        source_id:         msgId,
        author_user_id:    gate.userId,
        mentioned_user_id: uid,
      }))
    if (toDelete.length > 0) await admin.from('mentions').delete().in('id', toDelete)
    if (toInsert.length > 0) await admin.from('mentions').insert(toInsert)

    return NextResponse.json({ message: updated })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-messages/PATCH' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id: channelId, msgId } = await ctx.params
  if (!UUID_RE.test(channelId) || !UUID_RE.test(msgId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('chat_messages')
      .select('id, channel_id, author_user_id, deleted_at')
      .eq('id', msgId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    const e = existing as { id: string; channel_id: string; author_user_id: string; deleted_at: string | null } | null
    if (!e || e.channel_id !== channelId || e.deleted_at) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const isAuthor = e.author_user_id === gate.userId
    const isPriv =
      gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
    if (!isAuthor && !isPriv) {
      return NextResponse.json({ error: 'Only the author or a tenant admin can delete' }, { status: 403 })
    }

    const { error: updErr } = await admin
      .from('chat_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', msgId)
      .eq('tenant_id', gate.tenantId)
    if (updErr) {
      Sentry.captureException(updErr, { tags: { route: 'chat-messages/DELETE' } })
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    // Wipe pending mentions + reactions. Best-effort.
    await admin.from('mentions')
      .delete()
      .eq('source_type', 'channel_message')
      .eq('source_id',   msgId)
      .eq('tenant_id',   gate.tenantId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-messages/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
