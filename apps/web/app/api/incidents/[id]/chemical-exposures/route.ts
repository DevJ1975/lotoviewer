import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  validateExposureInput,
  EXPOSURE_ROUTES,
  EXPOSURE_SEVERITIES,
  type ExposureEventInput,
  type ExposureRoute,
  type ExposureSeverity,
} from '@soteria/core/chemicals'

// GET  /api/incidents/[id]/chemical-exposures   → list for the incident
// POST /api/incidents/[id]/chemical-exposures   → add a new exposure event

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid incident id' }, { status: 400 })

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_exposure_events')
      .select(`
        id, incident_id, product_id, inventory_item_id, person_id,
        route, estimated_quantity, exposure_duration_minutes,
        severity, ppe_in_use, measured_ppm, notes,
        created_at, created_by,
        chemical_products ( id, name, manufacturer, ghs_signal_word, ghs_pictograms,
                            pel_twa_ppm, stel_ppm, idlh_ppm )
      `)
      .eq('tenant_id', gate.tenantId)
      .eq('incident_id', id)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ events: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid incident id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const routeRaw = typeof body.route === 'string' ? body.route : ''
  const route: ExposureRoute = (EXPOSURE_ROUTES as readonly string[]).includes(routeRaw)
    ? (routeRaw as ExposureRoute) : 'unknown'

  const severityRaw = typeof body.severity === 'string' ? body.severity : null
  const severity: ExposureSeverity | null = severityRaw
    && (EXPOSURE_SEVERITIES as readonly string[]).includes(severityRaw)
      ? (severityRaw as ExposureSeverity) : null

  const ppe = Array.isArray(body.ppe_in_use)
    ? body.ppe_in_use.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : []

  const input: ExposureEventInput = {
    incident_id:                incidentId,
    product_id:                 typeof body.product_id === 'string' ? body.product_id : '',
    inventory_item_id:          typeof body.inventory_item_id === 'string' && body.inventory_item_id ? body.inventory_item_id : null,
    person_id:                  typeof body.person_id === 'string' && body.person_id ? body.person_id : null,
    route,
    estimated_quantity:         typeof body.estimated_quantity === 'string' && body.estimated_quantity.trim() ? body.estimated_quantity.trim() : null,
    exposure_duration_minutes:  typeof body.exposure_duration_minutes === 'number' ? body.exposure_duration_minutes : null,
    severity,
    ppe_in_use:                 ppe,
    measured_ppm:               typeof body.measured_ppm === 'number' ? body.measured_ppm : null,
    notes:                      typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
  }

  const errors = validateExposureInput(input)
  if (errors.length > 0) {
    return NextResponse.json({
      error: errors.map(e => `${e.field}: ${e.message}`).join('; '),
    }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()

    // Confirm both incident + product belong to the tenant.
    const [{ data: incident }, { data: product }] = await Promise.all([
      admin.from('incidents').select('id').eq('id', incidentId).eq('tenant_id', gate.tenantId).maybeSingle(),
      admin.from('chemical_products').select('id, archived_at').eq('id', input.product_id).eq('tenant_id', gate.tenantId).maybeSingle(),
    ])
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
    if (!product)  return NextResponse.json({ error: 'Chemical not found' }, { status: 404 })

    const { data, error } = await admin
      .from('chemical_exposure_events')
      .insert({
        tenant_id:   gate.tenantId,
        created_by:  gate.userId,
        updated_by:  gate.userId,
        ...input,
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ event: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
