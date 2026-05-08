import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadChannelMembership } from '@/lib/chat/membership'

// POST /api/chat/channels/[id]/read
// Body: { last_read_message_id?: string }   // omit to mark "everything read"
//
// Bumps the caller's last_read_message_id for this channel. The server
// resolves "everything read" by finding the latest live message id in
// the channel and storing that — clients don't need to know it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const { id: channelId } = await ctx.params
  if (!UUID_RE.test(channelId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { last_read_message_id?: string } = {}
  try { body = await req.json() } catch { /* empty body OK */ }
  if (body.last_read_message_id && !UUID_RE.test(body.last_read_message_id)) {
    return NextResponse.json({ error: 'last_read_message_id must be a uuid' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const me = await loadChannelMembership(admin, channelId, gate.userId, gate.tenantId)
    if (!me) return NextResponse.json({ error: 'Not a member of this channel.' }, { status: 403 })

    let target: string | null = body.last_read_message_id ?? null
    if (!target) {
      // Mark-everything-read: pick the latest live message id.
      const { data } = await admin
        .from('chat_messages')
        .select('id')
        .eq('channel_id', channelId)
        .eq('tenant_id', gate.tenantId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
      target = ((data ?? [])[0] as { id: string } | undefined)?.id ?? null
    } else {
      // Validate the message belongs to this channel (avoid pointing
      // last_read at a foreign message).
      const { data: msg } = await admin
        .from('chat_messages')
        .select('id, channel_id')
        .eq('id', target)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle()
      if (!msg || (msg as { channel_id: string }).channel_id !== channelId) {
        return NextResponse.json({ error: 'last_read_message_id is not in this channel' }, { status: 400 })
      }
    }

    const { error } = await admin
      .from('chat_channel_members')
      .update({ last_read_message_id: target })
      .eq('channel_id', channelId)
      .eq('user_id', gate.userId)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'chat-read/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ last_read_message_id: target })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-read/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
