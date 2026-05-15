import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  HAZARDOUS_WASTE_FIELD_CHECKS,
  type HazardousWasteAreaType,
  type HazardousWasteFindingStatus,
  type HazardousWasteInspectionFinding,
} from '@soteria/core/hazardousWaste'

// /api/hazardous-waste/inspections
//   GET  — list inspections, optionally filtered by area_id, scoped to
//          the active tenant. Newest first, paginated.
//   POST — record an inspection. Any tenant member can submit; the row
//          is owned by `created_by` (the submitter) so RLS can let
//          members edit their own drafts without admin escalation.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_STATUSES: ReadonlyArray<HazardousWasteFindingStatus> = ['pass', 'fail', 'na']
const VALID_INSPECTION_STATUSES = ['submitted', 'draft'] as const
const VALID_AREA_TYPES: ReadonlyArray<HazardousWasteAreaType> = [
  'satellite_accumulation',
  'central_accumulation',
  'universal_waste',
  'used_oil',
  'inspection_only',
]

// Lookup table built once: check_id → { critical }. Used to coerce the
// client-supplied `flagged_critical` to the catalog truth so a client
// can't lie about which findings count as critical for the binder.
const CHECK_CATALOG = new Map<string, { critical: boolean; areaTypes: ReadonlyArray<HazardousWasteAreaType> }>(
  HAZARDOUS_WASTE_FIELD_CHECKS.map(c => [c.id, { critical: c.critical, areaTypes: c.areaTypes }]),
)

function parseFindings(raw: unknown, areaType: HazardousWasteAreaType):
  | { ok: true;  findings: HazardousWasteInspectionFinding[] }
  | { ok: false; error: string }
{
  if (!Array.isArray(raw)) return { ok: false, error: 'findings must be an array' }
  const out: HazardousWasteInspectionFinding[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'each finding must be an object' }
    const r = entry as Record<string, unknown>
    const check_id = typeof r.check_id === 'string' ? r.check_id : ''
    if (!check_id) return { ok: false, error: 'finding.check_id required' }
    const catalog = CHECK_CATALOG.get(check_id)
    if (!catalog) return { ok: false, error: `Unknown check_id: ${check_id}` }
    if (!catalog.areaTypes.includes(areaType)) {
      return { ok: false, error: `check_id ${check_id} does not apply to ${areaType}` }
    }
    if (seen.has(check_id)) return { ok: false, error: `Duplicate finding for ${check_id}` }
    seen.add(check_id)
    const status = typeof r.status === 'string' ? r.status : ''
    if (!(VALID_STATUSES as readonly string[]).includes(status)) {
      return { ok: false, error: `finding.status must be one of ${VALID_STATUSES.join(', ')}` }
    }
    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 1000) : null
    out.push({
      check_id,
      status:           status as HazardousWasteFindingStatus,
      note,
      // Always source `flagged_critical` from the static catalog so the
      // client can't downgrade a critical-fail finding by sending false.
      flagged_critical: catalog.critical,
    })
  }
  return { ok: true, findings: out }
}

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const areaId = url.searchParams.get('area_id')?.trim() ?? ''
  const limit  = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit')  ?? '50', 10) || 50))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)

  try {
    let q = gate.authedClient
      .from('hazardous_waste_inspections')
      .select('id, tenant_id, area_id, area_type, inspected_by, inspected_at, container_label, waste_description, observations, findings, total_checks, passing_checks, critical_failures, status, created_at, updated_at, created_by, updated_by',
        { count: 'exact' })
      .eq('tenant_id', gate.tenantId)
      .order('inspected_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (areaId) {
      if (!UUID_RE.test(areaId)) return NextResponse.json({ error: 'Invalid area_id' }, { status: 400 })
      q = q.eq('area_id', areaId)
    }

    const { data, count, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({
      inspections: data ?? [],
      total:       count ?? 0,
      limit,
      offset,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/inspections/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const areaId = typeof body.area_id === 'string' ? body.area_id.trim() : ''
  if (!UUID_RE.test(areaId)) return NextResponse.json({ error: 'area_id required' }, { status: 400 })

  const admin = supabaseAdmin()

  // Confirm the area belongs to this tenant before we trust the
  // area_type the client sends. Belt-and-braces against a member
  // posting an area_id from a tenant they were previously in.
  const { data: area, error: areaErr } = await admin
    .from('hazardous_waste_areas')
    .select('id, area_type, archived_at')
    .eq('tenant_id', gate.tenantId)
    .eq('id', areaId)
    .maybeSingle()
  if (areaErr) {
    Sentry.captureException(areaErr, { tags: { route: 'hazardous-waste/inspections/POST', stage: 'area-lookup' } })
    return NextResponse.json({ error: areaErr.message }, { status: 500 })
  }
  if (!area) return NextResponse.json({ error: 'Area not found' }, { status: 404 })
  if (area.archived_at) return NextResponse.json({ error: 'Area is archived' }, { status: 409 })

  const area_type = area.area_type as HazardousWasteAreaType
  if (!(VALID_AREA_TYPES as readonly string[]).includes(area_type)) {
    return NextResponse.json({ error: 'Area has an unknown area_type — fix the area record first' }, { status: 500 })
  }

  const parsed = parseFindings(body.findings, area_type)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const statusRaw = typeof body.status === 'string' ? body.status : 'submitted'
  if (!(VALID_INSPECTION_STATUSES as readonly string[]).includes(statusRaw)) {
    return NextResponse.json({ error: `status must be one of ${VALID_INSPECTION_STATUSES.join(', ')}` }, { status: 400 })
  }

  const insert: Record<string, unknown> = {
    tenant_id:          gate.tenantId,
    area_id:            areaId,
    area_type,
    inspected_by:       gate.userId,
    inspected_at:       typeof body.inspected_at === 'string' && body.inspected_at
                          ? body.inspected_at
                          : new Date().toISOString(),
    container_label:    typeof body.container_label === 'string' && body.container_label.trim()
                          ? body.container_label.trim().slice(0, 200)
                          : null,
    waste_description:  typeof body.waste_description === 'string' && body.waste_description.trim()
                          ? body.waste_description.trim().slice(0, 500)
                          : null,
    observations:       typeof body.observations === 'string' && body.observations.trim()
                          ? body.observations.trim().slice(0, 2000)
                          : null,
    findings:           parsed.findings,
    status:             statusRaw,
    created_by:         gate.userId,
    updated_by:         gate.userId,
  }

  try {
    const { data, error } = await admin
      .from('hazardous_waste_inspections')
      .insert(insert)
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'hazardous-waste/inspections/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ inspection: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/inspections/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
