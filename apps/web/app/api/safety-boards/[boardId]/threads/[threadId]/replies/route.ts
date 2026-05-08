import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { extractMentionTokens, resolveMentions } from '@/lib/notifications/mentions'
import { dispatchPushToProfiles } from '@/lib/notifications/pushFanout'

// GET  /api/safety-boards/[boardId]/threads/[threadId]/replies
//   List replies for a thread, oldest first, hydrated with author +
//   reactions.
// POST /api/safety-boards/[boardId]/threads/[threadId]/replies
//   Body: { body, parent_reply_id? }
//   Pushes to: thread author + any @-mentioned users (excluding self).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ boardId: string; threadId: string }>
}

interface ReplyRow {
  id: string
  tenant_id: string
  thread_id: string
  author_user_id: string
  body: string
  body_mentions: string[]
  parent_reply_id: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

export async function GET(req: Request, ctx: RouteContext) {
  const { boardId, threadId } = await ctx.params
  if (!UUID_RE.test(boardId) || !UUID_RE.test(threadId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: rows, error } = await admin
      .from('safety_board_replies')
      .select('*')
      .eq('thread_id', threadId)
      .eq('tenant_id', gate.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(500)
    if (error) throw new Error(error.message)
    const replies = ((rows as unknown) as ReplyRow[]) ?? []

    if (replies.length === 0) return NextResponse.json({ replies: [] })

    const ids       = replies.map(r => r.id)
    const authorIds = Array.from(new Set(replies.map(r => r.author_user_id)))
    const [{ data: authors }, { data: reactions }, { data: attachments }] = await Promise.all([
      admin.from('profiles').select('id, email, full_name, avatar_url').in('id', authorIds),
      admin.from('safety_board_reactions').select('target_id, user_id, emoji')
        .eq('target_type', 'reply').in('target_id', ids).eq('tenant_id', gate.tenantId),
      admin.from('safety_board_attachments').select('id, target_id, storage_path, mime_type, size_bytes, width, height, filename')
        .eq('target_type', 'reply').in('target_id', ids).eq('tenant_id', gate.tenantId),
    ])
    const authorById = new Map<string, { email: string | null; full_name: string | null; avatar_url: string | null }>()
    for (const p of (authors ?? []) as Array<{ id: string; email: string | null; full_name: string | null; avatar_url: string | null }>) {
      authorById.set(p.id, { email: p.email, full_name: p.full_name, avatar_url: p.avatar_url })
    }
    const reactByReply = new Map<string, Map<string, string[]>>()
    for (const r of (reactions ?? []) as Array<{ target_id: string; user_id: string; emoji: string }>) {
      const byEmoji = reactByReply.get(r.target_id) ?? new Map<string, string[]>()
      const arr = byEmoji.get(r.emoji) ?? []
      arr.push(r.user_id)
      byEmoji.set(r.emoji, arr)
      reactByReply.set(r.target_id, byEmoji)
    }
    const attByReply = new Map<string, Array<{ id: string; storage_path: string; mime_type: string; size_bytes: number; width: number | null; height: number | null; filename: string | null }>>()
    for (const att of (attachments ?? []) as Array<{ id: string; target_id: string; storage_path: string; mime_type: string; size_bytes: number; width: number | null; height: number | null; filename: string | null }>) {
      const list = attByReply.get(att.target_id) ?? []
      list.push({ id: att.id, storage_path: att.storage_path, mime_type: att.mime_type, size_bytes: att.size_bytes, width: att.width, height: att.height, filename: att.filename })
      attByReply.set(att.target_id, list)
    }

    return NextResponse.json({
      replies: replies.map(r => {
        const a = authorById.get(r.author_user_id)
        const byEmoji = reactByReply.get(r.id)
        const reactionList = byEmoji
          ? Array.from(byEmoji.entries()).map(([emoji, user_ids]) => ({ emoji, user_ids, count: user_ids.length }))
          : []
        return {
          id: r.id,
          thread_id: r.thread_id,
          author_user_id: r.author_user_id,
          author_email: a?.email ?? null,
          author_full_name: a?.full_name ?? null,
          author_avatar_url: a?.avatar_url ?? null,
          body: r.body,
          body_mentions: r.body_mentions,
          parent_reply_id: r.parent_reply_id,
          edited_at: r.edited_at,
          created_at: r.created_at,
          reactions: reactionList,
          attachments: attByReply.get(r.id) ?? [],
        }
      }),
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-replies/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  const { boardId, threadId } = await ctx.params
  if (!UUID_RE.test(boardId) || !UUID_RE.test(threadId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { body?: string; parent_reply_id?: string; attachment_ids?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text = (body.body ?? '').trim()
  if (text.length < 1 || text.length > 20000) {
    return NextResponse.json({ error: 'body must be 1-20000 chars' }, { status: 400 })
  }
  if (body.parent_reply_id && !UUID_RE.test(body.parent_reply_id)) {
    return NextResponse.json({ error: 'parent_reply_id must be a uuid' }, { status: 400 })
  }
  const attachmentIds = (body.attachment_ids ?? []).filter(s => UUID_RE.test(s))

  try {
    const admin = supabaseAdmin()
    const { data: thread } = await admin
      .from('safety_board_threads')
      .select('id, board_id, locked, deleted_at, author_user_id, title')
      .eq('id', threadId)
      .eq('board_id', boardId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    const t = thread as { id: string; board_id: string; locked: boolean; deleted_at: string | null; author_user_id: string; title: string } | null
    if (!t || t.deleted_at) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
    if (t.locked) {
      const isPriv = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
      if (!isPriv) return NextResponse.json({ error: 'Thread is locked' }, { status: 403 })
    }

    if (body.parent_reply_id) {
      const { data: parent } = await admin
        .from('safety_board_replies')
        .select('id, thread_id, deleted_at')
        .eq('id', body.parent_reply_id)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle()
      const p = parent as { id: string; thread_id: string; deleted_at: string | null } | null
      if (!p || p.thread_id !== threadId || p.deleted_at) {
        return NextResponse.json({ error: 'Parent reply not found in this thread' }, { status: 400 })
      }
    }

    const tokens = extractMentionTokens(text)
    const mentioned = await resolveMentions({ client: admin, tenantId: gate.tenantId, tokens })
    const mentionedIds = mentioned.map(m => m.user_id).filter(uid => uid !== gate.userId)

    const { data: inserted, error: insertErr } = await admin
      .from('safety_board_replies')
      .insert({
        tenant_id:       gate.tenantId,
        thread_id:       threadId,
        author_user_id:  gate.userId,
        body:            text,
        body_mentions:   mentionedIds,
        parent_reply_id: body.parent_reply_id ?? null,
      })
      .select('*')
      .single()
    if (insertErr) {
      Sentry.captureException(insertErr, { tags: { route: 'safety-replies/POST', stage: 'insert' } })
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }
    const reply = (inserted as unknown) as ReplyRow

    if (attachmentIds.length > 0) {
      await admin
        .from('safety_board_attachments')
        .update({ target_type: 'reply', target_id: reply.id })
        .in('id', attachmentIds)
        .eq('tenant_id', gate.tenantId)
        .eq('uploaded_by', gate.userId)
        .is('target_id', null)
    }

    if (mentionedIds.length > 0) {
      await admin.from('mentions').insert(mentionedIds.map(uid => ({
        tenant_id:         gate.tenantId,
        source_type:       'board_reply',
        source_id:         reply.id,
        author_user_id:    gate.userId,
        mentioned_user_id: uid,
      })))
    }

    // Push fanout: thread author (unless they are the replier or
    // already mentioned) + explicit @-mentions.
    const recipients = new Set(mentionedIds)
    if (t.author_user_id !== gate.userId) recipients.add(t.author_user_id)
    if (recipients.size > 0) {
      const { data: authorProfile } = await admin
        .from('profiles')
        .select('full_name, email')
        .eq('id', gate.userId)
        .maybeSingle()
      const authorName = (authorProfile as { full_name: string | null; email: string | null } | null)?.full_name
                      ?? (authorProfile as { full_name: string | null; email: string | null } | null)?.email
                      ?? 'Someone'
      const summary = text.length > 140 ? text.slice(0, 137) + '…' : text
      void dispatchPushToProfiles({
        payload: {
          title: `${authorName} replied on "${t.title}"`,
          body:  summary,
          url:   `/safety-boards/${boardId}/${threadId}`,
          tag:   `board-thread:${threadId}`,
        },
        profileIds: Array.from(recipients),
        source:     'board-reply',
      })
    }

    return NextResponse.json({ reply }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-replies/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
