import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  NEAR_MISS_STATUSES,
  NEAR_MISS_SEVERITY_BANDS,
  type NearMissStatus,
  type NearMissSeverity,
} from '@soteria/core/nearMiss'

// GET    /api/near-miss/[id]   — report + audit timeline (any tenant member)
// PATCH  /api/near-miss/[id]   — triage actions (tenant admin/owner)
//
// Mutable fields on PATCH:
//   - status (any of the CHECKed values)
//   - assigned_to (uuid or null)
//   - severity_potential (re-band after triage review)
//   - resolution_notes / resolved_at (set when status becomes 'closed'
//     or 'escalated_to_risk' — we set resolved_at server-side rather
//     than trusting the client)
//
// linked_risk_id is intentionally NOT settable here — the only path
// to set it is the escalation route in slice 3 (POST /api/near-miss/
// [id]/escalate) which atomically creates the risk + sets the link.

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
    const { data: report, error: reportErr } = await gate.authedClient
      .from('near_misses')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (reportErr) throw new Error(reportErr.message)
    if (!report)   return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Audit timeline — last 50 events for this report.
    const { data: audit, error: auditErr } = await gate.authedClient
      .from('near_miss_audit_log')
      .select('id, event_type, before_row, after_row, actor_id, actor_email, context, occurred_at')
      .eq('near_miss_id', id)
      .order('occurred_at', { ascending: false })
      .limit(50)
    if (auditErr) throw new Error(auditErr.message)

    return NextResponse.json({ report, audit: audit ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'near-miss/[id]/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH ─────────────────────────────────────────────────────────────────

interface PatchBody {
  status?:             unknown
  assigned_to?:        unknown
  severity_potential?: unknown
  resolution_notes?:   unknown
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
    if (!(NEAR_MISS_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    update.status = body.status as NearMissStatus
    // Set resolved_at automatically when transitioning to a terminal
    // state. Cleared if moving back to an active state.
    if (body.status === 'closed' || body.status === 'escalated_to_risk') {
      update.resolved_at = new Date().toISOString()
    } else if (body.status === 'new' || body.status === 'triaged' || body.status === 'investigating') {
      update.resolved_at = null
    }
  }

  if (typeof body.severity_potential === 'string') {
    if (!(NEAR_MISS_SEVERITY_BANDS as readonly string[]).includes(body.severity_potential)) {
      return NextResponse.json({ error: 'Invalid severity_potential' }, { status: 400 })
    }
    update.severity_potential = body.severity_potential as NearMissSeverity
  }

  if (body.assigned_to === null) {
    update.assigned_to = null
  } else if (typeof body.assigned_to === 'string') {
    if (!UUID_RE.test(body.assigned_to)) {
      return NextResponse.json({ error: 'assigned_to must be a uuid or null' }, { status: 400 })
    }
    update.assigned_to = body.assigned_to
  }

  if (body.resolution_notes === null) {
    update.resolution_notes = null
  } else if (typeof body.resolution_notes === 'string') {
    update.resolution_notes = body.resolution_notes.trim() || null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }

  update.updated_by = gate.userId

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('near_misses')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()

    if (error) {
      Sentry.captureException(error, { tags: { route: 'near-miss/[id]/PATCH', stage: 'update' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Not found or wrong tenant' }, { status: 404 })

    return NextResponse.json({ report: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'near-miss/[id]/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
