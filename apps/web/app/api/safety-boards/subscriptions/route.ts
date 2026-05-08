import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET    /api/safety-boards/subscriptions?type=board&id=<uuid>
//   Returns the caller's subscription state for the given target.
//
// PUT    /api/safety-boards/subscriptions
//   Body: { target_type: 'board'|'thread', target_id, state: 'follow'|'mute' }
//   Idempotent upsert. Used to follow, mute, or change state.
//
// DELETE /api/safety-boards/subscriptions?type=...&id=...
//   Removes the row entirely (back to "no preference" — implicit
//   defaults apply: thread author still gets notified by default).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TARGETS = ['board', 'thread'] as const
const STATES = ['follow', 'mute'] as const

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const type = url.searchParams.get('type') ?? ''
  const id   = url.searchParams.get('id') ?? ''
  if (!(TARGETS as readonly string[]).includes(type)) return NextResponse.json({ error: 'type must be board|thread' }, { status: 400 })
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'id must be uuid' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data } = await admin
      .from('safety_board_subscriptions')
      .select('state, created_at')
      .eq('user_id', gate.userId)
      .eq('tenant_id', gate.tenantId)
      .eq('target_type', type)
      .eq('target_id', id)
      .maybeSingle()
    return NextResponse.json({ subscription: data ?? null })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-subs/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { target_type?: string; target_id?: string; state?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const targetType = (body.target_type ?? '').trim()
  const targetId   = (body.target_id ?? '').trim()
  const state      = (body.state ?? '').trim()
  if (!(TARGETS as readonly string[]).includes(targetType)) return NextResponse.json({ error: 'target_type must be board|thread' }, { status: 400 })
  if (!UUID_RE.test(targetId)) return NextResponse.json({ error: 'target_id must be uuid' }, { status: 400 })
  if (!(STATES as readonly string[]).includes(state)) return NextResponse.json({ error: 'state must be follow|mute' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { error } = await admin
      .from('safety_board_subscriptions')
      .upsert({
        user_id:     gate.userId,
        tenant_id:   gate.tenantId,
        target_type: targetType,
        target_id:   targetId,
        state,
      }, { onConflict: 'user_id,target_type,target_id' })
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-subs/PUT' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-subs/PUT' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const type = url.searchParams.get('type') ?? ''
  const id   = url.searchParams.get('id') ?? ''
  if (!(TARGETS as readonly string[]).includes(type)) return NextResponse.json({ error: 'type must be board|thread' }, { status: 400 })
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'id must be uuid' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { error } = await admin
      .from('safety_board_subscriptions')
      .delete()
      .eq('user_id', gate.userId)
      .eq('tenant_id', gate.tenantId)
      .eq('target_type', type)
      .eq('target_id', id)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-subs/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-subs/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
