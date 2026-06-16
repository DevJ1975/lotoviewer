import { apiBase, authHeaders } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import {
  type WeatherReadingInput,
  type SafetyWeatherReadingRow,
} from '@soteria/core/safetyWeather'

// Mobile client for the Safety Weather Board's onsite verification readings.
// Writes go through the web endpoint (POST /api/weather/readings) so input
// validation, tenant scoping, and the created_by stamp all stay server-side;
// reads come straight from Supabase, RLS-scoped to the active tenant, matching
// the list-read pattern the other field screens use.

export async function submitWeatherReading(
  tenantId: string,
  input: WeatherReadingInput,
): Promise<SafetyWeatherReadingRow> {
  const res = await fetch(`${apiBase()}/api/weather/readings`, {
    method: 'POST',
    headers: await authHeaders(tenantId),
    body: JSON.stringify(input),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Submit failed (${res.status})`)
  // The route wraps the inserted row as { reading }.
  return body.reading as SafetyWeatherReadingRow
}

export async function fetchRecentReadings(
  tenantId: string,
  facilityId: string | null,
): Promise<SafetyWeatherReadingRow[]> {
  let query = supabase
    .from('safety_weather_readings')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('reading_at', { ascending: false })
    .limit(50)
  if (facilityId) query = query.eq('facility_id', facilityId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as SafetyWeatherReadingRow[]
}
