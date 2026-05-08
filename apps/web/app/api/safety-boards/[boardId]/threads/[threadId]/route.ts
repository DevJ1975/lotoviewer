import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { extractMentionTokens, resolveMentions } from '@/lib/notifications/mentions'

// GET    /api/safety-boards/[boardId]/threads/[threadId]
//   Hydrated thread + author + reactions.
// PATCH  /api/safety-boards/[boardId]/threads/[threadId]
//   Body fields:
//     - title, body  -> author or admin
//     - pinned       -> admin only
//     - locked       -> admin only
// DELETE /api/safety-boards/[boardId]/threads/[threadId]
//   Soft-delete. Author or admin.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ boardId: string; threadId: string }>
}

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

async function loadThread(
  admin: ReturnType<typeof supabaseAdmin>,
  threadId: string, boardId: string, tenantId: string,
): Promise<ThreadRow | null> {
  const { data } = await admin
    .from('safety_board_threads')
    .select('*')
    .eq('id', threadId)
    .eq('board_id', boardId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return ((data as unknown) as ThreadRow | null) ?? null
}

export async function GET(req: Request, ctx: RouteContext) {
  const { boardId, threadId } = await ctx.params
  if (!UUID_RE.test(boardId) || !UUID_RE.test(threadId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const t = await loadThread(admin, threadId, boardId, gate.tenantId)
    if (!t || t.deleted_at) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

    const isAnon = (t as ThreadRow & { is_anonymous?: boolean }).is_anonymous === true
    const [{ data: author }, { data: reactions }, { data: attachments }, { data: actionsFromThread }] = await Promise.all([
      isAnon
        ? Promise.resolve({ data: null })
        : admin.from('profiles').select('id, email, full_name, avatar_url').eq('id', t.author_user_id).maybeSingle(),
      admin.from('safety_board_reactions').select('user_id, emoji').eq('target_type', 'thread').eq('target_id', threadId).eq('tenant_id', gate.tenantId),
      admin.from('safety_board_attachments').select('id, storage_path, mime_type, size_bytes, width, height, filename').eq('target_type', 'thread').eq('target_id', threadId).eq('tenant_id', gate.tenantId),
      // CAPAs that were spawned from this thread (Tier 1 #3 — closes
      // the discussion → action loop).
      admin.from('incident_actions').select('id, description, status, due_at, owner_user_id, incident_id').eq('source_thread_id', threadId).eq('tenant_id', gate.tenantId),
    ])
    const a = author as { email: string | null; full_name: string | null; avatar_url: string | null } | null
    const byEmoji = new Map<string, string[]>()
    for (const r of (reactions ?? []) as Array<{ user_id: string; emoji: string }>) {
      const list = byEmoji.get(r.emoji) ?? []
      list.push(r.user_id)
      byEmoji.set(r.emoji, list)
    }
    const reactionList = Array.from(byEmoji.entries()).map(([emoji, user_ids]) => ({ emoji, user_ids, count: user_ids.length }))

    return NextResponse.json({
      thread: {
        ...t,
        author_user_id: isAnon ? null : t.author_user_id,
        author_email: a?.email ?? null,
        author_full_name: a?.full_name ?? null,
        author_avatar_url: a?.avatar_url ?? null,
        reactions: reactionList,
        attachments: attachments ?? [],
        spawned_actions: actionsFromThread ?? [],
      },
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-thread/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { boardId, threadId } = await ctx.params
  if (!UUID_RE.test(boardId) || !UUID_RE.test(threadId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: {
    title?: string
    body?: string
    pinned?: boolean
    locked?: boolean
    kind?: string
    metadata?: Record<string, unknown>
    linked_entity_type?: string | null
    linked_entity_id?: string | null
    acknowledgement_required?: boolean
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const KINDS = ['hazard_report','near_miss_reflection','lesson_learned','alert','question','discussion'] as const
  const LINK_TYPES_LOCAL = ['incident','near_miss','equipment','hot_work_permit','confined_space','incident_action','jha','toolbox_talk'] as const

  try {
    const admin = supabaseAdmin()
    const t = await loadThread(admin, threadId, boardId, gate.tenantId)
    if (!t || t.deleted_at) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

    const isPriv = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
    const isAuthor = t.author_user_id === gate.userId
    const wantsContentEdit = typeof body.title === 'string' || typeof body.body === 'string'
                          || 'kind' in body || 'metadata' in body
                          || 'linked_entity_type' in body || 'linked_entity_id' in body
    const wantsModerate    = 'pinned' in body || 'locked' in body || 'acknowledgement_required' in body
    if (wantsContentEdit && !(isAuthor || isPriv)) {
      return NextResponse.json({ error: 'Only the author or a tenant admin can edit' }, { status: 403 })
    }
    if (wantsModerate && !isPriv) {
      return NextResponse.json({ error: 'Pin / lock / acknowledgement-required is admin-only' }, { status: 403 })
    }
    if (t.locked && !isPriv) {
      return NextResponse.json({ error: 'Thread is locked' }, { status: 403 })
    }

    const update: Record<string, unknown> = {}
    if (typeof body.title === 'string') {
      const v = body.title.trim()
      if (v.length < 1 || v.length > 200) return NextResponse.json({ error: 'title must be 1-200 chars' }, { status: 400 })
      update.title = v
    }
    if (typeof body.body === 'string') {
      const v = body.body.trim()
      if (v.length < 1 || v.length > 20000) return NextResponse.json({ error: 'body must be 1-20000 chars' }, { status: 400 })
      update.body = v
      const tokens = extractMentionTokens(v)
      const resolved = await resolveMentions({ client: admin, tenantId: gate.tenantId, tokens })
      update.body_mentions = resolved.map(m => m.user_id).filter(uid => uid !== gate.userId)
    }
    if (typeof body.kind === 'string') {
      if (!(KINDS as readonly string[]).includes(body.kind)) {
        return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 })
      }
      update.kind = body.kind
    }
    if (body.metadata && typeof body.metadata === 'object') {
      update.metadata = body.metadata
    }
    if ('linked_entity_type' in body || 'linked_entity_id' in body) {
      const lt = body.linked_entity_type ?? null
      const lid = body.linked_entity_id ?? null
      if ((lt && !lid) || (!lt && lid)) {
        return NextResponse.json({ error: 'linked_entity_type and linked_entity_id must be set together' }, { status: 400 })
      }
      if (lt && !(LINK_TYPES_LOCAL as readonly string[]).includes(lt)) {
        return NextResponse.json({ error: `linked_entity_type must be one of ${LINK_TYPES_LOCAL.join(', ')}` }, { status: 400 })
      }
      if (lid && !UUID_RE.test(lid)) {
        return NextResponse.json({ error: 'linked_entity_id must be a uuid' }, { status: 400 })
      }
      update.linked_entity_type = lt
      update.linked_entity_id = lid
    }
    if (typeof body.acknowledgement_required === 'boolean') {
      update.acknowledgement_required = body.acknowledgement_required
    }
    if (typeof body.pinned === 'boolean') update.pinned = body.pinned
    if (typeof body.locked === 'boolean') update.locked = body.locked
    if (wantsContentEdit) update.edited_at = new Date().toISOString()
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('safety_board_threads')
      .update(update)
      .eq('id', threadId)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-thread/PATCH' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Reconcile mentions if body changed.
    if (typeof body.body === 'string') {
      const newIds = (update.body_mentions as string[]) ?? []
      const { data: existing } = await admin
        .from('mentions')
        .select('id, mentioned_user_id')
        .eq('source_type', 'board_thread')
        .eq('source_id', threadId)
        .eq('tenant_id', gate.tenantId)
      const existingByUid = new Map<string, string>()
      for (const r of (existing ?? []) as Array<{ id: string; mentioned_user_id: string }>) {
        existingByUid.set(r.mentioned_user_id, r.id)
      }
      const stillMentioned = new Set(newIds)
      const toDelete = Array.from(existingByUid.entries())
        .filter(([uid]) => !stillMentioned.has(uid))
        .map(([, id]) => id)
      const toInsert = newIds
        .filter(uid => !existingByUid.has(uid))
        .map(uid => ({
          tenant_id:         gate.tenantId,
          source_type:       'board_thread',
          source_id:         threadId,
          author_user_id:    gate.userId,
          mentioned_user_id: uid,
        }))
      if (toDelete.length > 0) await admin.from('mentions').delete().in('id', toDelete)
      if (toInsert.length > 0) await admin.from('mentions').insert(toInsert)
    }

    return NextResponse.json({ thread: data })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-thread/PATCH' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { boardId, threadId } = await ctx.params
  if (!UUID_RE.test(boardId) || !UUID_RE.test(threadId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const t = await loadThread(admin, threadId, boardId, gate.tenantId)
    if (!t || t.deleted_at) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

    const isPriv = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
    if (t.author_user_id !== gate.userId && !isPriv) {
      return NextResponse.json({ error: 'Only the author or a tenant admin can delete' }, { status: 403 })
    }

    const { error } = await admin
      .from('safety_board_threads')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', threadId)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-thread/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await admin.from('mentions')
      .delete()
      .eq('source_type', 'board_thread')
      .eq('source_id', threadId)
      .eq('tenant_id', gate.tenantId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-thread/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
