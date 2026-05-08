import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { extractMentionTokens, resolveMentions } from '@/lib/notifications/mentions'

// PATCH  /api/safety-boards/replies/[replyId]   Edit body. Author only.
// DELETE /api/safety-boards/replies/[replyId]   Soft-delete. Author or admin.
//
// Lives at a top-level path (not nested under board/thread) so the
// client doesn't need to remember the board id when editing — the
// route looks up the parent thread itself.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ replyId: string }> }

export async function PATCH(req: Request, ctx: RouteContext) {
  const { replyId } = await ctx.params
  if (!UUID_RE.test(replyId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { body?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text = (body.body ?? '').trim()
  if (text.length < 1 || text.length > 20000) {
    return NextResponse.json({ error: 'body must be 1-20000 chars' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('safety_board_replies')
      .select('id, author_user_id, deleted_at, thread_id')
      .eq('id', replyId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    const e = existing as { id: string; author_user_id: string; deleted_at: string | null; thread_id: string } | null
    if (!e || e.deleted_at) return NextResponse.json({ error: 'Reply not found' }, { status: 404 })
    if (e.author_user_id !== gate.userId) {
      return NextResponse.json({ error: 'Only the author can edit' }, { status: 403 })
    }

    const tokens = extractMentionTokens(text)
    const resolved = await resolveMentions({ client: admin, tenantId: gate.tenantId, tokens })
    const mentionedIds = resolved.map(m => m.user_id).filter(uid => uid !== gate.userId)

    const { data, error } = await admin
      .from('safety_board_replies')
      .update({
        body:           text,
        body_mentions:  mentionedIds,
        edited_at:      new Date().toISOString(),
      })
      .eq('id', replyId)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-reply/PATCH' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Reconcile mention rows.
    const { data: existingMentions } = await admin
      .from('mentions')
      .select('id, mentioned_user_id')
      .eq('source_type', 'board_reply')
      .eq('source_id', replyId)
      .eq('tenant_id', gate.tenantId)
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
        source_type:       'board_reply',
        source_id:         replyId,
        author_user_id:    gate.userId,
        mentioned_user_id: uid,
      }))
    if (toDelete.length > 0) await admin.from('mentions').delete().in('id', toDelete)
    if (toInsert.length > 0) await admin.from('mentions').insert(toInsert)

    return NextResponse.json({ reply: data })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-reply/PATCH' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { replyId } = await ctx.params
  if (!UUID_RE.test(replyId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('safety_board_replies')
      .select('id, author_user_id, deleted_at')
      .eq('id', replyId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    const e = existing as { id: string; author_user_id: string; deleted_at: string | null } | null
    if (!e || e.deleted_at) return NextResponse.json({ error: 'Reply not found' }, { status: 404 })

    const isPriv = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
    if (e.author_user_id !== gate.userId && !isPriv) {
      return NextResponse.json({ error: 'Only the author or a tenant admin can delete' }, { status: 403 })
    }

    const { error } = await admin
      .from('safety_board_replies')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', replyId)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-reply/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await admin.from('mentions')
      .delete()
      .eq('source_type', 'board_reply')
      .eq('source_id', replyId)
      .eq('tenant_id', gate.tenantId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-reply/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
