import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { HazardousWasteAreaType } from '@soteria/core/hazardousWaste'

// /api/hazardous-waste/areas
//   GET   — list this tenant's accumulation areas with each area's most
//           recent inspection timestamp folded in (so the dashboard can
//           show "X days since last walk-through" without an N+1 fetch).
//   POST  — create a new area. Tenant admin/owner only.

const AREA_TYPES: ReadonlyArray<HazardousWasteAreaType> = [
  'satellite_accumulation',
  'central_accumulation',
  'universal_waste',
  'used_oil',
  'inspection_only',
]

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const includeArchived = url.searchParams.get('include_archived') === 'true'

  try {
    let q = gate.authedClient
      .from('hazardous_waste_areas')
      .select('id, tenant_id, name, area_type, location_notes, weekly_cadence_days, archived_at, created_at, updated_at, created_by, updated_by')
      .eq('tenant_id', gate.tenantId)
      .order('name', { ascending: true })
    if (!includeArchived) q = q.is('archived_at', null)

    const { data: areas, error } = await q
    if (error) throw new Error(error.message)

    // One round-trip aggregation to fold the most recent inspection
    // time into each area row. The DB is the cheap place to do this;
    // doing it in JS would mean fetching every inspection row.
    const areaIds = (areas ?? []).map(a => a.id)
    let lastInspectedByArea = new Map<string, string>()
    if (areaIds.length > 0) {
      const { data: lastRows, error: lastErr } = await gate.authedClient
        .from('hazardous_waste_inspections')
        .select('area_id, inspected_at')
        .eq('tenant_id', gate.tenantId)
        .in('area_id', areaIds)
        .order('inspected_at', { ascending: false })
      if (lastErr) throw new Error(lastErr.message)
      for (const row of lastRows ?? []) {
        if (!lastInspectedByArea.has(row.area_id)) {
          lastInspectedByArea.set(row.area_id, row.inspected_at)
        }
      }
    }

    return NextResponse.json({
      areas: (areas ?? []).map(a => ({
        ...a,
        last_inspected_at: lastInspectedByArea.get(a.id) ?? null,
      })),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/areas/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return badRequest('Invalid JSON') }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return badRequest('name required')
  if (name.length > 120) return badRequest('name must be 120 characters or fewer')

  const areaTypeRaw = typeof body.area_type === 'string' ? body.area_type : ''
  if (!(AREA_TYPES as readonly string[]).includes(areaTypeRaw)) {
    return badRequest(`area_type must be one of ${AREA_TYPES.join(', ')}`)
  }
  const area_type = areaTypeRaw as HazardousWasteAreaType

  const cadenceRaw = body.weekly_cadence_days
  const weekly_cadence_days = typeof cadenceRaw === 'number'
    ? cadenceRaw
    : Number.parseInt(String(cadenceRaw ?? ''), 10)
  if (!Number.isFinite(weekly_cadence_days) || weekly_cadence_days < 1 || weekly_cadence_days > 90) {
    return badRequest('weekly_cadence_days must be between 1 and 90')
  }

  const location_notes = typeof body.location_notes === 'string' && body.location_notes.trim()
    ? body.location_notes.trim()
    : null

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('hazardous_waste_areas')
      .insert({
        tenant_id:           gate.tenantId,
        name,
        area_type,
        weekly_cadence_days,
        location_notes,
        created_by:          gate.userId,
        updated_by:          gate.userId,
      })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An area with that name already exists' }, { status: 409 })
      }
      Sentry.captureException(error, { tags: { route: 'hazardous-waste/areas/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ area: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/areas/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
