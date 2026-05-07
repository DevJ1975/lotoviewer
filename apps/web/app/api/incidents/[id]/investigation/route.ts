import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  RCA_METHODS,
  type IncidentInvestigationCreateInput,
  type IncidentInvestigationPatchInput,
  type RcaMethod,
} from '@soteria/core/rcaSchemas'

// GET   /api/incidents/[id]/investigation   Read-or-null. Returns the
//                                           investigation row for this
//                                           incident, or 204 if none yet.
// POST  /api/incidents/[id]/investigation   Create the investigation row
//                                           (idempotent — UPSERT on the
//                                           incident_id unique key).
//                                           Admin only.
// PATCH /api/incidents/[id]/investigation   Update lifecycle / narrative
//                                           fields. Admin or assigned
//                                           investigator.
//
// Side-effects:
//   - On POST, also flips incidents.status to 'investigating' if it
//     was 'reported' or 'triaged' — keeps the lifecycle consistent
//     so the SLA cron stops escalating.
//   - On PATCH with completed_at set, requires that the RCA tree has
//     a root identified (canCompleteInvestigation check). The 1:1
//     incident_id key on incident_investigations means we never need
//     a separate "close investigation" endpoint.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string }>
}

const SELECT_COLS = [
  'id', 'tenant_id', 'incident_id',
  'rca_method', 'began_at', 'target_close_at', 'completed_at',
  'lead_investigator', 'team_member_ids',
  'scope_summary', 'sequence_of_events',
  'immediate_causes', 'underlying_causes', 'root_causes', 'lessons_learned',
  'signoff_by', 'signoff_at', 'signoff_typed_name',
  'publish_lesson', 'lesson_summary', 'lesson_published_at', 'lesson_published_by',
  'created_at', 'updated_at', 'created_by', 'updated_by',
].join(', ')

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('incident_investigations')
      .select(SELECT_COLS)
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return NextResponse.json({ investigation: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'investigation/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST — start an investigation ─────────────────────────────────────────

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: IncidentInvestigationCreateInput
  try { body = (await req.json()) as IncidentInvestigationCreateInput }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.rca_method && !(RCA_METHODS as readonly string[]).includes(body.rca_method))
    return NextResponse.json({ error: `Invalid rca_method: ${body.rca_method}` }, { status: 400 })

  if (body.lead_investigator && !UUID_RE.test(body.lead_investigator))
    return NextResponse.json({ error: 'lead_investigator must be a uuid' }, { status: 400 })

  if (body.team_member_ids) {
    if (!Array.isArray(body.team_member_ids))
      return NextResponse.json({ error: 'team_member_ids must be an array' }, { status: 400 })
    for (const uid of body.team_member_ids) {
      if (typeof uid !== 'string' || !UUID_RE.test(uid))
        return NextResponse.json({ error: `team_member_ids contains an invalid uuid: ${uid}` }, { status: 400 })
    }
  }

  try {
    const admin = supabaseAdmin()

    // Confirm tenant ownership of the incident.
    const { data: incident } = await admin
      .from('incidents')
      .select('id, tenant_id, status')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const insert = {
      tenant_id:         gate.tenantId,
      incident_id:       incidentId,
      rca_method:        (body.rca_method as RcaMethod) ?? 'none_yet',
      began_at:          new Date().toISOString(),
      target_close_at:   body.target_close_at ?? null,
      lead_investigator: body.lead_investigator ?? gate.userId,
      team_member_ids:   body.team_member_ids ?? [],
      scope_summary:     body.scope_summary?.trim() || null,
      created_by:        gate.userId,
      updated_by:        gate.userId,
    }

    // Idempotent: if an investigation already exists for this incident,
    // ON CONFLICT lets the caller treat POST as "ensure the row
    // exists" — the unique constraint on incident_id makes this safe.
    const { data, error } = await admin
      .from('incident_investigations')
      .upsert(insert, { onConflict: 'incident_id', ignoreDuplicates: false })
      .select(SELECT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'investigation/POST', stage: 'upsert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Side-effect: bump incident status to 'investigating' to silence
    // the SLA cron. We only do this for the early lifecycle states —
    // a closed-then-reopened incident keeps its existing status.
    if (incident.status === 'reported' || incident.status === 'triaged') {
      await admin
        .from('incidents')
        .update({ status: 'investigating', updated_by: gate.userId })
        .eq('id', incidentId)
        .eq('tenant_id', gate.tenantId)
    }

    return NextResponse.json({ investigation: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'investigation/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH — narrative + lifecycle updates ─────────────────────────────────

const PATCHABLE: ReadonlyArray<keyof IncidentInvestigationPatchInput> = [
  'rca_method', 'began_at', 'target_close_at', 'completed_at',
  'lead_investigator', 'team_member_ids',
  'scope_summary', 'sequence_of_events',
  'immediate_causes', 'underlying_causes', 'root_causes', 'lessons_learned',
  'signoff_typed_name',
  'publish_lesson', 'lesson_summary',
]

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: IncidentInvestigationPatchInput
  try { body = (await req.json()) as IncidentInvestigationPatchInput }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const keys = Object.keys(body) as Array<keyof IncidentInvestigationPatchInput>
  if (keys.length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  for (const k of keys) {
    if (!PATCHABLE.includes(k))
      return NextResponse.json({ error: `Unknown field: ${String(k)}` }, { status: 400 })
  }

  if (body.rca_method && !(RCA_METHODS as readonly string[]).includes(body.rca_method))
    return NextResponse.json({ error: `Invalid rca_method: ${body.rca_method}` }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    const { data: existing } = await admin
      .from('incident_investigations')
      .select('id, lead_investigator, team_member_ids, rca_method')
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!existing)
      return NextResponse.json({ error: 'Investigation not started — POST first' }, { status: 404 })

    // Member access tier: anyone on the lead/team list can edit, or
    // any tenant admin/owner. Plain members otherwise get 403.
    const isPriv =
      gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
      || existing.lead_investigator === gate.userId
      || (Array.isArray(existing.team_member_ids) && existing.team_member_ids.includes(gate.userId))
    if (!isPriv)
      return NextResponse.json({
        error: 'Only the lead investigator, team members, or a tenant admin can edit',
      }, { status: 403 })

    // Build the update payload.
    const update: Record<string, unknown> = {
      ...body,
      updated_by: gate.userId,
    }

    // Completing requires the RCA tree to have at least one node and
    // a root. We delegate to a count() against the chosen method's
    // table rather than ship the full canCompleteInvestigation check
    // here — the table choice is method-specific.
    if (body.completed_at) {
      const method = (body.rca_method ?? existing.rca_method) as RcaMethod
      const tableByMethod: Record<RcaMethod, string | null> = {
        '5_whys':   'incident_rca_5whys',
        fishbone:   'incident_rca_fishbone',
        taproot:    'incident_rca_taproot_factors',
        icam:       'incident_rca_icam_factors',
        none_yet:   null,
      }
      const tbl = tableByMethod[method]
      if (!tbl) {
        return NextResponse.json({ error: 'Pick an RCA method before completing' }, { status: 400 })
      }
      const { count: nodeCount } = await admin
        .from(tbl)
        .select('id', { count: 'exact', head: true })
        .eq('investigation_id', existing.id)
      const { count: rootCount } = await admin
        .from(tbl)
        .select('id', { count: 'exact', head: true })
        .eq('investigation_id', existing.id)
        .eq('is_root', true)
      if (!nodeCount || nodeCount === 0)
        return NextResponse.json({ error: 'Add at least one RCA node before completing' }, { status: 400 })
      if (!rootCount || rootCount === 0)
        return NextResponse.json({ error: 'Mark one RCA node as the identified root before completing' }, { status: 400 })
    }

    // Signoff timestamp + signer when the user types a name.
    if (body.signoff_typed_name && body.signoff_typed_name.trim()) {
      update.signoff_at = new Date().toISOString()
      update.signoff_by = gate.userId
    }

    // Lessons-learned publish flow: when publish_lesson flips to
    // true with a non-empty summary, stamp the published_at +
    // published_by audit columns. Flipping it back to false clears
    // them — the lesson row drops out of the library next refresh.
    if (body.publish_lesson === true) {
      const summary = body.lesson_summary ?? null
      if (!summary || !summary.trim()) {
        return NextResponse.json({
          error: 'lesson_summary is required when publishing a lesson',
        }, { status: 400 })
      }
      update.lesson_published_at = new Date().toISOString()
      update.lesson_published_by = gate.userId
    } else if (body.publish_lesson === false) {
      update.lesson_published_at = null
      update.lesson_published_by = null
    }

    const { data, error } = await admin
      .from('incident_investigations')
      .update(update)
      .eq('id', existing.id)
      .eq('tenant_id', gate.tenantId)
      .select(SELECT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'investigation/PATCH', stage: 'update' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // If the user just completed the investigation, push the parent
    // incident into pending_review so the close-out path can begin.
    if (body.completed_at) {
      await admin
        .from('incidents')
        .update({ status: 'pending_review', updated_by: gate.userId })
        .eq('id', incidentId)
        .eq('tenant_id', gate.tenantId)
    }

    return NextResponse.json({ investigation: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'investigation/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
