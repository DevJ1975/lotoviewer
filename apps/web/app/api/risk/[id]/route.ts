import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadRiskDetail } from '@soteria/core/queries/risks'

// GET    /api/risk/[id]   — risk + controls + reviews + audit timeline
// PATCH  /api/risk/[id]   — update mutable fields (admin/owner only)
//
// Auth:
//   - GET: any tenant member.
//   - PATCH: tenant admin or owner.
//
// Mutable fields validated against the schema's CHECK constraints.
// PPE-alone enforcement runs at the DB level (constraint trigger
// from migration 039); this route surfaces a friendlier message
// when that trigger fires.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_STATUSES = [
  'open','in_review','controls_in_progress','monitoring','closed','accepted_exception',
]

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    const bundle = await loadRiskDetail(gate.authedClient, id)
    if (!bundle) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(bundle)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'risk/[id]/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH ─────────────────────────────────────────────────────────────────

interface PatchBody {
  status?:                 unknown
  assigned_to?:            unknown
  reviewer?:               unknown
  approver?:               unknown
  next_review_date?:       unknown
  inherent_severity?:      unknown
  inherent_likelihood?:    unknown
  residual_severity?:      unknown
  residual_likelihood?:    unknown
  ppe_only_justification?: unknown
  title?:                  unknown
  description?:            unknown
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

  if (typeof body.status === 'string') {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    update.status = body.status
  }

  if (typeof body.title === 'string') {
    if (body.title.trim().length === 0) {
      return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
    }
    update.title = body.title.trim()
  }

  if (typeof body.description === 'string') {
    if (body.description.trim().length === 0) {
      return NextResponse.json({ error: 'description cannot be empty' }, { status: 400 })
    }
    update.description = body.description.trim()
  }

  for (const k of ['assigned_to', 'reviewer', 'approver'] as const) {
    const raw = body[k]
    if (raw === null) {
      update[k] = null
      continue
    }
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

  for (const k of ['inherent_severity', 'inherent_likelihood', 'residual_severity', 'residual_likelihood'] as const) {
    const raw = body[k]
    if (raw === undefined) continue
    if (raw === null && (k === 'residual_severity' || k === 'residual_likelihood')) {
      update[k] = null
      continue
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 5) {
      return NextResponse.json({ error: `${k} must be an integer 1..5` }, { status: 400 })
    }
    update[k] = raw
  }

  if (body.ppe_only_justification === null) {
    update.ppe_only_justification = null
  } else if (typeof body.ppe_only_justification === 'string') {
    update.ppe_only_justification = body.ppe_only_justification.trim() || null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }

  update.updated_by = gate.userId

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('risks')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)            // belt-and-suspenders tenant check
      .select('*')
      .maybeSingle()

    if (error) {
      // PPE-alone constraint trigger fires SQLSTATE '23514'
      // (check_violation) with a message starting with the
      // specific prefix below. Surface a clearer error so the
      // UI can show "document why" inline.
      if (typeof error.message === 'string' && error.message.includes('PPE-alone rule')) {
        return NextResponse.json({
          error: 'PPE-alone rule violation: this risk has inherent_score >= 8 and only PPE-level controls. Document why higher-level controls are not feasible in ppe_only_justification.',
          code:  'ppe_only_justification_required',
        }, { status: 422 })
      }
      Sentry.captureException(error, { tags: { route: 'risk/[id]/PATCH', stage: 'update' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Not found or wrong tenant' }, { status: 404 })

    return NextResponse.json({ risk: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'risk/[id]/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
