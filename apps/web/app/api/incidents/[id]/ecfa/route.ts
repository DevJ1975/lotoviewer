import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { validateEcfaNode, type EcfaNodeInput } from '@soteria/core/ecfaSchemas'

// GET    /api/incidents/[id]/ecfa   Fetch every ECFA node for the
//                                   incident's investigation, ordered along
//                                   the primary sequence.
// POST   /api/incidents/[id]/ecfa   Append one node. Body: { node: {...} }.
// PATCH  /api/incidents/[id]/ecfa   Edit one node. Body: { nodeId, patch }.
// DELETE /api/incidents/[id]/ecfa?nodeId=
//                                   Remove one node (conditions cascade with
//                                   their event via parent_event_id).
//
// Auth: any tenant member on the investigation team OR an admin — ECFA is
// collaborative, mirroring the RCA route. Reads use the RLS-scoped authed
// client; writes use the service-role client after an explicit team check.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TABLE = 'incident_ecfa_nodes'

// Fields a PATCH may touch. tenant_id / investigation_id / node_type /
// ai_origin are intentionally immutable after insert.
const ALLOWED_PATCH_FIELDS = [
  'title', 'description', 'sequence_index', 'parent_event_id', 'lane',
  'occurred_at', 'verification_status', 'is_causal_factor',
  'cf_category', 'failed_barrier', 'cf_hierarchy_control', 'ai_edited',
] as const

interface RouteContext {
  params: Promise<{ id: string }>
}

// Resolves the incident's investigation + the caller's team privilege in
// one place (POST/PATCH/DELETE all need it). Returns the investigation id
// or an error response.
async function resolveInvestigation(
  admin: ReturnType<typeof supabaseAdmin>,
  incidentId: string,
  gate: { tenantId: string; userId: string; role: string },
): Promise<{ ok: true; investigationId: string } | { ok: false; res: NextResponse }> {
  const { data: inv } = await admin
    .from('incident_investigations')
    .select('id, lead_investigator, team_member_ids')
    .eq('incident_id', incidentId)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (!inv)
    return { ok: false, res: NextResponse.json({ error: 'Investigation not started' }, { status: 404 }) }

  const isPriv =
    gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
    || inv.lead_investigator === gate.userId
    || (Array.isArray(inv.team_member_ids) && inv.team_member_ids.includes(gate.userId))
  if (!isPriv)
    return { ok: false, res: NextResponse.json({ error: 'Only the investigation team can edit the ECFA chart' }, { status: 403 }) }

  return { ok: true, investigationId: inv.id as string }
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data: inv } = await gate.authedClient
      .from('incident_investigations')
      .select('id')
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!inv) return NextResponse.json({ investigation_id: null, nodes: [] })

    const { data, error } = await gate.authedClient
      .from(TABLE)
      .select('*')
      .eq('investigation_id', inv.id)
      .order('sequence_index', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)

    return NextResponse.json({ investigation_id: inv.id, nodes: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'ecfa/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST — append one node ───────────────────────────────────────────────

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { node?: Partial<EcfaNodeInput> }
  try { body = (await req.json()) as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const node = body.node ?? {}
  const validation = validateEcfaNode(node)
  if (validation) return NextResponse.json({ error: validation }, { status: 400 })
  if (node.parent_event_id && !UUID_RE.test(node.parent_event_id))
    return NextResponse.json({ error: 'parent_event_id must be a uuid' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const resolved = await resolveInvestigation(admin, incidentId, gate)
    if (!resolved.ok) return resolved.res

    // Spread the client node, then scope tenant + investigation LAST so
    // callers can't override them.
    const insert = {
      ...node,
      tenant_id:        gate.tenantId,
      investigation_id: resolved.investigationId,
      created_by:       gate.userId,
    } as Record<string, unknown>

    const { data, error } = await admin.from(TABLE).insert(insert).select('*').single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'ecfa/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ node: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'ecfa/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH — edit one node in place ───────────────────────────────────────

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { nodeId?: string; patch?: Record<string, unknown> }
  try { body = (await req.json()) as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!UUID_RE.test(body.nodeId ?? '')) return NextResponse.json({ error: 'nodeId is required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body.patch ?? {})) {
    if (!(ALLOWED_PATCH_FIELDS as readonly string[]).includes(k))
      return NextResponse.json({ error: `Field not patchable: ${k}` }, { status: 400 })
    patch[k] = v
  }
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  if ('title' in patch && (typeof patch.title !== 'string' || !patch.title.trim()))
    return NextResponse.json({ error: 'title must be a non-empty string' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const resolved = await resolveInvestigation(admin, incidentId, gate)
    if (!resolved.ok) return resolved.res

    const { data, error } = await admin
      .from(TABLE)
      .update(patch)
      .eq('id', body.nodeId)
      .eq('investigation_id', resolved.investigationId)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'ecfa/PATCH', stage: 'update' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ node: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'ecfa/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── DELETE — remove one node ─────────────────────────────────────────────

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const url = new URL(req.url)
  const nodeId = url.searchParams.get('nodeId') ?? ''
  if (!UUID_RE.test(nodeId))
    return NextResponse.json({ error: 'nodeId query param is required' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const resolved = await resolveInvestigation(admin, incidentId, gate)
    if (!resolved.ok) return resolved.res

    const { error } = await admin
      .from(TABLE)
      .delete()
      .eq('id', nodeId)
      .eq('investigation_id', resolved.investigationId)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'ecfa/DELETE', stage: 'delete' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'ecfa/DELETE' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
