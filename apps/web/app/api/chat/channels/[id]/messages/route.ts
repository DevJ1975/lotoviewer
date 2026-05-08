import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadChannelMembership } from '@/lib/chat/membership'
import { extractMentionTokens, resolveMentions } from '@/lib/notifications/mentions'
import { dispatchPushToProfiles } from '@/lib/notifications/pushFanout'

// GET  /api/chat/channels/[id]/messages?since=<created_at>&limit=50
//   Polling-friendly fetch. Without `since`, returns the most recent N
//   messages newest-first. With `since`, returns messages strictly after
//   the supplied ISO timestamp (created_at). Includes hydrated authors,
//   attachments, and reactions so the client renders without a chain
//   of secondary fetches per message.
//
// POST /api/chat/channels/[id]/messages
//   Body: { body: string, parent_message_id?: string, attachment_ids?: string[] }
//   Creates a new live message, parses @-mentions, fans out a push to
//   channel members who are mentioned OR are otherwise in the channel
//   (excluding the author). Self-mentions skipped.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 200

interface RouteContext { params: Promise<{ id: string }> }

interface MessageRow {
  id: string
  tenant_id: string
  channel_id: string
  author_user_id: string
  body: string
  body_mentions: string[]
  parent_message_id: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

async function hydrate(
  rows: MessageRow[],
  admin: ReturnType<typeof supabaseAdmin>,
) {
  const ids = rows.map(r => r.id)
  const authorIds = Array.from(new Set(rows.map(r => r.author_user_id)))

  const [{ data: profiles }, { data: attachments }, { data: reactions }] = await Promise.all([
    authorIds.length > 0
      ? admin.from('profiles').select('id, email, full_name, avatar_url').in('id', authorIds)
      : Promise.resolve({ data: [] as Array<{ id: string; email: string | null; full_name: string | null; avatar_url: string | null }> }),
    ids.length > 0
      ? admin.from('chat_message_attachments').select('id, message_id, storage_path, mime_type, size_bytes, width, height, filename').in('message_id', ids)
      : Promise.resolve({ data: [] as Array<{ id: string; message_id: string; storage_path: string; mime_type: string; size_bytes: number; width: number | null; height: number | null; filename: string | null }> }),
    ids.length > 0
      ? admin.from('chat_message_reactions').select('message_id, user_id, emoji').in('message_id', ids)
      : Promise.resolve({ data: [] as Array<{ message_id: string; user_id: string; emoji: string }> }),
  ])

  const profileById = new Map<string, { email: string | null; full_name: string | null; avatar_url: string | null }>()
  for (const p of (profiles ?? []) as Array<{ id: string; email: string | null; full_name: string | null; avatar_url: string | null }>) {
    profileById.set(p.id, { email: p.email, full_name: p.full_name, avatar_url: p.avatar_url })
  }
  const attByMsg = new Map<string, Array<{ id: string; storage_path: string; mime_type: string; size_bytes: number; width: number | null; height: number | null; filename: string | null }>>()
  for (const a of (attachments ?? []) as Array<{ id: string; message_id: string; storage_path: string; mime_type: string; size_bytes: number; width: number | null; height: number | null; filename: string | null }>) {
    const list = attByMsg.get(a.message_id) ?? []
    list.push({ id: a.id, storage_path: a.storage_path, mime_type: a.mime_type, size_bytes: a.size_bytes, width: a.width, height: a.height, filename: a.filename })
    attByMsg.set(a.message_id, list)
  }
  // Reactions: aggregate {emoji: [user_id, ...]} per message.
  const reactByMsg = new Map<string, Map<string, string[]>>()
  for (const r of (reactions ?? []) as Array<{ message_id: string; user_id: string; emoji: string }>) {
    const byEmoji = reactByMsg.get(r.message_id) ?? new Map<string, string[]>()
    const arr = byEmoji.get(r.emoji) ?? []
    arr.push(r.user_id)
    byEmoji.set(r.emoji, arr)
    reactByMsg.set(r.message_id, byEmoji)
  }

  return rows.map(r => {
    const a = profileById.get(r.author_user_id)
    const byEmoji = reactByMsg.get(r.id)
    const reactionList = byEmoji
      ? Array.from(byEmoji.entries()).map(([emoji, user_ids]) => ({ emoji, user_ids, count: user_ids.length }))
      : []
    return {
      id: r.id,
      channel_id: r.channel_id,
      author_user_id: r.author_user_id,
      author_email: a?.email ?? null,
      author_full_name: a?.full_name ?? null,
      author_avatar_url: a?.avatar_url ?? null,
      body: r.body,
      body_mentions: r.body_mentions,
      parent_message_id: r.parent_message_id,
      edited_at: r.edited_at,
      created_at: r.created_at,
      attachments: attByMsg.get(r.id) ?? [],
      reactions: reactionList,
    }
  })
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id: channelId } = await ctx.params
  if (!UUID_RE.test(channelId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const since = url.searchParams.get('since')
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, MAX_LIMIT))

