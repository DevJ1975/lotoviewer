import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  INCIDENT_PERSON_ROLES,
  INCIDENT_EMPLOYMENT_TYPES,
  type IncidentPersonCreateInput,
  type IncidentPersonRole,
  type IncidentEmploymentType,
} from '@soteria/core/incident'

// GET  /api/incidents/[id]/people  List people on an incident.
//                                  Reads from incident_people_safe so PII
//                                  columns redact for non-admin/non-investigator.
// POST /api/incidents/[id]/people  Add a person row (witness, supervisor, etc.).
//                                  Members can add witnesses + reporters;
//                                  PII fields (DOB / address / gender) are
//                                  silently dropped if the caller can't
//                                  view PII on the incident.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string }>
}

const SAFE_SELECT_COLS = [
  'id', 'tenant_id', 'incident_id',
  'person_role', 'user_id', 'full_name', 'email', 'phone',
  'employment_type', 'job_title', 'hire_date',
  'date_of_birth', 'gender', 'home_address',
  'body_part', 'injury_nature', 'injury_source', 'treatment_facility',
  'is_primary',
  'created_at', 'updated_at',
].join(', ')

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    // Read from the safe view — PII columns are NULL for callers who
    // don't pass can_view_incident_pii() in the DB function.
    const { data, error } = await gate.authedClient
      .from('incident_people_safe')
      .select(SAFE_SELECT_COLS)
      .eq('incident_id', id)
      .eq('tenant_id', gate.tenantId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ people: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'incidents/[id]/people/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Partial<IncidentPersonCreateInput>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.person_role || !(INCIDENT_PERSON_ROLES as readonly string[]).includes(body.person_role))
    return NextResponse.json({ error: 'Invalid or missing person_role' }, { status: 400 })

  if (body.employment_type
      && !(INCIDENT_EMPLOYMENT_TYPES as readonly string[]).includes(body.employment_type))
    return NextResponse.json({ error: `Invalid employment_type: ${body.employment_type}` }, { status: 400 })

  if (body.user_id && !UUID_RE.test(body.user_id))
    return NextResponse.json({ error: 'user_id must be a uuid' }, { status: 400 })

  // Either user_id or full_name must be provided (otherwise we have a
  // ghost row with no human attached).
  if (!body.user_id && !(body.full_name && body.full_name.trim())) {
    return NextResponse.json({ error: 'Either user_id or full_name is required' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()

    // Confirm the incident exists in this tenant before insert — RLS
    // would block the insert anyway via the FK, but a clean 404 here
    // beats a confusing 500.
    const { data: incident } = await admin
      .from('incidents')
      .select('id, tenant_id, assigned_investigator')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    // PII gate: only admins/owners or the assigned investigator can
    // attach DOB, gender, or home_address. Members trying to set these
    // get them silently dropped — better UX than rejecting the whole
    // create when the form may have auto-populated empty fields.
    const canSetPii = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
                   || incident.assigned_investigator === gate.userId

    const insert: Record<string, unknown> = {
      tenant_id:       gate.tenantId,
      incident_id:     incidentId,
      person_role:     body.person_role as IncidentPersonRole,
      user_id:         body.user_id ?? null,
      full_name:       body.full_name?.trim() || null,
      email:           body.email?.trim() || null,
      phone:           body.phone?.trim() || null,
      employment_type: (body.employment_type as IncidentEmploymentType) ?? null,
      job_title:       body.job_title?.trim() || null,
      hire_date:       body.hire_date || null,
      body_part:       Array.isArray(body.body_part) ? body.body_part : null,
      injury_nature:   body.injury_nature?.trim() || null,
      injury_source:   body.injury_source?.trim() || null,
      treatment_facility: body.treatment_facility?.trim() || null,
      is_primary:      !!body.is_primary,
    }
    if (canSetPii) {
      insert.date_of_birth = body.date_of_birth || null
      insert.gender        = body.gender || null
      insert.home_address  = body.home_address?.trim() || null
    }

    const { data, error } = await admin
      .from('incident_people')
      .insert(insert)
      .select(SAFE_SELECT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'incidents/[id]/people/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ person: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'incidents/[id]/people/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
