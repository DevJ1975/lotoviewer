import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/safety-boards/threads/[threadId]/acknowledge
//   Body: { comment? }
//   Records this user's acknowledgement of a thread that has
//   acknowledgement_required=true. Idempotent — re-posting updates
//   the comment but doesn't duplicate the row (PK on thread+user).
//
// GET  /api/safety-boards/threads/[threadId]/acknowledge
//   Returns:
//     - mine:       { acknowledged_at, comment } | null
//     - count:      total acks for this thread (admin reporting)
//     - acks:       [...]  (admin only — full list with profiles)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ threadId: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const { threadId } = await ctx.params
  if (!UUID_RE.test(threadId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { comment?: string } = {}
  try { body = await req.json() } catch { /* empty body OK */ }
  const comment = (body.comment ?? '').trim().slice(0, 1000) || null

  try {
    const admin = supabaseAdmin()
    const { data: thread } = await admin
      .from('safety_board_threads')
      .select('id, tenant_id, title, deleted_at, acknowledgement_required')
      .eq('id', threadId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    const t = thread as { id: string; tenant_id: string; title: string; deleted_at: string | null; acknowledgement_required: boolean } | null
    if (!t || t.deleted_at) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
    if (!t.acknowledgement_required) {
      return NextResponse.json({ error: 'This thread does not require acknowledgement.' }, { status: 400 })
    }

    const { error } = await admin
      .from('safety_board_acknowledgements')
      .upsert({
        thread_id:           threadId,
        user_id:             gate.userId,
        tenant_id:           gate.tenantId,
        comment,
        thread_title_at_ack: t.title,
      }, { onConflict: 'thread_id,user_id' })
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-ack/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-ack/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function GET(req: Request, ctx: RouteContext) {
  const { threadId } = await ctx.params
  if (!UUID_RE.test(threadId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const isPriv = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'

    const { data: mine } = await admin
      .from('safety_board_acknowledgements')
      .select('acknowledged_at, comment')
      .eq('thread_id', threadId)
      .eq('user_id', gate.userId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()

    const { count } = await admin
      .from('safety_board_acknowledgements')
      .select('thread_id', { count: 'exact', head: true })
      .eq('thread_id', threadId)
      .eq('tenant_id', gate.tenantId)

    let acks: Array<{ user_id: string; acknowledged_at: string; comment: string | null; full_name: string | null; email: string | null }> = []
    if (isPriv) {
      const { data: rows } = await admin
        .from('safety_board_acknowledgements')
        .select('user_id, acknowledged_at, comment')
        .eq('thread_id', threadId)
        .eq('tenant_id', gate.tenantId)
        .order('acknowledged_at', { ascending: false })
      const uids = Array.from(new Set((rows ?? []).map(r => (r as { user_id: string }).user_id)))
      const profileById = new Map<string, { full_name: string | null; email: string | null }>()
      if (uids.length > 0) {
        const { data: profiles } = await admin
          .from('profiles')
          .select('id, full_name, email')
          .in('id', uids)
        for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
          profileById.set(p.id, { full_name: p.full_name, email: p.email })
        }
      }
      acks = (rows ?? []).map(r => {
        const row = r as { user_id: string; acknowledged_at: string; comment: string | null }
        const p = profileById.get(row.user_id)
        return {
          user_id: row.user_id,
          acknowledged_at: row.acknowledged_at,
          comment: row.comment,
          full_name: p?.full_name ?? null,
          email: p?.email ?? null,
        }
      })
    }

    return NextResponse.json({
      mine: mine ?? null,
      count: count ?? 0,
      acks,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-ack/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
