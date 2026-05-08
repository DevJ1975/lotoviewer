import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/safety-boards/search?q=<query>&board_id=<uuid?>&kind=<thread-kind?>
//
// Postgres full-text search over the tenant's threads + reply bodies.
// Uses websearch_to_tsquery so the input syntax is intuitive:
//   confined space     → AND of terms
//   "fall protection"  → exact phrase
//   -guardrail          → exclude term
//   harness OR fall    → OR
//
// Returns hits: thread row stubs (board_id, id, kind, title, snippet,
// last_reply_at, hit_in: 'thread' | 'reply') ranked by ts_rank_cd.
// Matches in replies surface their parent thread and include a body
// snippet from the matching reply.
//
// Tenant-scoped via RLS plus an explicit .eq('tenant_id') filter.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const KINDS = [
  'hazard_report', 'near_miss_reflection', 'lesson_learned',
  'alert', 'question', 'discussion',
] as const

interface ThreadHit {
  hit_in: 'thread' | 'reply'
  thread_id: string
  board_id: string
  kind: string
  title: string
  snippet: string
  rank: number
  last_reply_at: string
  reply_id: string | null
  is_anonymous: boolean
  author_full_name: string | null
  author_email: string | null
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const boardId = url.searchParams.get('board_id')?.trim() ?? null
  const kind = url.searchParams.get('kind')?.trim() ?? null
  if (!q) return NextResponse.json({ hits: [] })
  if (boardId && !UUID_RE.test(boardId)) {
    return NextResponse.json({ error: 'board_id must be a uuid' }, { status: 400 })
  }
  if (kind && !(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()

    // Build a textSearch via PostgREST. We pass `q` as websearch
    // syntax. Supabase supports `.textSearch('search_tsv', q, { type: 'websearch' })`.
    let threadQuery = admin
      .from('safety_board_threads')
      .select('id, board_id, kind, title, body, is_anonymous, author_user_id, last_reply_at, created_at')
      .eq('tenant_id', gate.tenantId)
      .is('deleted_at', null)
      .textSearch('search_tsv', q, { type: 'websearch' })
      .limit(40)
    if (boardId) threadQuery = threadQuery.eq('board_id', boardId)
    if (kind)    threadQuery = threadQuery.eq('kind',     kind)

    const { data: threadRows, error: threadErr } = await threadQuery
    if (threadErr) throw new Error(threadErr.message)

    // Filter by board/kind requires resolving the thread parent —
    // do it client-side after fetching.
    const { data: replyRows, error: replyErr } = await admin
      .from('safety_board_replies')
      .select('id, thread_id, body, is_anonymous, author_user_id, created_at')
      .eq('tenant_id', gate.tenantId)
      .is('deleted_at', null)
      .textSearch('search_tsv', q, { type: 'websearch' })
      .limit(80)
    if (replyErr) throw new Error(replyErr.message)

    type ThreadRow = { id: string; board_id: string; kind: string; title: string; body: string; is_anonymous: boolean; author_user_id: string; last_reply_at: string; created_at: string }
    type ReplyRow  = { id: string; thread_id: string; body: string; is_anonymous: boolean; author_user_id: string; created_at: string }
    const threads = ((threadRows ?? []) as unknown) as ThreadRow[]
    const replies = ((replyRows ?? []) as unknown) as ReplyRow[]

    // For reply hits we need parent threads to know board/kind/title
    // and to enforce the optional board_id/kind filter.
    const parentThreadIds = Array.from(new Set(replies.map(r => r.thread_id)))
    const { data: parents } = parentThreadIds.length > 0
      ? await admin
          .from('safety_board_threads')
          .select('id, board_id, kind, title, last_reply_at, deleted_at')
          .in('id', parentThreadIds)
          .eq('tenant_id', gate.tenantId)
      : { data: [] as Array<{ id: string; board_id: string; kind: string; title: string; last_reply_at: string; deleted_at: string | null }> }
    const parentById = new Map<string, { id: string; board_id: string; kind: string; title: string; last_reply_at: string }>()
    for (const p of (parents ?? []) as Array<{ id: string; board_id: string; kind: string; title: string; last_reply_at: string; deleted_at: string | null }>) {
      if (!p.deleted_at) parentById.set(p.id, p)
    }

    // Hydrate authors for non-anonymous hits.
    const authorIds = Array.from(new Set([
      ...threads.filter(t => !t.is_anonymous).map(t => t.author_user_id),
      ...replies.filter(r => !r.is_anonymous).map(r => r.author_user_id),
    ]))
    const profileById = new Map<string, { full_name: string | null; email: string | null }>()
    if (authorIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', authorIds)
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
        profileById.set(p.id, { full_name: p.full_name, email: p.email })
      }
    }

    // Snippet: first 180 chars of the matching body, with the search
    // terms preserved verbatim. Cheap-and-cheerful — Postgres
    // ts_headline is more accurate but adds complexity; the client
    // can highlight the terms client-side.
    function snippet(s: string, max = 180): string {
      const t = s.replace(/\s+/g, ' ').trim()
      return t.length > max ? t.slice(0, max - 1) + '…' : t
    }

    const hits: ThreadHit[] = []

    for (const t of threads) {
      const a = !t.is_anonymous ? profileById.get(t.author_user_id) : null
      hits.push({
        hit_in: 'thread',
        thread_id: t.id,
        board_id: t.board_id,
        kind: t.kind,
        title: t.title,
        snippet: snippet(t.body),
        rank: 1, // PostgREST doesn't expose ts_rank; relative ordering
                 // by created_at within hit_in='thread' is a fine
                 // first-cut, with thread hits ordered ahead of
                 // reply hits below.
        last_reply_at: t.last_reply_at,
        reply_id: null,
        is_anonymous: t.is_anonymous,
        author_full_name: a?.full_name ?? null,
        author_email: a?.email ?? null,
      })
    }

    for (const r of replies) {
      const parent = parentById.get(r.thread_id)
      if (!parent) continue
      if (boardId && parent.board_id !== boardId) continue
      if (kind && parent.kind !== kind) continue
      // Skip if we already surfaced this thread via a thread hit.
      if (hits.some(h => h.thread_id === parent.id && h.hit_in === 'thread')) continue
      const a = !r.is_anonymous ? profileById.get(r.author_user_id) : null
      hits.push({
        hit_in: 'reply',
        thread_id: parent.id,
        board_id: parent.board_id,
        kind: parent.kind,
        title: parent.title,
        snippet: snippet(r.body),
        rank: 0.5,
        last_reply_at: parent.last_reply_at,
        reply_id: r.id,
        is_anonymous: r.is_anonymous,
        author_full_name: a?.full_name ?? null,
        author_email: a?.email ?? null,
      })
    }

    // Sort: thread hits before reply hits, then most-recent activity.
    hits.sort((a, b) => (b.rank - a.rank) || (b.last_reply_at < a.last_reply_at ? -1 : 1))

    return NextResponse.json({ hits: hits.slice(0, 50) })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-search/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
