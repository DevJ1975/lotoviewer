import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { extractMentionTokens, resolveMentions } from '@/lib/notifications/mentions'

// PATCH  /api/incidents/[id]/actions/[actionId]/comments/[commentId]
//   Edit body. Author-only. Re-parses mentions. Stamps edited_at.
// DELETE /api/incidents/[id]/actions/[actionId]/comments/[commentId]
//   Soft-delete (deleted_at). Author OR tenant admin/owner.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string; actionId: string; commentId: string }>
}

const SELECT_COLS = [
  'id', 'tenant_id', 'incident_action_id', 'author_user_id',
  'body', 'body_mentions', 'edited_at', 'deleted_at', 'created_at',
].join(', ')

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id: incidentId, actionId, commentId } = await ctx.params
  if (!UUID_RE.test(incidentId) || !UUID_RE.test(actionId) || !UUID_RE.test(commentId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { body?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text = (body.body ?? '').trim()
  if (!text) return NextResponse.json({ error: 'body is required' }, { status: 400 })
  if (text.length > 10000)
    return NextResponse.json({ error: 'body too long (max 10000 chars)' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('action_item_comments')
      .select('id, author_user_id, deleted_at')
      .eq('id', commentId)
      .eq('incident_action_id', actionId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!existing || existing.deleted_at)
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

    if (existing.author_user_id !== gate.userId) {
      return NextResponse.json({ error: 'Only the author can edit this comment' }, { status: 403 })
    }

    // Re-resolve mentions on edit so a new @ added during the edit
    // generates a mention row + push, and a removed @ stops counting
    // toward the unread badge for that recipient.
    const tokens = extractMentionTokens(text)
    const mentioned = await resolveMentions({ client: admin, tenantId: gate.tenantId, tokens })
    const mentionedIds = mentioned.map(m => m.user_id).filter(uid => uid !== gate.userId)

    const { data: updated, error: updateErr } = await admin
      .from('action_item_comments')
      .update({
        body:           text,
        body_mentions:  mentionedIds,
        edited_at:      new Date().toISOString(),
      })
      .eq('id', commentId)
      .eq('tenant_id', gate.tenantId)
      .select(SELECT_COLS)
      .single()
    if (updateErr) {
      Sentry.captureException(updateErr, { tags: { route: 'action-comments/PATCH', stage: 'update' } })
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    // Reconcile mention rows: keep existing rows for users still
    // mentioned, drop rows for users removed, insert rows for users
    // newly mentioned. Push notifications are NOT re-sent on edit —
    // edits shouldn't replay alerts the recipient already saw.
    const { data: existingRows } = await admin
      .from('mentions')
      .select('id, mentioned_user_id')
      .eq('source_type', 'action_comment')
      .eq('source_id',   commentId)
      .eq('tenant_id',   gate.tenantId)
    const existingByUid = new Map<string, string>()
    for (const r of (existingRows ?? []) as Array<{ id: string; mentioned_user_id: string }>) {
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
        source_type:       'action_comment',
        source_id:         commentId,
        author_user_id:    gate.userId,
        mentioned_user_id: uid,
      }))
    if (toDelete.length > 0) {
      await admin.from('mentions').delete().in('id', toDelete)
    }
    if (toInsert.length > 0) {
      await admin.from('mentions').insert(toInsert)
    }

    return NextResponse.json({ comment: updated })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'action-comments/PATCH' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id: incidentId, actionId, commentId } = await ctx.params
  if (!UUID_RE.test(incidentId) || !UUID_RE.test(actionId) || !UUID_RE.test(commentId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('action_item_comments')
      .select('id, author_user_id, deleted_at')
      .eq('id', commentId)
      .eq('incident_action_id', actionId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!existing || existing.deleted_at)
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

    const isAuthor = existing.author_user_id === gate.userId
    const isPriv =
      gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
    if (!isAuthor && !isPriv) {
      return NextResponse.json({ error: 'Only the author or a tenant admin can delete' }, { status: 403 })
    }

    const { error: updateErr } = await admin
      .from('action_item_comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', commentId)
      .eq('tenant_id', gate.tenantId)
    if (updateErr) {
      Sentry.captureException(updateErr, { tags: { route: 'action-comments/DELETE' } })
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    // Wipe pending mention rows for this comment so the unread badge
    // doesn't keep counting it. Best-effort.
    await admin
      .from('mentions')
      .delete()
      .eq('source_type', 'action_comment')
      .eq('source_id',   commentId)
      .eq('tenant_id',   gate.tenantId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'action-comments/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
