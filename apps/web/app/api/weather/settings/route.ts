import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/weather/settings
//
// Returns the active scope's Safety Weather Board threshold override (a partial
// SafetyWeatherConfig persisted in safety_weather_settings). The board merges it
// over DEFAULT_SAFETY_WEATHER_CONFIG via resolveSafetyWeatherConfig in core.
//
// Resolution: when the caller has an active facility we prefer that facility's
// row, otherwise the tenant default (facility_id is null). A missing row is not
// an error — the board simply runs on the core defaults.

const SELECT_COLS = 'tenant_id, facility_id, config, updated_at, updated_by'

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('safety_weather_settings')
      .select(SELECT_COLS)
      .eq('tenant_id', gate.tenantId)
    if (error) throw new Error(error.message)

    const rows = data ?? []
    // Prefer the active facility's override, fall back to the tenant default.
    const settings =
      (gate.facilityId && rows.find(r => r.facility_id === gate.facilityId)) ||
      rows.find(r => r.facility_id === null) ||
      null

    return NextResponse.json({ settings })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'weather/settings', stage: 'select' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
