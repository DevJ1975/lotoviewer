import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { extractMentionTokens, resolveMentions } from '@/lib/notifications/mentions'
import { dispatchPushToProfiles } from '@/lib/notifications/pushFanout'

// GET   /api/incidents/[id]/actions/[actionId]/comments
//   Returns the comment thread on this action, oldest first, including
//   the author's avatar/name so the client can render without a second
//   roundtrip per row.
// POST  /api/incidents/[id]/actions/[actionId]/comments
//   Creates a new comment. Parses @-mentions, writes per-mention rows
//   into `mentions`, and best-effort fans out a Web Push to every
//   mentioned user (excluding self-mentions).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string; actionId: string }>
}

const SELECT_COLS = [
  'id', 'tenant_id', 'incident_action_id', 'author_user_id',
  'body', 'body_mentions', 'edited_at', 'deleted_at', 'created_at',
].join(', ')

export async function GET(req: Request, ctx: RouteContext) {
  const { id: incidentId, actionId } = await ctx.params
  if (!UUID_RE.test(incidentId) || !UUID_RE.test(actionId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    // Confirm the action exists and is in this tenant before exposing
    // its comments. The RLS policy already filters but the explicit
    // membership check gives a 404 instead of an empty array when the
    // action doesn't belong to the active tenant.
    const { data: action } = await gate.authedClient
      .from('incident_actions')
      .select('id')
      .eq('id', actionId)
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!action) return NextResponse.json({ error: 'Action not found' }, { status: 404 })

    type CommentRow = {
      id: string
      tenant_id: string
      incident_action_id: string
      author_user_id: string
      body: string
      body_mentions: string[]
      edited_at: string | null
      deleted_at: string | null
      created_at: string
    }
    const { data, error } = await gate.authedClient
      .from('action_item_comments')
      .select(SELECT_COLS)
      .eq('incident_action_id', actionId)
      .eq('tenant_id', gate.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    const rows = ((data as unknown) as CommentRow[] | null) ?? []

    // Hydrate authors. We can't join action_item_comments→profiles via
    // PostgREST embed because the FK on author_user_id targets
    // auth.users, not profiles. One extra round-trip keyed by the
    // distinct author_user_ids is cheaper than denormalizing the
    // author into the comment row.
    const authorIds = Array.from(new Set(rows.map(r => r.author_user_id)))
    const authorById = new Map<string, { email: string | null; full_name: string | null; avatar_url: string | null }>()
    if (authorIds.length > 0) {
      const { data: authors } = await gate.authedClient
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .in('id', authorIds)
      for (const p of (authors ?? []) as Array<{ id: string; email: string | null; full_name: string | null; avatar_url: string | null }>) {
        authorById.set(p.id, { email: p.email, full_name: p.full_name, avatar_url: p.avatar_url })
      }
    }

    const comments = rows.map(r => {
      const a = authorById.get(r.author_user_id)
      return {
        id: r.id,
        incident_action_id: r.incident_action_id,
        author_user_id: r.author_user_id,
        author_email: a?.email ?? null,
        author_full_name: a?.full_name ?? null,
        author_avatar_url: a?.avatar_url ?? null,
        body: r.body,
        body_mentions: r.body_mentions,
        edited_at: r.edited_at,
        created_at: r.created_at,
      }
    })
    return NextResponse.json({ comments })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'action-comments/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId, actionId } = await ctx.params
  if (!UUID_RE.test(incidentId) || !UUID_RE.test(actionId))
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

    // Confirm the action exists in this tenant + grab fields we need
    // for the push payload (incident report number).
    const { data: action } = await admin
      .from('incident_actions')
      .select('id, tenant_id, incident_id, owner_user_id, description')
      .eq('id', actionId)
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!action) return NextResponse.json({ error: 'Action not found' }, { status: 404 })

    // Resolve @-mentions to user_ids in this tenant. Self-mentions are
    // dropped (no point pinging yourself) and the action owner is
    // ALSO notified-by-default if they're not the author and aren't
    // already in the mention set — they likely care about activity on
    // their own action.
    const tokens = extractMentionTokens(text)
    const mentioned = await resolveMentions({
      client: admin, tenantId: gate.tenantId, tokens,
    })
    const mentionedIds = mentioned
      .map(m => m.user_id)
      .filter(uid => uid !== gate.userId)

    const { data: inserted, error: insertErr } = await admin
      .from('action_item_comments')
      .insert({
        tenant_id:          gate.tenantId,
        incident_action_id: actionId,
        author_user_id:     gate.userId,
        body:               text,
        body_mentions:      mentionedIds,
      })
      .select(SELECT_COLS)
      .single()
    if (insertErr) {
      Sentry.captureException(insertErr, { tags: { route: 'action-comments/POST', stage: 'insert' } })
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // Fan out mention rows + Web Push. Failures past the comment
    // insert are best-effort: the comment is already saved.
    const insertedId = ((inserted as unknown) as { id: string }).id
    const mentionRows = mentionedIds.map(uid => ({
      tenant_id:        gate.tenantId,
      source_type:      'action_comment',
      source_id:        insertedId,
      author_user_id:   gate.userId,
      mentioned_user_id: uid,
    }))
    if (mentionRows.length > 0) {
      const { error: mentionErr } = await admin.from('mentions').insert(mentionRows)
      if (mentionErr) {
        Sentry.captureException(mentionErr, { tags: { route: 'action-comments/POST', stage: 'mention-insert' } })
      }
    }

    // Notify the action owner about activity on their own action,
    // unless they are the author or already mentioned.
    const notifyIds = new Set(mentionedIds)
    if (action.owner_user_id && action.owner_user_id !== gate.userId) {
      notifyIds.add(action.owner_user_id)
    }
    if (notifyIds.size > 0) {
      // Author display name for the push title — best-effort.
      const { data: authorProfile } = await admin
        .from('profiles')
        .select('full_name, email')
        .eq('id', gate.userId)
        .maybeSingle()
      const authorName = authorProfile?.full_name
                      ?? authorProfile?.email
                      ?? 'Someone'
      const summary = text.length > 140 ? text.slice(0, 137) + '…' : text

      void dispatchPushToProfiles({
        payload: {
          title: `${authorName} commented on an action`,
          body:  summary,
          url:   `/incidents/${incidentId}/actions`,
          tag:   `action-comment:${actionId}`,
        },
        profileIds: Array.from(notifyIds),
        source:     'action-comment',
      })
    }

    return NextResponse.json({
      comment: {
        ...((inserted as unknown) as Record<string, unknown>),
        author_user_id: gate.userId,
      },
    }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'action-comments/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
