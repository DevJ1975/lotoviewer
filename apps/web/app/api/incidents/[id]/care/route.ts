import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, type TenantGate } from '@/lib/auth/tenantGate'

type TenantGateOk = Extract<TenantGate, { ok: true }>
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  validateCareCasePatch,
  CARE_CASE_STATUSES,
  type IncidentCareCaseCreateInput,
  type IncidentCareCasePatchInput,
  type CareCaseStatus,
} from '@soteria/core/incidentCare'

// GET    /api/incidents/[id]/care        Read the care case + visits
//                                         for this incident's primary
//                                         injured person. 200 with
//                                         { case: null } when no case
//                                         exists yet.
// POST   /api/incidents/[id]/care        Create or upsert the care
//                                         case. Idempotent on
//                                         (incident_id, person_id).
//                                         Admin OR investigator OR
//                                         designated case manager.
// PATCH  /api/incidents/[id]/care        Update fields on the existing
//                                         case.
//
// Visit endpoints live at /care/visits/route.ts.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CASE_COLS = [
  'id', 'tenant_id', 'incident_id', 'person_id',
  'case_status', 'initial_visit_at', 'treating_physician', 'clinic_name', 'diagnosis',
  'days_away_from_work', 'days_restricted', 'days_lost',
  'return_to_work_at', 'modified_duty_start', 'modified_duty_end', 'restrictions',
  'next_followup_at',
  'drug_test_status', 'drug_test_at', 'drug_test_notes',
  'case_manager_user_id',
  'created_at', 'updated_at', 'created_by', 'updated_by',
].join(', ')

const VISIT_COLS = [
  'id', 'tenant_id', 'care_case_id',
  'visit_at', 'visit_type', 'notes', 'attachments_count',
  'created_at', 'created_by',
].join(', ')

interface RouteContext {
  params: Promise<{ id: string }>
}

// ─── Authorization helper ──────────────────────────────────────────────────
//
// Care data is PII-adjacent (diagnosis, restrictions). Members can
// READ the care case if they're the assigned investigator or the
// case manager; admins always can. Writes require admin or
// investigator/case-manager.

async function loadAuthContext(req: Request, incidentId: string): Promise<
  | { ok: true; gate: TenantGateOk; isPriv: boolean }
  | { ok: false; status: number; message: string }
