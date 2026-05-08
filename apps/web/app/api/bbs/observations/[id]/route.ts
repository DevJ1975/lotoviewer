import { NextResponse } from 'next/server'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  BBS_STATUSES,
  BBS_SEVERITY,
  BBS_LIKELIHOOD,
  type BBSStatus,
  type BBSSeverity,
  type BBSLikelihood,
} from '@soteria/core/bbs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data: observation, error } = await gate.authedClient
      .from('bbs_observations')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!observation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [photosRes, actionsRes] = await Promise.all([
      gate.authedClient
        .from('bbs_observation_photos')
        .select('id, file_path, annotations, created_at, created_by')
        .eq('observation_id', id),
      gate.authedClient
        .from('bbs_observation_actions')
        .select('id, action_type, body, meta, created_at, created_by')
        .eq('observation_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    return NextResponse.json({
      observation,
      photos:  photosRes.data ?? [],
      actions: actionsRes.data ?? [],
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Triage / close-out actions are admin-only; submission belongs to anyone.
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_by: gate.userId }

  if (typeof body.status === 'string' && (BBS_STATUSES as readonly string[]).includes(body.status)) {
    update.status = body.status as BBSStatus
    if (body.status === 'closed') update.closed_by = gate.userId
  }
  if (typeof body.severity === 'string' && (BBS_SEVERITY as readonly string[]).includes(body.severity)) {
    update.severity = body.severity as BBSSeverity
  } else if (body.severity === null) {
    update.severity = null
  }
  if (typeof body.likelihood === 'string' && (BBS_LIKELIHOOD as readonly string[]).includes(body.likelihood)) {
    update.likelihood = body.likelihood as BBSLikelihood
  } else if (body.likelihood === null) {
    update.likelihood = null
  }
  if (typeof body.assigned_to === 'string' && UUID_RE.test(body.assigned_to)) {
    update.assigned_to = body.assigned_to
  } else if (body.assigned_to === null) {
    update.assigned_to = null
  }
  if (typeof body.due_date === 'string' || body.due_date === null) update.due_date = body.due_date
  if (typeof body.corrective_action === 'string') update.corrective_action = body.corrective_action.trim() || null
  if (typeof body.category === 'string') update.category = body.category.trim() || null
  if (typeof body.department === 'string') update.department = body.department.trim() || null

  if (Object.keys(update).length <= 1) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('bbs_observations')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Best-effort timeline event.
    if (typeof update.status === 'string') {
      await admin.from('bbs_observation_actions').insert({
        tenant_id:      gate.tenantId,
        observation_id: id,
        action_type:    update.status === 'closed' ? 'closed' : 'status_change',
        body:           typeof body.note === 'string' ? body.note : null,
        meta:           { to: update.status },
        created_by:     gate.userId,
      })
    }

    return NextResponse.json({ observation: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
