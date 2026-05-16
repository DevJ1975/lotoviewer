import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  PROP65_EXPOSURE_ROUTES,
  type Prop65ExposureRoute,
} from '@soteria/core/prop65'

// POST /api/prop65/assessments — admin creates an exposure assessment.
// Sign-off lives on PATCH /api/prop65/assessments/[id].

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT_COLS = [
  'id', 'tenant_id', 'site_id', 'chemical_inventory_id',
  'assessed_at', 'exposure_route', 'estimated_daily_intake_mg',
  'below_safe_harbor', 'assessor_user_id', 'methodology_notes',
  'signed', 'signed_name', 'signed_at',
  'created_at', 'updated_at',
].join(', ')

interface PostBody {
  site_id?:                   unknown
  chemical_inventory_id?:     unknown
  assessed_at?:               unknown
  exposure_route?:            unknown
  estimated_daily_intake_mg?: unknown
  below_safe_harbor?:         unknown
  methodology_notes?:         unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const siteId  = typeof body.site_id === 'string' ? body.site_id : ''
  const chemId  = typeof body.chemical_inventory_id === 'string' ? body.chemical_inventory_id : ''
  const route   = typeof body.exposure_route === 'string' ? body.exposure_route : ''
  const intake  = typeof body.estimated_daily_intake_mg === 'number' ? body.estimated_daily_intake_mg : null
  const belowSh = typeof body.below_safe_harbor === 'boolean' ? body.below_safe_harbor : null
  const notes   = typeof body.methodology_notes === 'string' ? body.methodology_notes : null
  const assessedAt = typeof body.assessed_at === 'string' && body.assessed_at ? body.assessed_at : null

  if (!UUID_RE.test(siteId))
    return NextResponse.json({ error: 'site_id must be a uuid' }, { status: 400 })
  if (!UUID_RE.test(chemId))
    return NextResponse.json({ error: 'chemical_inventory_id must be a uuid' }, { status: 400 })
  if (!PROP65_EXPOSURE_ROUTES.includes(route as Prop65ExposureRoute))
    return NextResponse.json({ error: `exposure_route must be one of ${PROP65_EXPOSURE_ROUTES.join(', ')}` }, { status: 400 })
  if (intake !== null && (!Number.isFinite(intake) || intake < 0))
    return NextResponse.json({ error: 'estimated_daily_intake_mg must be a non-negative number' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    // Confirm the site belongs to the active tenant (RLS would catch
    // it anyway, but a 404 is friendlier).
    const { data: site } = await admin
      .from('prop65_sites')
      .select('id')
      .eq('id', siteId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const insert = {
      tenant_id:                 gate.tenantId,
      site_id:                   siteId,
      chemical_inventory_id:     chemId,
      assessed_at:               assessedAt,
      exposure_route:            route,
      estimated_daily_intake_mg: intake,
      below_safe_harbor:         belowSh,
      assessor_user_id:          gate.userId,
      methodology_notes:         notes,
    }
    const { data, error } = await admin
      .from('prop65_exposure_assessments')
      .insert(insert)
      .select(SELECT_COLS)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ assessment: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
