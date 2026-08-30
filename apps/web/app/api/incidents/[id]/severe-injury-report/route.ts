import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  SEVERE_INJURY_TRIGGERS,
  REPORT_METHODS,
  reportingWindowHours,
  resolveReportingJurisdiction,
  type SevereInjuryTrigger,
  type ReportMethod,
  type ReportingJurisdiction,
} from '@soteria/core/oshaSevereInjuryReport'

// GET    /api/incidents/[id]/severe-injury-report   List the reportable
//        triggers tracked for this incident (may be empty), plus the
//        jurisdiction a not-yet-created trigger would be tracked under.
// POST   /api/incidents/[id]/severe-injury-report   Upsert one trigger's
//        row (add it, or record the filing on it). Keyed by
//        (incident_id, trigger_type).
// DELETE /api/incidents/[id]/severe-injury-report?trigger=...  Remove a
//        trigger that was added in error.
//
// The reporting window is jurisdiction-dependent (federal 8h/24h vs.
// Cal/OSHA 8h across the board), so the jurisdiction is resolved HERE from
// the establishment's state and frozen onto the row. The client is never
// trusted to supply it — a browser that sent 'federal' for a California
// site would buy itself 16 hours of false headroom.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT_COLS =
  'id, tenant_id, incident_id, trigger_type, basis_at, reported_at, report_method, osha_case_number, notes, reported_by, created_at, updated_at, reporting_jurisdiction, reporting_window_hours'

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

type AdminClient = ReturnType<typeof supabaseAdmin>

/**
 * Which agency's reporting window governs this incident.
 *
 * Preference order — most specific location first: the incident's own
 * facility, then the tenant's primary facility, then any establishment the
 * tenant has registered for OSHA recordkeeping. Anything unresolved falls
 * back to federal, which is never the shorter window, so a miss here can
 * only ever be conservative in the wrong direction — it can't invent time
 * a California site doesn't have. Multi-state tenants get the right answer
 * as long as the incident carries a facility, which migration 210 defaults
 * from the active-facility header.
 */
async function resolveJurisdiction(
  admin: AdminClient,
  tenantId: string,
  incidentId: string | null,
): Promise<ReportingJurisdiction> {
  if (incidentId) {
    const { data: incident } = await admin
      .from('incidents')
      .select('facility_id')
      .eq('id', incidentId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (incident?.facility_id) {
      const { data: facility } = await admin
        .from('facilities')
        .select('state')
        .eq('id', incident.facility_id)
        .maybeSingle()
      if (facility?.state) return resolveReportingJurisdiction(facility.state)
    }
  }

  const { data: primary } = await admin
    .from('facilities')
    .select('state')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()
  if (primary?.state) return resolveReportingJurisdiction(primary.state)

  const { data: establishment } = await admin
    .from('osha_establishments')
    .select('state')
    .eq('tenant_id', tenantId)
    .not('state', 'is', null)
    .limit(1)
    .maybeSingle()
  return resolveReportingJurisdiction(establishment?.state)
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

    // The jurisdiction a not-yet-created trigger would land in, so the "flag
    // a reportable event" form can show the real window before the row exists.
    const jurisdiction = await resolveJurisdiction(supabaseAdmin(), gate.tenantId, incidentId)

    return NextResponse.json({ reports: data ?? [], jurisdiction })
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

    // Fields a filing update may change. The deadline-defining fields
    // (reporting_jurisdiction, reporting_window_hours, basis_at) and the
    // original author (created_by) are deliberately absent: migration 252
    // freezes the jurisdiction + window at write time so re-pointing a facility
    // later never silently moves a deadline someone was already held to, and
    // RegulatoryReportingPanel's countdown relies on that. A blanket upsert
    // re-resolved and overwrote all of them on every "record filing" POST.
    const mutable = {
      reported_at:      reportedAt,
      report_method:    body.report_method ?? null,
      osha_case_number: body.osha_case_number?.trim() || null,
      notes:            body.notes?.trim() || null,
      reported_by:      reportedAt ? gate.userId : null,
      updated_by:       gate.userId,
    }

    // Add the trigger. Jurisdiction is resolved and frozen HERE, on the insert
    // only. A 23505 means the row already exists (recording a filing / editing),
    // so fall through to an update that leaves the frozen fields untouched.
    const jurisdiction = await resolveJurisdiction(admin, gate.tenantId, incidentId)
    const { data: inserted, error: insertErr } = await admin
      .from('incident_severe_injury_reports')
      .insert({
        tenant_id:              gate.tenantId,
        incident_id:            incidentId,
        trigger_type:           body.trigger_type,
        basis_at:               new Date(basisMs).toISOString(),
        created_by:             gate.userId,
        reporting_jurisdiction: jurisdiction,
        reporting_window_hours: reportingWindowHours(body.trigger_type, jurisdiction),
        ...mutable,
      })
      .select(SELECT_COLS)
      .single()
    if (!insertErr) return NextResponse.json({ report: inserted }, { status: 201 })

    if ((insertErr as { code?: string }).code === '23505') {
      const { data: updated, error: updateErr } = await admin
        .from('incident_severe_injury_reports')
        .update(mutable)
        .eq('tenant_id', gate.tenantId)
        .eq('incident_id', incidentId)
        .eq('trigger_type', body.trigger_type)
        .select(SELECT_COLS)
        .single()
      if (updateErr) {
        Sentry.captureException(updateErr, { tags: { route: 'severe-injury-report/POST', stage: 'update' } })
        return NextResponse.json({ error: updateErr.message }, { status: 500 })
      }
      return NextResponse.json({ report: updated }, { status: 200 })
    }

    Sentry.captureException(insertErr, { tags: { route: 'severe-injury-report/POST', stage: 'insert' } })
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
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