  try {
    const admin = supabaseAdmin()
    const me = await loadChannelMembership(admin, channelId, gate.userId, gate.tenantId)
    if (!me && gate.role !== 'superadmin') {
      return NextResponse.json({ error: 'Not a member of this channel.' }, { status: 403 })
    }

    let q = admin
      .from('chat_messages')
      .select('id, tenant_id, channel_id, author_user_id, body, body_mentions, parent_message_id, edited_at, deleted_at, created_at')
      .eq('channel_id', channelId)
      .eq('tenant_id', gate.tenantId)
      .is('deleted_at', null)

    if (since) {
      // since is an ISO timestamp (created_at). Strict >.
      q = q.gt('created_at', since).order('created_at', { ascending: true }).limit(limit)
    } else {
      // Default: most recent page, newest-first; client reverses to
      // render bottom-up.
      q = q.order('created_at', { ascending: false }).limit(limit)
    }

    const { data, error } = await q
    if (error) throw new Error(error.message)
    const rows = ((data as unknown) as MessageRow[]) ?? []
    const ordered = since ? rows : rows.slice().reverse()
    const messages = await hydrate(ordered, admin)

    return NextResponse.json({ messages })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-messages/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id: channelId } = await ctx.params
  if (!UUID_RE.test(channelId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { body?: string; parent_message_id?: string; attachment_ids?: string[] }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const text = (body.body ?? '').trim()
  const attachmentIds = (body.attachment_ids ?? []).filter(s => UUID_RE.test(s))
  // Either text or at least one attachment must be present.
  if (!text && attachmentIds.length === 0) {
    return NextResponse.json({ error: 'Empty message.' }, { status: 400 })
  }
  if (text.length > 10000) {
    return NextResponse.json({ error: 'Message too long (max 10000 chars).' }, { status: 400 })
  }
  if (body.parent_message_id && !UUID_RE.test(body.parent_message_id)) {
    return NextResponse.json({ error: 'parent_message_id must be a uuid' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const me = await loadChannelMembership(admin, channelId, gate.userId, gate.tenantId)
    if (!me) return NextResponse.json({ error: 'Not a member of this channel.' }, { status: 403 })

    // If parent provided, verify it's a live message in this channel.
    if (body.parent_message_id) {
      const { data: parent } = await admin
        .from('chat_messages')
        .select('id, channel_id, deleted_at')
        .eq('id', body.parent_message_id)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle()
      if (!parent || parent.channel_id !== channelId || parent.deleted_at) {
        return NextResponse.json({ error: 'Parent message not found in this channel.' }, { status: 400 })
      }
    }

    // Resolve @-mentions against tenant roster. Self-mentions skipped.
    const tokens = extractMentionTokens(text)
    const mentioned = await resolveMentions({ client: admin, tenantId: gate.tenantId, tokens })
    const mentionedIds = mentioned.map(m => m.user_id).filter(uid => uid !== gate.userId)

    const { data: inserted, error: insertErr } = await admin
      .from('chat_messages')
      .insert({
        tenant_id:         gate.tenantId,
        channel_id:        channelId,
        author_user_id:    gate.userId,
        body:              text,
        body_mentions:     mentionedIds,
        parent_message_id: body.parent_message_id ?? null,
      })
      .select('id, tenant_id, channel_id, author_user_id, body, body_mentions, parent_message_id, edited_at, deleted_at, created_at')
      .single()
    if (insertErr) {
      Sentry.captureException(insertErr, { tags: { route: 'chat-messages/POST', stage: 'insert' } })
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }
    const msg = ((inserted as unknown) as MessageRow)

    // Claim uploaded attachments: rewrite their NULL message_id to
    // this freshly-inserted message. Restrict to attachments uploaded
    // by THIS user that aren't already attached, so a peer can't
    // hijack someone else's pending upload.
    if (attachmentIds.length > 0) {
      await admin
        .from('chat_message_attachments')
        .update({ message_id: msg.id })
        .in('id', attachmentIds)
        .eq('tenant_id', gate.tenantId)
        .eq('uploaded_by', gate.userId)
        .is('message_id', null)
    }

    // Mention rows + push fanout. Mention rows go to the generic
    // mentions table so the unified inbox/badge works.
    if (mentionedIds.length > 0) {
      await admin.from('mentions').insert(mentionedIds.map(uid => ({
        tenant_id:         gate.tenantId,
        source_type:       'channel_message',
        source_id:         msg.id,
        author_user_id:    gate.userId,
        mentioned_user_id: uid,
      })))
    }

    // Notify channel members who aren't the author. DMs ping the peer
    // every time; channels only push to mentioned users + the
    // explicit list of channel members who have muted_at IS NULL.
    const { data: ch } = await admin
      .from('chat_channels')
      .select('kind, name')
      .eq('id', channelId)
      .maybeSingle()
    const channelKind = (ch as { kind: 'channel' | 'dm' } | null)?.kind ?? 'channel'

    let recipientIds: string[]
    if (channelKind === 'dm') {
      // Push to every (non-muted) member except the author.
      const { data: peers } = await admin
        .from('chat_channel_members')
        .select('user_id, muted_at')
        .eq('channel_id', channelId)
        .eq('tenant_id', gate.tenantId)
      recipientIds = ((peers ?? []) as Array<{ user_id: string; muted_at: string | null }>)
        .filter(m => m.user_id !== gate.userId && !m.muted_at)
        .map(m => m.user_id)
    } else {
      // Channel: push only to mentioned users (excluding self) so we
      // don't spam every member on every message.
      recipientIds = mentionedIds
    }
    if (recipientIds.length > 0) {
      const { data: authorProfile } = await admin
        .from('profiles')
        .select('full_name, email')
        .eq('id', gate.userId)
        .maybeSingle()
      const authorName = (authorProfile as { full_name: string | null; email: string | null } | null)?.full_name
                      ?? (authorProfile as { full_name: string | null; email: string | null } | null)?.email
                      ?? 'Someone'
      const channelName = (ch as { kind: 'channel' | 'dm'; name: string | null } | null)?.name
      const summary = text.length > 140 ? text.slice(0, 137) + '…' : (text || '(attachment)')
      const title = channelKind === 'dm'
        ? `${authorName} sent you a message`
        : `${authorName} mentioned you in #${channelName ?? 'channel'}`
      void dispatchPushToProfiles({
        payload: {
          title,
          body: summary,
          url:  `/chat/${channelId}`,
          tag:  `chat:${channelId}`,
        },
        profileIds: recipientIds,
        source:     'chat-message',
      })
    }

    const [hydrated] = await hydrate([msg], admin)
    return NextResponse.json({ message: hydrated }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-messages/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
