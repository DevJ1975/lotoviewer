import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  SEVERE_INJURY_TRIGGERS,
  REPORT_METHODS,
  type SevereInjuryTrigger,
  type ReportMethod,
} from '@soteria/core/oshaSevereInjuryReport'

// GET    /api/incidents/[id]/severe-injury-report   List the 1904.39
//        reportable triggers tracked for this incident (may be empty).
// POST   /api/incidents/[id]/severe-injury-report   Upsert one trigger's
//        row (add it, or record the OSHA filing on it). Keyed by
//        (incident_id, trigger_type).
// DELETE /api/incidents/[id]/severe-injury-report?trigger=...  Remove a
//        trigger that was added in error.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT_COLS =
  'id, tenant_id, incident_id, trigger_type, basis_at, reported_at, report_method, osha_case_number, notes, reported_by, created_at, updated_at'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface UpsertBody {
  trigger_type:      SevereInjuryTrigger
  basis_at:          string
  reported_at?:      string | null
  report_method?:    ReportMethod | null
  osha_case_number?: string | null
  notes?:            string | null
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('incident_severe_injury_reports')
      .select(SELECT_COLS)
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .order('basis_at', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ reports: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'severe-injury-report/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST — add a trigger or record its filing ────────────────────────────────

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: UpsertBody
  try { body = (await req.json()) as UpsertBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!(SEVERE_INJURY_TRIGGERS as readonly string[]).includes(body.trigger_type))
    return NextResponse.json({ error: `Invalid trigger_type: ${body.trigger_type}` }, { status: 400 })

  const basisMs = Date.parse(body.basis_at ?? '')
  if (Number.isNaN(basisMs))
    return NextResponse.json({ error: 'basis_at must be a valid timestamp' }, { status: 400 })
  if (basisMs > Date.now() + 5 * 60_000)
    return NextResponse.json({ error: 'basis_at cannot be in the future' }, { status: 400 })

  let reportedAt: string | null = null
  if (body.reported_at != null) {
    const reportedMs = Date.parse(body.reported_at)
    if (Number.isNaN(reportedMs))
      return NextResponse.json({ error: 'reported_at must be a valid timestamp' }, { status: 400 })
    if (reportedMs > Date.now() + 5 * 60_000)
      return NextResponse.json({ error: 'reported_at cannot be in the future' }, { status: 400 })
    reportedAt = new Date(reportedMs).toISOString()
  }

  if (body.report_method != null && !(REPORT_METHODS as readonly string[]).includes(body.report_method))
    return NextResponse.json({ error: `Invalid report_method: ${body.report_method}` }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    const { data: incident } = await admin
      .from('incidents')
      .select('id')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const row = {
      tenant_id:        gate.tenantId,
      incident_id:      incidentId,
      trigger_type:     body.trigger_type,
      basis_at:         new Date(basisMs).toISOString(),
      reported_at:      reportedAt,
      report_method:    body.report_method ?? null,
      osha_case_number: body.osha_case_number?.trim() || null,
      notes:            body.notes?.trim() || null,
      reported_by:      reportedAt ? gate.userId : null,
      updated_by:       gate.userId,
      created_by:       gate.userId,
    }

    const { data, error } = await admin
      .from('incident_severe_injury_reports')
      .upsert(row, { onConflict: 'incident_id,trigger_type', ignoreDuplicates: false })
      .select(SELECT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'severe-injury-report/POST', stage: 'upsert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ report: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'severe-injury-report/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── DELETE — remove a trigger added in error ─────────────────────────────────

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const trigger = new URL(req.url).searchParams.get('trigger')
  if (!trigger || !(SEVERE_INJURY_TRIGGERS as readonly string[]).includes(trigger))
    return NextResponse.json({ error: `Invalid trigger: ${trigger}` }, { status: 400 })

  try {
    const { error } = await gate.authedClient
      .from('incident_severe_injury_reports')
      .delete()
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .eq('trigger_type', trigger)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'severe-injury-report/DELETE' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
