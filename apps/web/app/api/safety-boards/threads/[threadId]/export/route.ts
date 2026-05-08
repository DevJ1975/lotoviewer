import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { renderSafetyThreadPdf } from '@/lib/pdfSafetyThread'

// GET /api/safety-boards/threads/[threadId]/export
//
// Streams a PDF rendering of the thread (post + replies + acks +
// spawned actions) for evidence files. Tenant-scoped via the gate;
// a member of tenant A cannot fetch tenant B's threads.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ threadId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const { threadId } = await ctx.params
  if (!UUID_RE.test(threadId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: thread } = await admin
      .from('safety_board_threads')
      .select('id, board_id, kind, title, body, created_at, edited_at, is_anonymous, pinned, locked, acknowledgement_required, author_user_id, linked_entity_type, deleted_at')
      .eq('id', threadId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    type T = {
      id: string; board_id: string; kind: string; title: string; body: string;
      created_at: string; edited_at: string | null; is_anonymous: boolean;
      pinned: boolean; locked: boolean; acknowledgement_required: boolean;
      author_user_id: string; linked_entity_type: string | null;
      deleted_at: string | null
    }
    const t = thread as T | null
    if (!t || t.deleted_at) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

    const [{ data: replies }, { data: acks }, { data: actions }, { data: board }, { data: tenant }] = await Promise.all([
      admin.from('safety_board_replies')
        .select('body, created_at, edited_at, is_anonymous, author_user_id')
        .eq('thread_id', threadId)
        .eq('tenant_id', gate.tenantId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true }),
      admin.from('safety_board_acknowledgements')
        .select('user_id, acknowledged_at, comment')
        .eq('thread_id', threadId)
        .eq('tenant_id', gate.tenantId)
        .order('acknowledged_at', { ascending: true }),
      admin.from('incident_actions')
        .select('description, status, due_at')
        .eq('source_thread_id', threadId)
        .eq('tenant_id', gate.tenantId),
      admin.from('safety_boards').select('name').eq('id', t.board_id).maybeSingle(),
      admin.from('tenants').select('name').eq('id', gate.tenantId).maybeSingle(),
    ])

    type ReplyRow = { body: string; created_at: string; edited_at: string | null; is_anonymous: boolean; author_user_id: string }
    type AckRow   = { user_id: string; acknowledged_at: string; comment: string | null }
    const replyRows = (replies ?? []) as ReplyRow[]
    const ackRows   = (acks    ?? []) as AckRow[]

    // Hydrate author profiles for non-anonymous threads/replies +
    // acknowledgements.
    const userIds = new Set<string>()
    if (!t.is_anonymous) userIds.add(t.author_user_id)
    for (const r of replyRows) if (!r.is_anonymous) userIds.add(r.author_user_id)
    for (const a of ackRows) userIds.add(a.user_id)
    const profileById = new Map<string, { full_name: string | null; email: string | null }>()
    if (userIds.size > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', Array.from(userIds))
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
        profileById.set(p.id, { full_name: p.full_name, email: p.email })
      }
    }

    const threadAuthor = !t.is_anonymous ? profileById.get(t.author_user_id) : null
    const pdfBytes = await renderSafetyThreadPdf({
      tenantName: (tenant as { name: string } | null)?.name ?? null,
      boardName:  (board as { name: string } | null)?.name ?? 'Board',
      thread: {
        kind:        t.kind,
        title:       t.title,
        body:        t.body,
        created_at:  t.created_at,
        edited_at:   t.edited_at,
        is_anonymous: t.is_anonymous,
        pinned:      t.pinned,
        locked:      t.locked,
        acknowledgement_required: t.acknowledgement_required,
        author_full_name: threadAuthor?.full_name ?? null,
        author_email:     threadAuthor?.email     ?? null,
        linked_entity_type: t.linked_entity_type,
      },
      replies: replyRows.map(r => {
        const a = !r.is_anonymous ? profileById.get(r.author_user_id) : null
        return {
          body: r.body,
          created_at: r.created_at,
          edited_at: r.edited_at,
          is_anonymous: r.is_anonymous,
          author_full_name: a?.full_name ?? null,
          author_email:     a?.email     ?? null,
        }
      }),
      acknowledgements: ackRows.map(ack => {
        const p = profileById.get(ack.user_id)
        return {
          full_name: p?.full_name ?? null,
          email:     p?.email     ?? null,
          acknowledged_at: ack.acknowledged_at,
          comment: ack.comment,
        }
      }),
      spawnedActions: ((actions ?? []) as Array<{ description: string; status: string; due_at: string | null }>),
    })

    const filename = `safety-thread-${threadId.slice(0, 8)}.pdf`
    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-thread-export/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
