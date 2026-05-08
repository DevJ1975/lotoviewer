import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { extractMentionTokens, resolveMentions } from '@/lib/notifications/mentions'
import { dispatchPushToProfiles } from '@/lib/notifications/pushFanout'

// GET  /api/safety-boards/[boardId]/threads
//   List threads (pinned first, then by last_reply_at desc), hydrated
//   with author + reply count + reaction counts.
// POST /api/safety-boards/[boardId]/threads
//   Body: { title, body }   Any tenant member.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ boardId: string }> }

interface ThreadRow {
  id: string
  tenant_id: string
  board_id: string
  author_user_id: string
  title: string
  body: string
  body_mentions: string[]
  pinned: boolean
  locked: boolean
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  last_reply_at: string
}

export async function GET(req: Request, ctx: RouteContext) {
  const { boardId } = await ctx.params
  if (!UUID_RE.test(boardId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: board } = await admin
      .from('safety_boards')
      .select('id, archived_at')
      .eq('id', boardId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })

    const { data: rows, error } = await admin
      .from('safety_board_threads')
      .select('*')
      .eq('board_id', boardId)
      .eq('tenant_id', gate.tenantId)
      .is('deleted_at', null)
      .order('pinned', { ascending: false })
      .order('last_reply_at', { ascending: false })
      .limit(200)
    if (error) throw new Error(error.message)
    const threads = ((rows as unknown) as ThreadRow[]) ?? []

    if (threads.length === 0) return NextResponse.json({ threads: [] })

    const authorIds = Array.from(new Set(threads.map(t => t.author_user_id)))
    const threadIds = threads.map(t => t.id)

    const [authors, replyCounts] = await Promise.all([
      admin.from('profiles').select('id, email, full_name, avatar_url').in('id', authorIds),
      Promise.all(threadIds.map(async tid => {
        const { count } = await admin
          .from('safety_board_replies')
          .select('id', { count: 'exact', head: true })
          .eq('thread_id', tid)
          .eq('tenant_id', gate.tenantId)
          .is('deleted_at', null)
        return { tid, count: count ?? 0 }
      })),
    ])
    const authorById = new Map<string, { email: string | null; full_name: string | null; avatar_url: string | null }>()
    for (const p of (authors.data ?? []) as Array<{ id: string; email: string | null; full_name: string | null; avatar_url: string | null }>) {
      authorById.set(p.id, { email: p.email, full_name: p.full_name, avatar_url: p.avatar_url })
    }
    const replyCountById = new Map<string, number>()
    for (const r of replyCounts) replyCountById.set(r.tid, r.count)

    return NextResponse.json({
      threads: threads.map(t => {
        const a = authorById.get(t.author_user_id)
        return {
          id: t.id,
          board_id: t.board_id,
          author_user_id: t.author_user_id,
          author_email: a?.email ?? null,
          author_full_name: a?.full_name ?? null,
          author_avatar_url: a?.avatar_url ?? null,
          title: t.title,
          body: t.body,
          body_mentions: t.body_mentions,
          pinned: t.pinned,
          locked: t.locked,
          edited_at: t.edited_at,
          created_at: t.created_at,
          last_reply_at: t.last_reply_at,
          reply_count: replyCountById.get(t.id) ?? 0,
        }
      }),
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-threads/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  const { boardId } = await ctx.params
  if (!UUID_RE.test(boardId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { title?: string; body?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const title = (body.title ?? '').trim()
  const text  = (body.body ?? '').trim()
  if (title.length < 1 || title.length > 200) {
    return NextResponse.json({ error: 'title must be 1-200 chars' }, { status: 400 })
  }
  if (text.length < 1 || text.length > 20000) {
    return NextResponse.json({ error: 'body must be 1-20000 chars' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: board } = await admin
      .from('safety_boards')
      .select('id, archived_at, name')
      .eq('id', boardId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    const b = board as { id: string; archived_at: string | null; name: string } | null
    if (!b || b.archived_at) {
      return NextResponse.json({ error: 'Board not found or archived' }, { status: 404 })
    }

    const tokens = extractMentionTokens(text)
    const mentioned = await resolveMentions({ client: admin, tenantId: gate.tenantId, tokens })
    const mentionedIds = mentioned.map(m => m.user_id).filter(uid => uid !== gate.userId)

    const { data: inserted, error: insertErr } = await admin
      .from('safety_board_threads')
      .insert({
        tenant_id:      gate.tenantId,
        board_id:       boardId,
        author_user_id: gate.userId,
        title,
        body:           text,
        body_mentions:  mentionedIds,
      })
      .select('*')
      .single()
    if (insertErr) {
      Sentry.captureException(insertErr, { tags: { route: 'safety-threads/POST', stage: 'insert' } })
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }
    const thread = (inserted as unknown) as ThreadRow

    if (mentionedIds.length > 0) {
      await admin.from('mentions').insert(mentionedIds.map(uid => ({
        tenant_id:         gate.tenantId,
        source_type:       'board_thread',
        source_id:         thread.id,
        author_user_id:    gate.userId,
        mentioned_user_id: uid,
      })))

      const { data: authorProfile } = await admin
        .from('profiles')
        .select('full_name, email')
        .eq('id', gate.userId)
        .maybeSingle()
      const authorName = (authorProfile as { full_name: string | null; email: string | null } | null)?.full_name
                      ?? (authorProfile as { full_name: string | null; email: string | null } | null)?.email
                      ?? 'Someone'
      void dispatchPushToProfiles({
        payload: {
          title: `${authorName} mentioned you on ${b.name}`,
          body:  title,
          url:   `/safety-boards/${boardId}/${thread.id}`,
          tag:   `board-thread:${thread.id}`,
        },
        profileIds: mentionedIds,
        source:     'board-thread',
      })
    }

    return NextResponse.json({ thread }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-threads/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
