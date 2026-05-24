import type { SupabaseClient } from '@supabase/supabase-js'
import { buildWeatherReport, type WeatherMetricRow } from '@soteria/core/scorecardWeatherReport'
import { trir as trirRate, dart as dartRate, type ClassificationRowForMetrics } from '@soteria/core/incidentScorecardMetrics'
import { computeIncidentRisk } from '@/lib/incidentRiskFeatures'

// Builds the per-tenant weekly weather-report payload: week-over-week rows,
// year-to-date TRIR/DART, and the data-driven incident-risk summary. Shared by
// the weekly cron (which emails it) and the preview route (which renders it on
// demand so an admin can see the email before it goes out) — one source of
// truth for the numbers.

const DAY_MS = 86_400_000

export interface WeatherReportData {
  weekStart:      string
  rows:           WeatherMetricRow[]
  trir:           number | null
  dart:           number | null
  recordablesYtd: number
  risk:           {
    score:   number
    band:    string
    drivers: { label: string; value: string; target: string; contribution: number; href: string }[]
  } | null
}

export async function buildWeatherReportData(admin: SupabaseClient, tenantId: string): Promise<WeatherReportData> {
  const now = new Date()
  const nowMs = now.getTime()
  const thisWeekStart = nowMs - 7 * DAY_MS
  const lastWeekStart = nowMs - 14 * DAY_MS
  const weekStart = new Date(thisWeekStart).toISOString().slice(0, 10)
  const yearStartMs = Date.UTC(now.getUTCFullYear(), 0, 1)
  const yearKey = String(now.getUTCFullYear())

  const [incRes, classRes, actionsRes, estRes] = await Promise.all([
    admin.from('incidents').select('id, incident_type, occurred_at').eq('tenant_id', tenantId),
    admin.from('incident_classifications').select('incident_id, meets_recording_criteria, classification').eq('tenant_id', tenantId),
    admin.from('incident_actions').select('id, status, completed_at').eq('tenant_id', tenantId),
    admin.from('osha_establishments').select('hours_employees_by_year').eq('tenant_id', tenantId),
  ])
  for (const r of [incRes, classRes, actionsRes, estRes]) if (r.error) throw new Error(r.error.message)

  type IncRow = { id: string; incident_type: string; occurred_at: string }
  const incidents = (incRes.data ?? []) as IncRow[]
  const recordableIds = new Set(
    ((classRes.data ?? []) as ClassificationRowForMetrics[])
      .filter(c => c.meets_recording_criteria === true)
      .map(c => c.incident_id),
  )
  const inRange = (iso: string, from: number, to: number): boolean => {
    const ms = new Date(iso).getTime()
    return !Number.isNaN(ms) && ms >= from && ms < to
  }

  const recordableThis = incidents.filter(r => recordableIds.has(r.id) && inRange(r.occurred_at, thisWeekStart, nowMs)).length
  const recordableLast = incidents.filter(r => recordableIds.has(r.id) && inRange(r.occurred_at, lastWeekStart, thisWeekStart)).length
  const nearMissThis = incidents.filter(r => r.incident_type === 'near_miss' && inRange(r.occurred_at, thisWeekStart, nowMs)).length
  const nearMissLast = incidents.filter(r => r.incident_type === 'near_miss' && inRange(r.occurred_at, lastWeekStart, thisWeekStart)).length

  type ARow = { id: string; status: string; completed_at: string | null }
  const isClosed = (a: ARow) => (a.status === 'complete' || a.status === 'verified') && !!a.completed_at
  const actions = (actionsRes.data ?? []) as ARow[]
  const capasThis = actions.filter(a => isClosed(a) && inRange(a.completed_at!, thisWeekStart, nowMs)).length
  const capasLast = actions.filter(a => isClosed(a) && inRange(a.completed_at!, lastWeekStart, thisWeekStart)).length

  const rows = buildWeatherReport([
    { key: 'recordables', label: 'Recordable injuries', current: recordableThis, previous: recordableLast, higherIsBetter: false },
    { key: 'near_miss', label: 'Near-miss reports', current: nearMissThis, previous: nearMissLast, higherIsBetter: true },
    { key: 'capas_closed', label: 'Corrective actions closed', current: capasThis, previous: capasLast, higherIsBetter: true },
  ])

  const classById = new Map<string, ClassificationRowForMetrics>()
  for (const c of (classRes.data ?? []) as ClassificationRowForMetrics[]) classById.set(c.incident_id, c)
  const recordablesYtd = incidents.filter(r => recordableIds.has(r.id) && inRange(r.occurred_at, yearStartMs, nowMs))
  const ytdDeaths = recordablesYtd.filter(r => classById.get(r.id)?.classification === 'death').length
  const ytdDaysAway = recordablesYtd.filter(r => classById.get(r.id)?.classification === 'days_away').length
  const ytdRestricted = recordablesYtd.filter(r => classById.get(r.id)?.classification === 'restricted').length

  type EstYears = { hours_employees_by_year: Record<string, { hours?: number }> | null }
  let hoursWorked = 0
  for (const e of ((estRes.data ?? []) as EstYears[])) {
    const h = e.hours_employees_by_year?.[yearKey]?.hours
    if (typeof h === 'number') hoursWorked += h
  }

  const trir = trirRate(recordablesYtd.length, hoursWorked)
  const dart = dartRate(ytdDeaths, ytdDaysAway, ytdRestricted, hoursWorked)

  let risk: WeatherReportData['risk'] = null
  try {
    const rr = await computeIncidentRisk(admin, tenantId)
    risk = {
      score: rr.score,
      band:  rr.band,
      drivers: rr.drivers
        .filter(d => d.contribution > 0)
        .slice(0, 5)
        .map(d => ({ label: d.label, value: d.value, target: d.target, contribution: d.contribution, href: d.href })),
    }
  } catch { risk = null }

  return { weekStart, rows, trir, dart, recordablesYtd: recordablesYtd.length, risk }
}
