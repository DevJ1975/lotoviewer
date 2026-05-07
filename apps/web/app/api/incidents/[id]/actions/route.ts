import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { computeLoginUrl } from '@/lib/email/sendInvite'
import { sendActionAssignmentEmail } from '@/lib/email/sendActionAssignment'
import {
  validateActionCreate,
  type IncidentActionCreateInput,
  type IncidentActionType,
  type HierarchyOfControls,
} from '@soteria/core/incidentAction'

// GET   /api/incidents/[id]/actions   List CAPAs on this incident.
// POST  /api/incidents/[id]/actions   Add a CAPA. Any team member /
//                                     admin can create — owners can be
//                                     anyone in the tenant.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT_COLS = [
  'id', 'tenant_id', 'incident_id',
  'action_type', 'hierarchy_of_controls',
  'description', 'owner_user_id', 'due_at',
  'status', 'completed_at', 'verified_at', 'verified_by',
  'verification_evidence', 'source_rca_node_id', 'cancel_reason',
  'created_at', 'updated_at', 'created_by', 'updated_by',
].join(', ')

interface RouteContext {
  params: Promise<{ id: string }>
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('incident_actions')
      .select(SELECT_COLS)
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ actions: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'actions/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Partial<IncidentActionCreateInput>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const validation = validateActionCreate(body)
  if (validation) return NextResponse.json({ error: validation }, { status: 400 })

  if (body.owner_user_id && !UUID_RE.test(body.owner_user_id))
    return NextResponse.json({ error: 'owner_user_id must be a uuid' }, { status: 400 })
  if (body.source_rca_node_id && !UUID_RE.test(body.source_rca_node_id))
    return NextResponse.json({ error: 'source_rca_node_id must be a uuid' }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    const { data: incident } = await admin
      .from('incidents')
      .select('id, tenant_id, report_number')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const insert = {
      tenant_id:             gate.tenantId,
      incident_id:           incidentId,
      action_type:           body.action_type as IncidentActionType,
      hierarchy_of_controls: (body.hierarchy_of_controls as HierarchyOfControls | null) ?? null,
      description:           body.description!.trim(),
      owner_user_id:         body.owner_user_id ?? null,
      due_at:                body.due_at ?? null,
      source_rca_node_id:    body.source_rca_node_id ?? null,
      created_by:            gate.userId,
      updated_by:            gate.userId,
    }

    const { data, error } = await admin
      .from('incident_actions')
      .insert(insert)
      .select(SELECT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'actions/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Best-effort assignment email to the owner. Failures don't
    // block the 201 response.
    if (insert.owner_user_id) {
      try {
        const { data: owner } = await admin
          .from('profiles')
          .select('email, full_name')
          .eq('id', insert.owner_user_id)
          .maybeSingle()
        const { data: tenant } = await admin
          .from('tenants')
          .select('name')
          .eq('id', gate.tenantId)
          .maybeSingle()
        if (owner?.email) {
          await sendActionAssignmentEmail({
            to:             owner.email,
            recipientName:  owner.full_name ?? null,
            reportNumber:   incident.report_number,
            incidentId:     incidentId,
            actionId:       (data as unknown as { id: string }).id,
            description:    insert.description,
            actionType:     insert.action_type,
            hierarchy:      insert.hierarchy_of_controls,
            dueAt:          insert.due_at,
            appUrl:         computeLoginUrl(req),
            tenantName:     tenant?.name ?? null,
            tenantId:       gate.tenantId,
            triggeredBy:    gate.userId,
          })
        }
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'actions/POST', stage: 'notify' } })
      }
    }

    return NextResponse.json({ action: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'actions/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
