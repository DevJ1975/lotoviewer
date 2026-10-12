import type { ExceedanceSummary, LimitBasis, LimitKind } from '@soteria/core/environmental/monitoring'
import { api, type Scope } from './complianceClient'

// Browser client for /api/environmental/monitoring/*. The lists come back as table rows
// (snake_case); parseLimitRow and parseResultRow in packages/core read them into the domain
// objects the rest of the screen works with. The summary comes back already as domain objects.

// Type aliases, not interfaces: the core row parsers take a Record<string, unknown>.
export type LimitRecord = {
  id: string; facility_id: string; outfall_id: string | null; permit_id: string | null
  parameter: string; unit: string; limit_kind: LimitKind; value: number; basis: LimitBasis
  citation: string | null; verify: string | null; source: 'library' | 'tenant'; library_key: string | null
  effective_from: string | null; effective_to: string | null
}

export type ResultRecord = {
  id: string; facility_id: string; outfall_id: string | null; parameter: string; unit: string; value: number
  below_detection: boolean; sampled_at: string; event_label: string | null; lab: string | null
  evidence_id: string | null; note: string | null; sampled_by: string | null
}

export interface ResultsPage {
  results:     ResultRecord[]
  /** Pass back to read the next page; null when this was the last. */
  next_cursor: string | null
}

export interface MonitoringSummaryResponse {
  summary:              ExceedanceSummary
  reporting_year_basis: { start_month: number; verify: string }
  /** True when the reporting year held more results than were read: the counts are then a floor. */
  truncated:            boolean
}

const BASE = '/api/environmental/monitoring'

// ── limits ──────────────────────────────────────────────────────────────────
export const listLimits = (scope: Scope) => api<{ limits: LimitRecord[] }>(scope, `${BASE}/limits`)
export const createLimit = (scope: Scope, body: Record<string, unknown>) =>
  api<{ limit: LimitRecord }>(scope, `${BASE}/limits`, { method: 'POST', body })
export const updateLimit = (scope: Scope, id: string, body: Record<string, unknown>) =>
  api<{ limit: LimitRecord }>(scope, `${BASE}/limits/${id}`, { method: 'PATCH', body })
export const deleteLimit = (scope: Scope, id: string) =>
  api<{ ok: true }>(scope, `${BASE}/limits/${id}`, { method: 'DELETE' })
export const adoptDefaults = (scope: Scope, body: { keys: string[]; outfall_id?: string | null }) =>
  api<{ created: number; already_there: number; limits: LimitRecord[] }>(scope, `${BASE}/limits/adopt-defaults`, { method: 'POST', body })

// ── results ─────────────────────────────────────────────────────────────────
export interface ResultsFilter {
  outfallId?: string
  parameter?: string
  cursor?:    string
}

export function listResults(scope: Scope, filter: ResultsFilter = {}) {
  const params = new URLSearchParams()
  if (filter.outfallId) params.set('outfall_id', filter.outfallId)
  if (filter.parameter) params.set('parameter', filter.parameter)
  if (filter.cursor) params.set('cursor', filter.cursor)
  return api<ResultsPage>(scope, `${BASE}/results${params.size ? `?${params}` : ''}`)
}
export const createResult = (scope: Scope, body: Record<string, unknown>) =>
  api<{ result: ResultRecord }>(scope, `${BASE}/results`, { method: 'POST', body })
export const updateResult = (scope: Scope, id: string, body: Record<string, unknown>) =>
  api<{ result: ResultRecord }>(scope, `${BASE}/results/${id}`, { method: 'PATCH', body })
export const deleteResult = (scope: Scope, id: string) =>
  api<{ ok: true }>(scope, `${BASE}/results/${id}`, { method: 'DELETE' })

// ── summary ─────────────────────────────────────────────────────────────────
export const getMonitoringSummary = (scope: Scope) => api<MonitoringSummaryResponse>(scope, `${BASE}/summary`)
