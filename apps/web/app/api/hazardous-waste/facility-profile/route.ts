import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  HAZARDOUS_WASTE_FACILITY_SETTINGS_KEY,
  parseFacilityProfile,
  validateHazardousWasteFacilityProfile,
  type HazardousWasteFacilityProfile,
  type RcraGeneratorCategory,
  type WasteJurisdiction,
} from '@soteria/core/hazardousWaste'

// /api/hazardous-waste/facility-profile
//   GET — the active facility's generator profile (category, jurisdiction,
//         EPA ID, long-haul default), stored on facilities.settings.
//   PUT — replace it. Tenant admin/owner only.
//
// Generator category is a facility-level determination (40 CFR 262.13), so the
// profile lives on the facility, not the waste stream. Requires an active
// facility (x-active-facility header); in roll-up mode there is no single
// facility to edit.

function trimOrNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max) : t
}

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  if (!gate.facilityId) {
    return NextResponse.json({ profile: null, facilityId: null, facilityName: null })
  }

  try {
    const { data, error } = await gate.authedClient
      .from('facilities')
      .select('id, name, settings')
      .eq('id', gate.facilityId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Facility not found' }, { status: 404 })

    return NextResponse.json({
      profile:      parseFacilityProfile(data.settings as Record<string, unknown> | null),
      facilityId:   data.id,
      facilityName: data.name,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/facility-profile/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  if (!gate.facilityId) {
    return NextResponse.json({ error: 'Select a facility before editing its profile' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const categoryRaw = typeof body.generator_category === 'string' ? body.generator_category : null
  const jurisdictionRaw = typeof body.jurisdiction === 'string' ? body.jurisdiction : null

  const profile: HazardousWasteFacilityProfile = {
    generator_category:
      categoryRaw === 'lqg' || categoryRaw === 'sqg' || categoryRaw === 'vsqg'
        ? (categoryRaw as RcraGeneratorCategory) : null,
    jurisdiction:
      jurisdictionRaw === 'federal' || jurisdictionRaw === 'california'
        ? (jurisdictionRaw as WasteJurisdiction) : null,
    epa_id_number:     trimOrNull(body.epa_id_number, 40),
    long_haul_default: body.long_haul_default === true,
  }

  const errors = validateHazardousWasteFacilityProfile(profile)
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.map(e => `${e.field}: ${e.message}`).join('; ') }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: facility, error: readErr } = await admin
      .from('facilities')
      .select('settings')
      .eq('id', gate.facilityId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (readErr) throw new Error(readErr.message)
    if (!facility) return NextResponse.json({ error: 'Facility not found' }, { status: 404 })

    const settings = {
      ...((facility.settings as Record<string, unknown> | null) ?? {}),
      [HAZARDOUS_WASTE_FACILITY_SETTINGS_KEY]: profile,
    }

    const { error: updErr } = await admin
      .from('facilities')
      .update({ settings })
      .eq('id', gate.facilityId)
      .eq('tenant_id', gate.tenantId)
    if (updErr) throw new Error(updErr.message)

    return NextResponse.json({ profile, facilityId: gate.facilityId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/facility-profile/PUT' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
