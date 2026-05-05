import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  JHA_STATUSES,
  JHA_FREQUENCIES,
  type JhaStatus,
  type JhaFrequency,
} from '@soteria/core/jha'

// GET    /api/jha/[id]   — bundle (jha + steps + hazards + controls + audit)
// PATCH  /api/jha/[id]   — header updates (admin/owner only)
//
// Steps / hazards / controls editing rides through the slice-3
// editor-side endpoints (TBD). PATCH here is for the admin actions
// that don't change the breakdown structure: status transitions,
// reassignment, review-cadence updates.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    const [jhaRes, stepsRes, hazardsRes, controlsRes, auditRes] = await Promise.all([
      gate.authedClient.from('jhas').select('*').eq('id', id).eq('tenant_id', gate.tenantId).maybeSingle(),
      gate.authedClient.from('jha_steps').select('*').eq('jha_id', id).eq('tenant_id', gate.tenantId).order('sequence', { ascending: true }),
      gate.authedClient.from('jha_hazards').select('*').eq('jha_id', id).eq('tenant_id', gate.tenantId),
      gate.authedClient.from('jha_hazard_controls').select('*').eq('jha_id', id).eq('tenant_id', gate.tenantId),
      gate.authedClient.from('jha_audit_log').select('id, event_type, before_row, after_row, actor_id, actor_email, context, occurred_at').eq('jha_id', id).order('occurred_at', { ascending: false }).limit(50),
    ])

    if (jhaRes.error)      throw new Error(jhaRes.error.message)
    if (stepsRes.error)    throw new Error(stepsRes.error.message)
    if (hazardsRes.error)  throw new Error(hazardsRes.error.message)
    if (controlsRes.error) throw new Error(controlsRes.error.message)
    if (auditRes.error)    throw new Error(auditRes.error.message)

    if (!jhaRes.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Linked-risk lookup: any risks rows with source='jsa' whose
    // source_ref_id matches a hazard on this JHA. Powers the
    // "→ RSK-NNNN" pill on the detail page.
    const hazardIds = (hazardsRes.data ?? []).map(h => h.id)
    type LinkedRisk = { id: string; risk_number: string; source_ref_id: string }
    let linkedRisks: LinkedRisk[] = []
    if (hazardIds.length > 0) {
      const { data: linkRes, error: linkErr } = await gate.authedClient
        .from('risks')
        .select('id, risk_number, source_ref_id')
        .eq('tenant_id', gate.tenantId)
        .eq('source', 'jsa')
        .in('source_ref_id', hazardIds)
      if (linkErr) throw new Error(linkErr.message)
      linkedRisks = (linkRes ?? []) as LinkedRisk[]
    }

    return NextResponse.json({
      jha:           jhaRes.data,
      steps:         stepsRes.data    ?? [],
      hazards:       hazardsRes.data  ?? [],
      controls:      controlsRes.data ?? [],
      audit:         auditRes.data    ?? [],
      linked_risks:  linkedRisks,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'jha/[id]/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH ─────────────────────────────────────────────────────────────────

interface PatchBody {
  title?:             unknown
  description?:       unknown
  location?:          unknown
  performed_by?:      unknown
  frequency?:         unknown
  status?:            unknown
  assigned_to?:       unknown
  reviewer?:          unknown
  approver?:          unknown
  next_review_date?:  unknown
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: PatchBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}

  if (typeof body.title === 'string') {
    if (body.title.trim().length === 0) {
      return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
    }
    update.title = body.title.trim()
  }

  for (const k of ['description', 'location', 'performed_by'] as const) {
    const v = body[k]
    if (v === null) update[k] = null
    else if (typeof v === 'string') update[k] = v.trim() || null
  }

  if (typeof body.frequency === 'string') {
    if (!(JHA_FREQUENCIES as readonly string[]).includes(body.frequency)) {
      return NextResponse.json({ error: 'Invalid frequency' }, { status: 400 })
    }
    update.frequency = body.frequency as JhaFrequency
  }

  if (typeof body.status === 'string') {
    if (!(JHA_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    update.status = body.status as JhaStatus
    // Stamp approval at the moment of transition into 'approved'.
    // Reverting back to draft / in_review clears it.
    if (body.status === 'approved') {
      update.approved_at = new Date().toISOString()
      update.approved_by = gate.userId
    } else if (body.status === 'draft' || body.status === 'in_review') {
      update.approved_at = null
      update.approved_by = null
    }
  }

  for (const k of ['assigned_to', 'reviewer', 'approver'] as const) {
    const raw = body[k]
    if (raw === null) { update[k] = null; continue }
    if (typeof raw === 'string') {
      if (!UUID_RE.test(raw)) {
        return NextResponse.json({ error: `${k} must be a uuid or null` }, { status: 400 })
      }
      update[k] = raw
    }
  }

  if (body.next_review_date === null) {
    update.next_review_date = null
  } else if (typeof body.next_review_date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.next_review_date)) {
      return NextResponse.json({ error: 'next_review_date must be YYYY-MM-DD or null' }, { status: 400 })
    }
    update.next_review_date = body.next_review_date
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }

  update.updated_by = gate.userId

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('jhas')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()

    if (error) {
      Sentry.captureException(error, { tags: { route: 'jha/[id]/PATCH', stage: 'update' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Not found or wrong tenant' }, { status: 404 })

    return NextResponse.json({ jha: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'jha/[id]/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
