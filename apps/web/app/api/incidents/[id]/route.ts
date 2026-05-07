import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  INCIDENT_STATUSES,
  INCIDENT_SEVERITY_ACTUAL,
  INCIDENT_SEVERITY_POTENTIAL,
  INCIDENT_PROBABILITY,
  type IncidentStatus,
  type IncidentSeverityActual,
  type IncidentSeverityPotential,
  type IncidentProbability,
} from '@soteria/core/incident'

// GET    /api/incidents/[id]   Fetch one (any tenant member).
// PATCH  /api/incidents/[id]   Update status / severity / assignment.
//                              Member can patch description & immediate
//                              action; admin required for status,
//                              severity, assignment, classification.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT_COLS = [
  'id', 'tenant_id', 'report_number', 'incident_type',
  'occurred_at', 'reported_at', 'reported_by', 'is_anonymous',
  'location_text', 'location_geo', 'shift', 'description', 'immediate_action_taken',
  'severity_actual', 'severity_potential', 'probability', 'classification_matrix_cell',
  'status', 'assigned_investigator',
  'related_loto_permit_id', 'related_hot_work_permit_id',
  'related_confined_space_permit_id', 'related_jha_id',
  'workers_comp_claim_number',
  'spill_substance', 'spill_quantity', 'spill_quantity_unit',
  'legacy_near_miss_id',
  'closed_at', 'closed_by',
  'created_at', 'updated_at', 'updated_by',
].join(', ')

interface RouteContext {
  params: Promise<{ id: string }>
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('incidents')
      .select(SELECT_COLS)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ report: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'incidents/[id]/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH ─────────────────────────────────────────────────────────────────

interface PatchBody {
  description?:               string
  immediate_action_taken?:    string | null
  status?:                    IncidentStatus
  severity_actual?:           IncidentSeverityActual
  severity_potential?:        IncidentSeverityPotential | null
  probability?:               IncidentProbability | null
  classification_matrix_cell?: string | null
  assigned_investigator?:     string | null
  workers_comp_claim_number?: string | null
}

// Fields any tenant member can update — corrections to their own
// intake (typo in description, missed an immediate action). Mutations
// to triage state require admin.
const MEMBER_FIELDS: ReadonlyArray<keyof PatchBody> = [
  'description', 'immediate_action_taken',
]
const ADMIN_FIELDS: ReadonlyArray<keyof PatchBody> = [
  'status', 'severity_actual', 'severity_potential', 'probability',
  'classification_matrix_cell', 'assigned_investigator',
  'workers_comp_claim_number',
]

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: PatchBody
  try { body = (await req.json()) as PatchBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const requestedFields = Object.keys(body) as Array<keyof PatchBody>
  if (requestedFields.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }
  // Reject unknown keys to keep the surface tight.
  for (const k of requestedFields) {
    if (!MEMBER_FIELDS.includes(k) && !ADMIN_FIELDS.includes(k)) {
      return NextResponse.json({ error: `Unknown field: ${k}` }, { status: 400 })
    }
  }
  const needsAdmin = requestedFields.some(k => ADMIN_FIELDS.includes(k))
  const gate = needsAdmin
    ? await requireTenantAdmin(req)
    : await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  // Validate enum values early — DB CHECK constraint is the authority
  // but we want a 400 with a helpful message instead of a 500.
  if (body.status && !(INCIDENT_STATUSES as readonly string[]).includes(body.status))
    return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 })
  if (body.severity_actual && !(INCIDENT_SEVERITY_ACTUAL as readonly string[]).includes(body.severity_actual))
    return NextResponse.json({ error: `Invalid severity_actual: ${body.severity_actual}` }, { status: 400 })
  if (body.severity_potential && !(INCIDENT_SEVERITY_POTENTIAL as readonly string[]).includes(body.severity_potential))
    return NextResponse.json({ error: `Invalid severity_potential: ${body.severity_potential}` }, { status: 400 })
  if (body.probability && !(INCIDENT_PROBABILITY as readonly string[]).includes(body.probability))
    return NextResponse.json({ error: `Invalid probability: ${body.probability}` }, { status: 400 })

  if (body.assigned_investigator != null && body.assigned_investigator !== ''
      && !UUID_RE.test(body.assigned_investigator))
    return NextResponse.json({ error: 'assigned_investigator must be a uuid' }, { status: 400 })

  // Build the partial update. Closing transition writes closed_at +
  // closed_by together — DB CHECK enforces both-or-neither.
  const update: Record<string, unknown> = {
    ...body,
    updated_by: gate.userId,
  }
  if (body.status === 'closed') {
    update.closed_at = new Date().toISOString()
    update.closed_by = gate.userId
  } else if (body.status) {
    // Re-opening or other transition — clear the close fields.
    update.closed_at = null
    update.closed_by = null
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('incidents')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select(SELECT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'incidents/[id]/PATCH', stage: 'update' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ report: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'incidents/[id]/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
