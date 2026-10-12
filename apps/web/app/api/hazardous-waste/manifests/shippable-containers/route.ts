import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import type { ShippableContainer } from '@/lib/hazardousWasteManifestView'
import { HAZARDOUS_WASTE_MODULE, gateFailure, manifestDbError } from '../_shared'

// GET /api/hazardous-waste/manifests/shippable-containers
//
// The containers a new manifest can take: closed, not archived, at the active site (every site
// when none is selected, where a manifest must still be made one site at a time). Not the
// containers route with a filter, because that one is not site-scoped. At most 200 are returned;
// `total` says how many there are.

const LIMIT = 200

interface ContainerRow {
  id: string
  label: string
  area_location: string | null
  volume_quantity: number | null
  volume_unit: string | null
  accumulation_started_at: string | null
  facility_id: string | null
  stream: { id: string; name: string; waste_codes: string[] } | { id: string; name: string; waste_codes: string[] }[] | null
}

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, HAZARDOUS_WASTE_MODULE)
  if (!gate.ok) return gateFailure(gate)

  let query = gate.authedClient
    .from('hazardous_waste_containers')
    .select(
      'id, label, area_location, volume_quantity, volume_unit, accumulation_started_at, facility_id, stream:stream_id (id, name, waste_codes)',
      { count: 'exact' },
    )
    .eq('tenant_id', gate.tenantId)
    .eq('status', 'closed')
    .is('archived_at', null)
  if (gate.facilityId) query = query.eq('facility_id', gate.facilityId)

  const { data, count, error } = await query.order('label', { ascending: true }).limit(LIMIT)
  if (error) return manifestDbError(error, 'hazardous-waste/manifests/shippable-containers/GET')

  const containers: ShippableContainer[] = ((data ?? []) as unknown as ContainerRow[]).map(row => ({
    id: row.id,
    label: row.label,
    area_location: row.area_location,
    volume_quantity: row.volume_quantity,
    volume_unit: row.volume_unit,
    accumulation_started_at: row.accumulation_started_at,
    stream: (Array.isArray(row.stream) ? row.stream[0] : row.stream) ?? null,
  }))
  return NextResponse.json({ containers, total: count ?? containers.length })
}
