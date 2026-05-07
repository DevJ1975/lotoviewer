import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  validateFiveWhys,
  validateFishbone,
  validateTaproot,
  validateIcam,
  type RcaMethod,
  type FiveWhysNodeInput,
  type FishboneNodeInput,
  type TaprootFactorInput,
  type IcamFactorInput,
} from '@soteria/core/rcaSchemas'

// GET    /api/incidents/[id]/rca       Fetch every RCA node for the
//                                      incident's investigation, grouped
//                                      by method-specific table. The
//                                      response carries all four method
//                                      payloads even though only one is
//                                      typically populated — keeps the
//                                      client simple.
// POST   /api/incidents/[id]/rca       Append one node. Body:
//                                        { method: '5_whys'|'fishbone'|...,
//                                          node: { ...method-specific... } }
// DELETE /api/incidents/[id]/rca?nodeId=&method=
//                                      Remove a single node (cascade is
//                                      already wired for taproot's tree).
//
// Auth: any tenant member who is on the investigation team OR an admin.
// We don't gate by lead-investigator alone — RCA is collaborative.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TABLE_BY_METHOD: Record<RcaMethod, string | null> = {
  '5_whys':   'incident_rca_5whys',
  fishbone:   'incident_rca_fishbone',
  taproot:    'incident_rca_taproot_factors',
  icam:       'incident_rca_icam_factors',
  none_yet:   null,
}

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
    const { data: inv } = await gate.authedClient
      .from('incident_investigations')
      .select('id')
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!inv) {
      return NextResponse.json({
        five_whys: [], fishbone: [], taproot: [], icam: [],
      })
    }

    // Fetch all four methods in parallel — the rows are small, the
    // client can switch between methods without re-fetching.
    const [fw, fb, tr, ic] = await Promise.all([
      gate.authedClient.from('incident_rca_5whys')
        .select('*').eq('investigation_id', inv.id).order('ordinal'),
      gate.authedClient.from('incident_rca_fishbone')
        .select('*').eq('investigation_id', inv.id).order('category').order('ordinal'),
      gate.authedClient.from('incident_rca_taproot_factors')
        .select('*').eq('investigation_id', inv.id).order('ordinal'),
      gate.authedClient.from('incident_rca_icam_factors')
        .select('*').eq('investigation_id', inv.id).order('layer').order('ordinal'),
    ])

    return NextResponse.json({
      investigation_id: inv.id,
      five_whys: fw.data ?? [],
      fishbone:  fb.data ?? [],
      taproot:   tr.data ?? [],
      icam:      ic.data ?? [],
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'rca/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST — append one node ───────────────────────────────────────────────

interface PostBody {
  method: RcaMethod
  node:   Partial<FiveWhysNodeInput | FishboneNodeInput | TaprootFactorInput | IcamFactorInput>
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = (await req.json()) as PostBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const tbl = TABLE_BY_METHOD[body.method]
  if (!tbl) return NextResponse.json({ error: `Invalid or unsupported method: ${body.method}` }, { status: 400 })

  // Method-specific validation.
  let validation: string | null = null
  switch (body.method) {
    case '5_whys':   validation = validateFiveWhys(body.node as Partial<FiveWhysNodeInput>); break
    case 'fishbone': validation = validateFishbone(body.node as Partial<FishboneNodeInput>); break
    case 'taproot':  validation = validateTaproot(body.node as Partial<TaprootFactorInput>); break
    case 'icam':     validation = validateIcam(body.node as Partial<IcamFactorInput>); break
  }
  if (validation) return NextResponse.json({ error: validation }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    const { data: inv } = await admin
      .from('incident_investigations')
      .select('id, lead_investigator, team_member_ids')
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!inv)
      return NextResponse.json({ error: 'Investigation not started' }, { status: 404 })

    const isPriv =
      gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
      || inv.lead_investigator === gate.userId
      || (Array.isArray(inv.team_member_ids) && inv.team_member_ids.includes(gate.userId))
    if (!isPriv)
      return NextResponse.json({ error: 'Only the investigation team can add RCA nodes' }, { status: 403 })

    // Build the insert with method-specific shape. Spread + tenant
    // scope last so callers can't override.
    const insert = {
      ...body.node,
      tenant_id:        gate.tenantId,
      investigation_id: inv.id,
    } as Record<string, unknown>

    // Single-root invariant: when the caller marks a node is_root,
    // clear is_root on every other node for this investigation in
    // the same table. Phase 2 supports a single identified root
    // per RCA — multi-root analyses are a future enhancement.
    if (insert.is_root === true) {
      await admin
        .from(tbl)
        .update({ is_root: false })
        .eq('investigation_id', inv.id)
        .eq('is_root', true)
    }

    const { data, error } = await admin
      .from(tbl)
      .insert(insert)
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'rca/POST', stage: 'insert', method: body.method } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ node: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'rca/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── DELETE — remove one node ─────────────────────────────────────────────

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const url = new URL(req.url)
  const nodeId = url.searchParams.get('nodeId') ?? ''
  const method = url.searchParams.get('method') ?? ''
  if (!UUID_RE.test(nodeId))
    return NextResponse.json({ error: 'nodeId query param is required' }, { status: 400 })
  const tbl = TABLE_BY_METHOD[method as RcaMethod]
  if (!tbl)
    return NextResponse.json({ error: `Invalid method: ${method}` }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: inv } = await admin
      .from('incident_investigations')
      .select('id, lead_investigator, team_member_ids')
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!inv) return NextResponse.json({ error: 'Investigation not found' }, { status: 404 })

    const isPriv =
      gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
      || inv.lead_investigator === gate.userId
      || (Array.isArray(inv.team_member_ids) && inv.team_member_ids.includes(gate.userId))
    if (!isPriv)
      return NextResponse.json({ error: 'Only the investigation team can delete RCA nodes' }, { status: 403 })

    const { error } = await admin
      .from(tbl)
      .delete()
      .eq('id', nodeId)
      .eq('investigation_id', inv.id)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'rca/DELETE', stage: 'delete' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'rca/DELETE' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