> {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return { ok: false, status: gate.status, message: gate.message }

  const admin = supabaseAdmin()
  const { data: incident } = await admin
    .from('incidents')
    .select('id, assigned_investigator')
    .eq('id', incidentId)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (!incident) return { ok: false, status: 404, message: 'Incident not found' }

  const { data: existingCase } = await admin
    .from('incident_care_cases')
    .select('case_manager_user_id')
    .eq('incident_id', incidentId)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()

  const isPriv =
    gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
    || incident.assigned_investigator === gate.userId
    || existingCase?.case_manager_user_id === gate.userId

  return { ok: true, gate, isPriv }
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const auth = await loadAuthContext(req, incidentId)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  if (!auth.isPriv) {
    return NextResponse.json({
      error: 'Care data is restricted to admins, the assigned investigator, and the case manager.',
    }, { status: 403 })
  }

  try {
    const { data: caseRow, error } = await auth.gate.authedClient
      .from('incident_care_cases')
      .select(CASE_COLS)
      .eq('incident_id', incidentId)
      .eq('tenant_id', auth.gate.tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)

    let visits: unknown[] = []
    if (caseRow) {
      const { data: vs, error: vErr } = await auth.gate.authedClient
        .from('incident_care_visits')
        .select(VISIT_COLS)
        .eq('care_case_id', (caseRow as unknown as { id: string }).id)
        .order('visit_at', { ascending: false })
      if (vErr) throw new Error(vErr.message)
      visits = vs ?? []
    }
    return NextResponse.json({ case: caseRow ?? null, visits })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'care/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST — create/upsert ──────────────────────────────────────────────────

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const auth = await loadAuthContext(req, incidentId)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })
  if (!auth.isPriv)
    return NextResponse.json({ error: 'Admin or investigator only' }, { status: 403 })

  let body: IncidentCareCaseCreateInput
  try { body = (await req.json()) as IncidentCareCaseCreateInput }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.person_id && !UUID_RE.test(body.person_id))
    return NextResponse.json({ error: 'person_id must be a uuid' }, { status: 400 })
  if (body.case_status && !(CARE_CASE_STATUSES as readonly string[]).includes(body.case_status))
    return NextResponse.json({ error: `Invalid case_status: ${body.case_status}` }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    // Resolve person_id: caller-provided wins; else fall back to the
    // incident's primary injured person.
    let personId = body.person_id ?? null
    if (!personId) {
      const { data: primary } = await admin
        .from('incident_people')
        .select('id')
        .eq('incident_id', incidentId)
        .eq('person_role', 'injured')
        .eq('is_primary', true)
        .maybeSingle()
      personId = (primary as { id: string } | null)?.id ?? null
    }

    const insert = {
      tenant_id:            auth.gate.tenantId,
      incident_id:          incidentId,
      person_id:            personId,
      case_status:          (body.case_status as CareCaseStatus | undefined) ?? 'open',
      initial_visit_at:     body.initial_visit_at ?? null,
      treating_physician:   body.treating_physician?.trim() || null,
      clinic_name:          body.clinic_name?.trim() || null,
      diagnosis:            body.diagnosis?.trim() || null,
      next_followup_at:     body.next_followup_at ?? null,
      case_manager_user_id: body.case_manager_user_id ?? null,
      created_by:           auth.gate.userId,
      updated_by:           auth.gate.userId,
    }

    // Upsert on the (incident_id, person_id) compound — but person_id
    // may be null, which UPSERT's onConflict can't handle for nullable
    // columns. So check first, update if it exists.
    const { data: existing } = await admin
      .from('incident_care_cases')
      .select('id')
      .eq('incident_id', incidentId)
      .eq('tenant_id', auth.gate.tenantId)
      .maybeSingle()

    if (existing) {
      const { data: updated, error } = await admin
        .from('incident_care_cases')
        .update({ ...insert, updated_by: auth.gate.userId })
        .eq('id', (existing as { id: string }).id)
        .select(CASE_COLS)
        .single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ case: updated }, { status: 200 })
    }

    const { data, error } = await admin
      .from('incident_care_cases')
      .insert(insert)
      .select(CASE_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'care/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ case: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'care/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH ─────────────────────────────────────────────────────────────────

const PATCHABLE: ReadonlyArray<keyof IncidentCareCasePatchInput> = [
  'case_status', 'initial_visit_at', 'treating_physician', 'clinic_name', 'diagnosis',
  'days_away_from_work', 'days_restricted', 'days_lost',
  'return_to_work_at', 'modified_duty_start', 'modified_duty_end', 'restrictions',
  'next_followup_at',
  'drug_test_status', 'drug_test_at', 'drug_test_notes',
  'case_manager_user_id',
]

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const auth = await loadAuthContext(req, incidentId)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })
  if (!auth.isPriv)
    return NextResponse.json({ error: 'Admin or investigator only' }, { status: 403 })

  let body: IncidentCareCasePatchInput
  try { body = (await req.json()) as IncidentCareCasePatchInput }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const keys = Object.keys(body) as Array<keyof IncidentCareCasePatchInput>
  if (keys.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  for (const k of keys) {
    if (!PATCHABLE.includes(k))
      return NextResponse.json({ error: `Unknown field: ${String(k)}` }, { status: 400 })
  }

  const validation = validateCareCasePatch(body)
  if (validation) return NextResponse.json({ error: validation }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('incident_care_cases')
      .select('id')
      .eq('incident_id', incidentId)
      .eq('tenant_id', auth.gate.tenantId)
      .maybeSingle()
    if (!existing)
      return NextResponse.json({ error: 'No care case exists yet — POST first' }, { status: 404 })

    const update: Record<string, unknown> = {
      ...body,
      updated_by: auth.gate.userId,
    }
    const { data, error } = await admin
      .from('incident_care_cases')
      .update(update)
      .eq('id', (existing as { id: string }).id)
      .eq('tenant_id', auth.gate.tenantId)
      .select(CASE_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'care/PATCH', stage: 'update' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ case: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'care/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Note: care visits live at ./visits/route.ts and re-derive the
// auth context inline rather than importing from this file
// (Next.js route handlers shouldn't export non-handler symbols).
