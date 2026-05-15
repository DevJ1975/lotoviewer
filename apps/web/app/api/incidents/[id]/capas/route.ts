import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  CAPA_HIERARCHY_LEVELS,
  type CapaHierarchyLevel,
} from '@soteria/core/incidentCapa'

// /api/incidents/[id]/capas
//
// GET   List CAPAs for this incident.
// POST  Create a new CAPA. Any tenant member can author; the
//       different-verifier rule is enforced by the DB trigger when
//       the row eventually transitions to verified.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT_COLS = [
  'id', 'tenant_id', 'incident_id', 'description', 'hierarchy_level',
  'assigned_to_user_id', 'due_at', 'completed_at', 'completed_by_user_id',
  'verified_effective_at', 'verified_by_user_id', 'verification_notes',
  'status', 'created_at', 'updated_at', 'created_by_user_id',
].join(', ')

interface RouteContext {
  params: Promise<{ id: string }>
}

interface PostBody {
  description?:         unknown
  hierarchy_level?:     unknown
  assigned_to_user_id?: unknown
  due_at?:              unknown
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('incident_capas')
      .select(SELECT_COLS)
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ capas: data ?? [] })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'capas/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const hierarchyLevel = typeof body.hierarchy_level === 'string' ? body.hierarchy_level : ''
  const assignedTo = typeof body.assigned_to_user_id === 'string' ? body.assigned_to_user_id : ''
  const dueAt = typeof body.due_at === 'string' && body.due_at ? body.due_at : null

  if (!description)
    return NextResponse.json({ error: 'description required' }, { status: 400 })
  if (!CAPA_HIERARCHY_LEVELS.includes(hierarchyLevel as CapaHierarchyLevel))
    return NextResponse.json({ error: `hierarchy_level must be one of ${CAPA_HIERARCHY_LEVELS.join(', ')}` }, { status: 400 })
  if (assignedTo && !UUID_RE.test(assignedTo))
    return NextResponse.json({ error: 'assigned_to_user_id must be a uuid' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    // Verify the incident exists and is scoped to the active tenant —
    // RLS would block the insert too, but a 404 message is friendlier
    // than the row-violation error.
    const { data: incident } = await admin
      .from('incidents')
      .select('id')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident)
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const insert = {
      tenant_id:           gate.tenantId,
      incident_id:         incidentId,
      description,
      hierarchy_level:     hierarchyLevel as CapaHierarchyLevel,
      assigned_to_user_id: assignedTo || null,
      due_at:              dueAt,
      created_by_user_id:  gate.userId,
      status:              'open' as const,
    }
    const { data, error } = await admin
      .from('incident_capas')
      .insert(insert)
      .select(SELECT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'capas/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ capa: data }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'capas/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
