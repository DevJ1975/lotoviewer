import type { SupabaseClient } from '@supabase/supabase-js'
import {
  exceedanceSummary, parseLimitRow, parseResultRow, reportingYearFor, type ExceedanceSummary,
} from '@soteria/core/environmental/monitoring'
import { reportingYearBasisFor } from '@soteria/core/environmental/monitoringDefaults'
import { loadSiteContext } from './siteContext'

// The thin orchestrator behind the monitoring summary: reads the site's limits and the
// reporting year's results through the caller's own client (so row-level security applies to
// every read) and hands them to the pure summarizer in packages/core.

/** A site's limits are typed by hand or adopted from a short catalog; this is far past any real one. */
export const MAX_LIMITS = 500

/** A reporting year of results for one site. Past this the summary says it is partial. */
export const MAX_SUMMARY_RESULTS = 5000

const DAY_MS = 24 * 60 * 60 * 1000

export interface MonitoringSummaryView {
  summary:            ExceedanceSummary
  /** The month the reporting year starts in, and what to confirm about that. */
  reportingYearBasis: { startMonth: number; verify: string }
  /** True when the year held more results than were read: the counts are then a floor. */
  truncated:          boolean
}

/** The summary for one site at `nowMs`, or null when the site is not there (or not theirs). */
export async function fetchMonitoringSummary(
  client: SupabaseClient,
  scope: { tenantId: string; facilityId: string },
  nowMs: number,
): Promise<MonitoringSummaryView | null> {
  const [site, limitsRead] = await Promise.all([
    loadSiteContext(client, scope.facilityId),
    client.from('monitoring_limits').select('*')
      .eq('tenant_id', scope.tenantId).eq('facility_id', scope.facilityId).limit(MAX_LIMITS + 1),
  ])
  if (!site) return null
  if (limitsRead.error) throw new Error(limitsRead.error.message)

  const basis = reportingYearBasisFor(site.profile)
  const year = reportingYearFor(new Date(nowMs).toISOString(), basis.startMonth)
  const from = `${year.reportingYearStart}T00:00:00.000Z`
  const before = new Date(Date.parse(`${year.reportingYearEnd}T00:00:00.000Z`) + DAY_MS).toISOString()

  const resultsRead = await client.from('monitoring_results').select('*')
    .eq('tenant_id', scope.tenantId).eq('facility_id', scope.facilityId)
    .gte('sampled_at', from).lt('sampled_at', before)
    .order('sampled_at', { ascending: false }).order('id', { ascending: false })
    .limit(MAX_SUMMARY_RESULTS + 1)
  if (resultsRead.error) throw new Error(resultsRead.error.message)

  const limitRows = limitsRead.data ?? []
  const resultRows = resultsRead.data ?? []
  const truncated = limitRows.length > MAX_LIMITS || resultRows.length > MAX_SUMMARY_RESULTS

  return {
    summary: exceedanceSummary(
      limitRows.slice(0, MAX_LIMITS).map(parseLimitRow),
      resultRows.slice(0, MAX_SUMMARY_RESULTS).map(parseResultRow),
      nowMs,
      { reportingYearStartMonth: basis.startMonth },
    ),
    reportingYearBasis: basis,
    truncated,
  }
}
