import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  validateCareVisit,
  CARE_VISIT_TYPES,
  type IncidentCareVisitInput,
  type CareVisitType,
} from '@soteria/core/incidentCare'

// POST /api/incidents/[id]/care/visits   Append a visit log entry to
//                                        the existing care case for
//                                        this incident. Same auth tier
//                                        as the care PATCH (admin /
//                                        investigator / case manager).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string }>
}

const VISIT_COLS = [
  'id', 'tenant_id', 'care_case_id',
  'visit_at', 'visit_type', 'notes', 'attachments_count',
  'created_at', 'created_by',
].join(', ')

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: IncidentCareVisitInput
  try { body = (await req.json()) as IncidentCareVisitInput }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.visit_type && !(CARE_VISIT_TYPES as readonly string[]).includes(body.visit_type))
    return NextResponse.json({ error: `Invalid visit_type: ${body.visit_type}` }, { status: 400 })
  const validation = validateCareVisit(body)
  if (validation) return NextResponse.json({ error: validation }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    // Resolve the care case + auth in one round-trip.
    const { data: incident } = await admin
      .from('incidents')
      .select('id, assigned_investigator')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const { data: caseRow } = await admin
      .from('incident_care_cases')
      .select('id, case_manager_user_id')
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!caseRow)
      return NextResponse.json({ error: 'No care case yet — create one first' }, { status: 404 })

    const isPriv =
      gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
      || incident.assigned_investigator === gate.userId
      || (caseRow as { case_manager_user_id: string | null }).case_manager_user_id === gate.userId
    if (!isPriv)
      return NextResponse.json({ error: 'Admin or investigator or case manager only' }, { status: 403 })

    const insert = {
      tenant_id:    gate.tenantId,
      care_case_id: (caseRow as { id: string }).id,
      visit_at:     body.visit_at ?? new Date().toISOString(),
      visit_type:   (body.visit_type as CareVisitType | undefined) ?? 'clinic',
      notes:        body.notes?.trim() || null,
      created_by:   gate.userId,
    }

    const { data, error } = await admin
      .from('incident_care_visits')
      .insert(insert)
      .select(VISIT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'care-visits/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ visit: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'care-visits/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
