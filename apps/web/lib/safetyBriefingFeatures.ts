import type { SupabaseClient } from '@supabase/supabase-js'
import { summarizeIncidentRisk } from '@soteria/core/incidentRiskModel'
import { detectPrecursors, type PrecursorConditions } from '@soteria/core/precursorRules'
import { buildSafetyBriefing, type SafetyBriefing } from '@soteria/core/safetyBriefing'
import { forecastCount } from '@soteria/core/forecast'
import { gatherIncidentRiskFeatures } from '@/lib/incidentRiskFeatures'

// Server-side orchestrator for the proactive safety briefing.
//
// Gathers once, derives three times. The risk score, the precursor conditions,
// and the briefing all read from ONE call to gatherIncidentRiskFeatures — that
// gather already fires ~14 queries per tenant, and running it separately for
// each consumer would triple that for no new information. Only two counts are
// not already in it (the confirmed vision signals) plus the monthly recordable
// series the forecast needs.
//
// Every number here is deterministic. The LLM narration surface, when used,
// receives this output and rewrites it as prose; it never computes or reorders.

const MONTHS_OF_HISTORY = 24
const RECENT_WINDOW_DAYS = 90
const DAY_MS = 86_400_000

export interface BriefingResult extends SafetyBriefing {
  /** The score the moves were ranked against, for the caller to render. */
  riskScore: number
  riskBand:  string
}

export async function computeSafetyBriefing(
  admin: SupabaseClient,
  tenantId: string,
  opts: { limit?: number } = {},
): Promise<BriefingResult> {
  const features = await gatherIncidentRiskFeatures(admin, tenantId)
  const risk = summarizeIncidentRisk(features)

  const [vision, recordablesMonthly] = await Promise.all([
    gatherVisionSignalCounts(admin, tenantId),
    gatherRecordablesMonthly(admin, tenantId),
  ])

  const conditions: PrecursorConditions = {
    capasOverdue:           features.capasOverdue,
    nearMissRecent:         features.nearMissRecent,
    recordablesRecent:      features.recordablesRecent,
    bbsUnsafe:              features.bbsUnsafe,
    bbsFollowupsOpen:       features.bbsFollowupsOpen ?? 0,
    inspectionsFailed:      features.inspectionsFailed ?? 0,
    inspectionsTotal:       features.inspectionsTotal ?? 0,
    trainingGaps:           features.trainingGaps ?? 0,
    permitExpiredOpen:      features.permitExpiredOpen ?? 0,
    highRisksUncontrolled:  features.highRisksUncontrolled,
    visionSignalsConfirmed: vision.confirmed,
    visionSignalsSevere:    vision.severe,
  }

  // No history is passed yet, so every firing pattern renders `unvalidated` and
  // makes no lead-time claim. Building the per-indicator monthly series that
  // detectPrecursors validates against is a separate, heavier aggregation —
  // and an unvalidated label is the honest state until it exists, not a
  // placeholder for one.
  const { patterns } = detectPrecursors(conditions)

  const briefing = buildSafetyBriefing({
    risk,
    patterns,
    forecast: forecastCount(recordablesMonthly),
    limit:    opts.limit,
  })

  return { ...briefing, riskScore: risk.score, riskBand: risk.band }
}

interface VisionSignalCounts {
  confirmed: number
  severe:    number
}

// Only CONFIRMED signals count. A pending signal is a machine's opinion nobody
// has checked, and letting it drive a recommendation would make the briefing
// as reliable as the least reliable hazard code.
async function gatherVisionSignalCounts(
  admin: SupabaseClient,
  tenantId: string,
): Promise<VisionSignalCounts> {
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * DAY_MS).toISOString()
  try {
    const { data, error } = await admin
      .from('vision_hazard_signals')
      .select('severity_weight')
      .eq('tenant_id', tenantId)
      .eq('status', 'confirmed')
      .gte('created_at', since)
    if (error) return { confirmed: 0, severe: 0 }

    const rows = (data ?? []) as { severity_weight: number }[]
    return {
      confirmed: rows.length,
      severe:    rows.filter(r => r.severity_weight >= 3).length,
    }
  } catch {
    // A tenant whose migration has not run yet contributes nothing rather than
    // failing the whole briefing.
    return { confirmed: 0, severe: 0 }
  }
}

// Monthly recordable counts, oldest → newest, for the forecast. Returns fewer
// than forecastCount's minimum when the tenant is young; the forecast then
// returns null and the briefing says there is not enough history rather than
// projecting from noise.
async function gatherRecordablesMonthly(
  admin: SupabaseClient,
  tenantId: string,
): Promise<number[]> {
  const start = new Date()
  start.setUTCMonth(start.getUTCMonth() - (MONTHS_OF_HISTORY - 1), 1)
  start.setUTCHours(0, 0, 0, 0)

  const [incRes, classRes] = await Promise.all([
    admin.from('incidents').select('id, occurred_at')
      .eq('tenant_id', tenantId).gte('occurred_at', start.toISOString()),
    admin.from('incident_classifications').select('incident_id, meets_recording_criteria')
      .eq('tenant_id', tenantId),
  ])
  if (incRes.error || classRes.error) return []

  const recordableIds = new Set(
    ((classRes.data ?? []) as { incident_id: string; meets_recording_criteria: boolean }[])
      .filter(c => c.meets_recording_criteria === true)
      .map(c => c.incident_id),
  )

  const buckets = new Map<string, number>()
  for (let i = 0; i < MONTHS_OF_HISTORY; i++) {
    const d = new Date(start)
    d.setUTCMonth(start.getUTCMonth() + i)
    buckets.set(monthKey(d), 0)
  }

  for (const row of (incRes.data ?? []) as { id: string; occurred_at: string }[]) {
    if (!recordableIds.has(row.id)) continue
    const key = monthKey(new Date(row.occurred_at))
    const current = buckets.get(key)
    if (current !== undefined) buckets.set(key, current + 1)
  }

  return [...buckets.values()]
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
