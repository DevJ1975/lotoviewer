import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import {
  WEATHER_UNIT_SYSTEMS,
  validateWeatherReadingInput,
  type WeatherReadingInput,
  type WeatherUnitSystem,
} from '@soteria/core/safetyWeather'

// GET  /api/weather/readings   Most recent onsite verification readings for the
//                              active tenant (and active facility when set).
// POST /api/weather/readings   Log an onsite wind reading measured against the
//                              captured forecast.
//
// Both run through the gate's authedClient, so RLS scopes every row to the
// caller's tenant. The body validation lives in the shared core validator;
// this route's only job is to map the wire shape onto it and stamp ownership.

const READINGS_LIMIT = 50

const SELECT_COLS = [
  'id', 'tenant_id', 'facility_id', 'reading_at',
  'measured_wind_mph', 'measured_gust_mph', 'unit_system', 'instrument',
  'latitude', 'longitude',
  'forecast_wind_mph', 'forecast_gust_mph', 'forecast_fetched_at',
  'note', 'created_at', 'created_by',
].join(', ')

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    let q = gate.authedClient
      .from('safety_weather_readings')
      .select(SELECT_COLS)
      .eq('tenant_id', gate.tenantId)

    if (gate.facilityId) q = q.eq('facility_id', gate.facilityId)

    q = q.order('reading_at', { ascending: false }).limit(READINGS_LIMIT)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({ readings: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'weather/readings', stage: 'select' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Map the wire shape onto the core input so type narrowing and validation
  // happen in one place. Unit system defaults to imperial — the thresholds the
  // board enforces are authored in mph/°F. facility_id is intentionally NOT read
  // from the body: it's derived from the authenticated gate below so a client
  // can't attribute an immutable safety attestation to an arbitrary or
  // cross-tenant facility.
  const input: WeatherReadingInput = {
    measured_wind_mph:   typeof body.measured_wind_mph === 'number' ? body.measured_wind_mph : null,
    measured_gust_mph:   typeof body.measured_gust_mph === 'number' ? body.measured_gust_mph : null,
    unit_system:         isUnitSystem(body.unit_system) ? body.unit_system : 'imperial',
    instrument:          typeof body.instrument === 'string' ? body.instrument : null,
    latitude:            typeof body.latitude === 'number' ? body.latitude : null,
    longitude:           typeof body.longitude === 'number' ? body.longitude : null,
    forecast_wind_mph:   typeof body.forecast_wind_mph === 'number' ? body.forecast_wind_mph : null,
    forecast_gust_mph:   typeof body.forecast_gust_mph === 'number' ? body.forecast_gust_mph : null,
    forecast_fetched_at: typeof body.forecast_fetched_at === 'string' ? body.forecast_fetched_at : null,
    note:                typeof body.note === 'string' ? body.note : null,
  }

  const validationError = validateWeatherReadingInput(input)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const insert = {
    tenant_id:           gate.tenantId,
    // Scope is derived from the authenticated context, never the client body.
    facility_id:         gate.facilityId,
    measured_wind_mph:   input.measured_wind_mph,
    measured_gust_mph:   input.measured_gust_mph ?? null,
    unit_system:         input.unit_system ?? 'imperial',
    instrument:          input.instrument ?? null,
    latitude:            input.latitude ?? null,
    longitude:           input.longitude ?? null,
    forecast_wind_mph:   input.forecast_wind_mph ?? null,
    forecast_gust_mph:   input.forecast_gust_mph ?? null,
    forecast_fetched_at: input.forecast_fetched_at ?? null,
    note:                input.note ?? null,
    created_by:          gate.userId,
  }

  try {
    const { data, error } = await gate.authedClient
      .from('safety_weather_readings')
      .insert(insert)
      .select(SELECT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'weather/readings', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ reading: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'weather/readings', stage: 'insert' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function isUnitSystem(value: unknown): value is WeatherUnitSystem {
  return typeof value === 'string' && (WEATHER_UNIT_SYSTEMS as readonly string[]).includes(value)
}
