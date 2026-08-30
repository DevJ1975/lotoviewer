import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  HAZARDOUS_WASTE_CONTAINER_STATUSES,
  HAZARDOUS_WASTE_VOLUME_UNITS,
  validateHazardousWasteContainerInput,
  type HazardousWasteContainerInput,
  type HazardousWasteAreaType,
} from '@soteria/core/hazardousWaste'

// GET  /api/hazardous-waste/containers      List containers (optionally
//                                            filtered by stream_id / status).
//                                            Returns each container WITH a
//                                            joined `stream` projection so the
//                                            UI can compute aging without a
//                                            second round-trip.
// POST /api/hazardous-waste/containers      Create a container row.

const AREA_TYPES: HazardousWasteAreaType[] = [
  'satellite_accumulation', 'central_accumulation',
  'universal_waste', 'used_oil', 'inspection_only',
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function trimOrNull(value: unknown, max?: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (!t) return null
  return max && t.length > max ? t.slice(0, max) : t
}

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const streamId = url.searchParams.get('stream_id')?.trim() ?? ''
  const statusFilter = url.searchParams.get('status')?.trim() ?? ''
  const includeArchived = url.searchParams.get('include_archived') === 'true'

  try {
    let q = gate.authedClient
      .from('hazardous_waste_containers')
      .select(
        // Inline the only stream columns the UI needs for aging + display.
        `*, stream:stream_id (
          id, name, generator_category, long_haul, waste_codes,
          jurisdiction, acute_class,
          ghs_pictograms, ghs_signal_word, dot_un_number, dot_hazard_class, dot_packing_group
        )`,
        { count: 'exact' },
      )
      .eq('tenant_id', gate.tenantId)

    if (!includeArchived) q = q.is('archived_at', null)
    if (streamId) q = q.eq('stream_id', streamId)
    if (statusFilter && (HAZARDOUS_WASTE_CONTAINER_STATUSES as readonly string[]).includes(statusFilter)) {
      q = q.eq('status', statusFilter)
    }
    q = q
      // Open containers with the oldest accumulation start surface first —
      // that's the aging risk the operator most needs to see.
      .order('status', { ascending: true })
      .order('accumulation_started_at', { ascending: true, nullsFirst: false })

    const { data, count, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({ containers: data ?? [], total: count ?? 0 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const area_type_raw = typeof body.area_type === 'string' ? body.area_type : ''
  const area_type = (AREA_TYPES as readonly string[]).includes(area_type_raw)
    ? (area_type_raw as HazardousWasteAreaType)
    : 'satellite_accumulation'

  const status_raw = typeof body.status === 'string' ? body.status : 'open'
  const status = (HAZARDOUS_WASTE_CONTAINER_STATUSES as readonly string[]).includes(status_raw)
    ? (status_raw as typeof HAZARDOUS_WASTE_CONTAINER_STATUSES[number])
    : 'open'

  const volume_unit_raw = typeof body.volume_unit === 'string' ? body.volume_unit : null
  const volume_unit = volume_unit_raw && (HAZARDOUS_WASTE_VOLUME_UNITS as readonly string[]).includes(volume_unit_raw)
    ? (volume_unit_raw as typeof HAZARDOUS_WASTE_VOLUME_UNITS[number])
    : null

  const volume_quantity_raw = body.volume_quantity
  const volume_quantity = typeof volume_quantity_raw === 'number'
    ? volume_quantity_raw
    : typeof volume_quantity_raw === 'string' && volume_quantity_raw.trim()
      ? Number(volume_quantity_raw)
      : null

  const input: HazardousWasteContainerInput = {
    stream_id:               typeof body.stream_id === 'string' ? body.stream_id : '',
    label:                   trimOrNull(body.label, 120) ?? '',
    area_type,
    area_location:           trimOrNull(body.area_location, 200),
    accumulation_started_at: trimOrNull(body.accumulation_started_at),
    volume_quantity,
    volume_unit,
    status,
    notes:                   trimOrNull(body.notes, 2000),
  }

  const errors = validateHazardousWasteContainerInput(input)
  if (errors.length > 0) {
    return NextResponse.json({
      error: errors.map(e => `${e.field}: ${e.message}`).join('; '),
    }, { status: 400 })
  }

  if (!UUID_RE.test(input.stream_id)) {
    return NextResponse.json({ error: 'stream_id: Invalid stream' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // Confirm the stream belongs to this tenant before linking a container
  // to it. The insert runs through the service-role client (RLS bypassed),
  // and the FK alone doesn't constrain the stream's tenant — so without
  // this check a member could point a container at another tenant's stream
  // and read its name/waste codes back from the embedded `stream` join.
  // Mirrors the area_id guard in the inspections POST route.
  const { data: stream, error: streamErr } = await admin
    .from('hazardous_waste_streams')
    .select('id, archived_at')
    .eq('tenant_id', gate.tenantId)
    .eq('id', input.stream_id)
    .maybeSingle()
  if (streamErr) return NextResponse.json({ error: streamErr.message }, { status: 500 })
  if (!stream) return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
  if (stream.archived_at) return NextResponse.json({ error: 'Stream is archived' }, { status: 409 })

  try {
    const { data, error } = await admin
      .from('hazardous_waste_containers')
      .insert({
        tenant_id:  gate.tenantId,
        created_by: gate.userId,
        updated_by: gate.userId,
        ...input,
      })
      .select(`*, stream:stream_id (
        id, name, generator_category, long_haul, waste_codes,
        jurisdiction, acute_class,
        ghs_pictograms, ghs_signal_word, dot_un_number, dot_hazard_class, dot_packing_group
      )`)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ container: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
