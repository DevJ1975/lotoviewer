import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  renderHazardousWasteLabel,
  HW_LABEL_SIZES,
  type HwAreaPlacardInput,
} from '@/lib/hazardousWasteLabels'
import { GHS_PICTOGRAMS, type GhsPictogram } from '@soteria/core/chemicals'
import { isValidDotHazardClass } from '@soteria/core/hazardSymbols'
import { HAZARDOUS_WASTE_AREA_LABEL, type HazardousWasteAreaType } from '@soteria/core/hazardousWaste'

// POST /api/hazardous-waste/areas/[id]/signage
//   body: { size: '8.5x11' | '11x17', emergency_contacts?: string[] }
//
// Renders an accumulation-area placard (hw_accumulation_placard) that
// aggregates the hazards of every ACTIVE stream stored in the area, and
// logs the print to hazardous_waste_label_prints with area_id set.
//
// Containers link to an area by area_type (migration 140 has no area_id
// FK on containers), so "streams in the area" = the distinct streams of
// every open container whose area_type matches this area's area_type. The
// audit row needs a stream_id (NOT NULL); we bind it to the first
// aggregated stream. When the area holds no active streams the placard
// still renders (with an empty rollup) but the audit insert is skipped.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PLACARD_TEMPLATE = 'hw_accumulation_placard' as const

interface Ctx { params: Promise<{ id: string }> }

interface AreaRow {
  id:                  string
  name:                string
  area_type:           HazardousWasteAreaType
  weekly_cadence_days: number
  archived_at:         string | null
}

interface ContainerRow {
  stream_id: string
}

interface StreamHazardRow {
  id:               string
  name:             string
  ghs_pictograms:   string[] | null
  dot_hazard_class: string | null
}

function pickStringArray(value: unknown, max = 6): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim().slice(0, 200))
    .slice(0, max)
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const tenantId = gate.tenantId
  const userId   = gate.userId

  const { id: areaId } = await ctx.params
  if (!UUID_RE.test(areaId)) {
    return NextResponse.json({ error: 'Invalid area id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const sizeKey = typeof body.size === 'string' ? body.size : ''
  if (!HW_LABEL_SIZES[PLACARD_TEMPLATE].some(s => s.key === sizeKey)) {
    return NextResponse.json({
      error: `Unknown size for ${PLACARD_TEMPLATE}: ${sizeKey}. ` +
             `Valid: ${HW_LABEL_SIZES[PLACARD_TEMPLATE].map(s => s.key).join(', ')}`,
    }, { status: 400 })
  }

  const emergencyContacts = pickStringArray(body.emergency_contacts, 4)

  try {
    const admin = supabaseAdmin()

    const { data: area, error: aErr } = await admin
      .from('hazardous_waste_areas')
      .select('id, name, area_type, weekly_cadence_days, archived_at')
      .eq('id', areaId)
      .eq('tenant_id', tenantId)
      .maybeSingle<AreaRow>()
    if (aErr)  return NextResponse.json({ error: aErr.message }, { status: 500 })
    if (!area) return NextResponse.json({ error: 'Area not found' }, { status: 404 })
    if (area.archived_at) {
      return NextResponse.json({ error: 'Cannot print signage for an archived area.' }, { status: 409 })
    }

    // Open containers in this area (linked by area_type) → distinct streams.
    const { data: containers, error: cErr } = await admin
      .from('hazardous_waste_containers')
      .select('stream_id')
      .eq('tenant_id', tenantId)
      .eq('area_type', area.area_type)
      .eq('status', 'open')
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

    const streamIds = Array.from(
      new Set(((containers ?? []) as ContainerRow[]).map(c => c.stream_id)),
    )

    let streams: StreamHazardRow[] = []
    if (streamIds.length > 0) {
      const { data: streamRows, error: srErr } = await admin
        .from('hazardous_waste_streams')
        .select('id, name, ghs_pictograms, dot_hazard_class')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('archived_at', null)
        .in('id', streamIds)
        .order('name', { ascending: true })
      if (srErr) return NextResponse.json({ error: srErr.message }, { status: 500 })
      streams = (streamRows ?? []) as StreamHazardRow[]
    }

    // Roll up deduped pictograms + DOT classes across the active streams.
    const pictoSet = new Set<GhsPictogram>()
    const dotSet   = new Set<string>()
    for (const s of streams) {
      for (const p of s.ghs_pictograms ?? []) {
        if ((GHS_PICTOGRAMS as readonly string[]).includes(p)) pictoSet.add(p as GhsPictogram)
      }
      if (s.dot_hazard_class && isValidDotHazardClass(s.dot_hazard_class)) {
        dotSet.add(s.dot_hazard_class)
      }
    }

    const { data: tenantRow } = await admin
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle<{ name: string }>()
    const tenantName = tenantRow?.name ?? 'Soteria Field'

    const origin = req.headers.get('origin') ?? new URL(req.url).origin
    const qrUrl = `${origin.replace(/\/+$/, '')}/hazardous-waste/areas/${areaId}`

    const input: HwAreaPlacardInput = {
      area_id:                 area.id,
      area_name:               area.name,
      area_type_label:         HAZARDOUS_WASTE_AREA_LABEL[area.area_type] ?? area.area_type,
      inspection_cadence_days: area.weekly_cadence_days,
      ghs_pictograms:          Array.from(pictoSet),
      dot_hazard_classes:      Array.from(dotSet),
      stream_names:            streams.map(s => s.name),
      emergency_contacts:      emergencyContacts,
      qr_url:                  qrUrl,
      tenant_name:             tenantName,
    }

    const result = await renderHazardousWasteLabel({ template: PLACARD_TEMPLATE, sizeKey, input })

    // Audit row needs a stream_id (NOT NULL); bind to the first aggregated
    // stream. With no active streams in the area we skip the audit insert
    // rather than block the placard — same posture as the chemicals route.
    const auditStreamId = streams[0]?.id ?? null
    if (auditStreamId) {
      try {
        await admin.from('hazardous_waste_label_prints').insert({
          tenant_id:      tenantId,
          stream_id:      auditStreamId,
          area_id:        areaId,
          template:       PLACARD_TEMPLATE,
          size_key:       sizeKey,
          field_snapshot: input,
          filename:       result.filename,
          byte_size:      result.byteSize,
          printed_by:     userId,
        })
      } catch (logErr) {
        Sentry.captureException(logErr, { tags: { route: 'hazardous-waste/areas/signage', stage: 'audit' } })
      }
    }

    const pdfBlob = new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' })
    return new NextResponse(pdfBlob, {
      status: 200,
      headers: {
        'content-type':        'application/pdf',
        'content-disposition': `inline; filename="${result.filename}"`,
        'cache-control':       'no-store',
      },
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/areas/signage' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// GET /api/hazardous-waste/areas/[id]/signage
// Recent placard-print history for the area's audit drawer.
export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id: areaId } = await ctx.params
  if (!UUID_RE.test(areaId)) {
    return NextResponse.json({ error: 'Invalid area id' }, { status: 400 })
  }

  try {
    const { data, error } = await gate.authedClient
      .from('hazardous_waste_label_prints')
      .select('id, template, size_key, filename, byte_size, stream_id, printed_at, printed_by')
      .eq('area_id', areaId)
      .eq('tenant_id', gate.tenantId)
      .order('printed_at', { ascending: false })
      .limit(50)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ prints: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
