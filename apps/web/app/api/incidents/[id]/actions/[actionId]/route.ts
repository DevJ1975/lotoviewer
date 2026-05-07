import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  INCIDENT_ACTION_STATUSES,
  HIERARCHY_OF_CONTROLS,
  canTransition,
  type IncidentActionPatchInput,
  type IncidentActionStatus,
  type IncidentActionRow,
} from '@soteria/core/incidentAction'

// PATCH  /api/incidents/[id]/actions/[actionId]
//   - Owner can move status forward and update verification evidence
//   - Tenant admin/owner can do anything
//   - Verification (status='verified') requires a different verifier
//     than the closer (separation-of-duty)
//
// DELETE /api/incidents/[id]/actions/[actionId]   Admin only.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT_COLS = [
  'id', 'tenant_id', 'incident_id',
  'action_type', 'hierarchy_of_controls',
  'description', 'owner_user_id', 'due_at',
  'status', 'completed_at', 'verified_at', 'verified_by',
  'verification_evidence', 'source_rca_node_id', 'cancel_reason',
  'created_at', 'updated_at', 'created_by', 'updated_by',
].join(', ')

const PATCHABLE: ReadonlyArray<keyof IncidentActionPatchInput> = [
  'description', 'hierarchy_of_controls', 'owner_user_id', 'due_at',
  'status', 'verification_evidence', 'cancel_reason',
]

interface RouteContext {
  params: Promise<{ id: string; actionId: string }>
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id: incidentId, actionId } = await ctx.params
  if (!UUID_RE.test(incidentId) || !UUID_RE.test(actionId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: IncidentActionPatchInput
  try { body = (await req.json()) as IncidentActionPatchInput }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const keys = Object.keys(body) as Array<keyof IncidentActionPatchInput>
  if (keys.length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  for (const k of keys) {
    if (!PATCHABLE.includes(k))
      return NextResponse.json({ error: `Unknown field: ${String(k)}` }, { status: 400 })
  }

  if (body.status && !(INCIDENT_ACTION_STATUSES as readonly string[]).includes(body.status))
    return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 })
  if (body.hierarchy_of_controls
      && !(HIERARCHY_OF_CONTROLS as readonly string[]).includes(body.hierarchy_of_controls))
    return NextResponse.json({ error: `Invalid hierarchy_of_controls: ${body.hierarchy_of_controls}` }, { status: 400 })
  if (body.owner_user_id && body.owner_user_id !== '' && !UUID_RE.test(body.owner_user_id))
    return NextResponse.json({ error: 'owner_user_id must be a uuid' }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    const { data: existing } = await admin
      .from('incident_actions')
      .select(SELECT_COLS)
      .eq('id', actionId)
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Action not found' }, { status: 404 })
    const cur = existing as unknown as IncidentActionRow

    // Authorization: owner can move status forward + add evidence;
    // admin/owner can do anything else (including reassign, change
    // type, edit description after the fact).
    const isPriv =
      gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
    const isOwner = cur.owner_user_id === gate.userId
    if (!isPriv && !isOwner)
      return NextResponse.json({
        error: 'Only the action owner or a tenant admin can edit',
      }, { status: 403 })

    // If a non-admin owner is patching, restrict the field set: they
    // can only move status forward and add verification evidence /
    // cancel_reason. They can't reassign or change type / due_at.
    if (!isPriv) {
      const ownerAllowed = ['status', 'verification_evidence', 'cancel_reason'] as const
      for (const k of keys) {
        if (!(ownerAllowed as readonly string[]).includes(k))
          return NextResponse.json({
            error: `Only an admin can change ${String(k)} — owners may move status / add evidence / set cancel_reason`,
          }, { status: 403 })
      }
    }

    // Status transition gate.
    if (body.status && !canTransition(cur.status, body.status)) {
      return NextResponse.json({
        error: `Cannot transition from ${cur.status} to ${body.status}`,
      }, { status: 400 })
    }

    // Separation-of-duty: a 'verified' transition requires a verifier
    // who didn't close the action. The closer is whoever owned/
    // updated_by the action when it crossed into 'complete'. Phase 1
    // approximation: verified_by must be different from the
    // owner_user_id and from updated_by on the existing row.
    if (body.status === 'verified') {
      if (cur.owner_user_id === gate.userId) {
        return NextResponse.json({
          error: 'Verifier must be a different user than the action owner (separation of duty).',
        }, { status: 403 })
      }
    }

    const update: Record<string, unknown> = {
      ...body,
      updated_by: gate.userId,
    }

    // Lifecycle stamps. The DB CHECK constraints enforce these too;
    // we set them explicitly so the row is internally consistent
    // before the constraint fires.
    const nextStatus = (body.status ?? cur.status) as IncidentActionStatus
    if (nextStatus === 'complete') {
      if (!cur.completed_at) update.completed_at = new Date().toISOString()
      // verified fields stay null; will be filled when a different
      // user transitions to 'verified'.
    } else if (nextStatus === 'verified') {
      if (!cur.completed_at) update.completed_at = new Date().toISOString()
      update.verified_at = new Date().toISOString()
      update.verified_by = gate.userId
    } else if (nextStatus === 'in_progress' || nextStatus === 'open' || nextStatus === 'blocked') {
      // Reopening — clear completion stamps so the row honours the
      // CHECK constraint.
      if (cur.completed_at) update.completed_at = null
      if (cur.verified_at)  update.verified_at  = null
      if (cur.verified_by)  update.verified_by  = null
    }

    const { data, error } = await admin
      .from('incident_actions')
      .update(update)
      .eq('id', actionId)
      .eq('tenant_id', gate.tenantId)
      .select(SELECT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'actions/[id]/PATCH', stage: 'update' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ action: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'actions/[id]/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id: incidentId, actionId } = await ctx.params
  if (!UUID_RE.test(incidentId) || !UUID_RE.test(actionId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { error } = await admin
      .from('incident_actions')
      .delete()
      .eq('id', actionId)
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'actions/[id]/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'actions/[id]/DELETE' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
