// Shared filter parser for the Risk Assessment heat map + list views.
// Both views read filter state from URL search params so reload +
// share + browser-history "just work" without lifting state into a
// Provider.
//
// One source of truth here means the heat map's "click cell → drill
// down" handler can hand its filters to /risk/list?... without
// either side reinventing the param shape.

import type { Band } from '@soteria/core/risk'
import type { HazardCategory, RiskStatus, RiskListFilters } from '@soteria/core/queries/risks'

export interface RiskFilterState {
  status:          RiskStatus[]
  hazardCategory:  HazardCategory[]
  band:            Band | null
  view:            'inherent' | 'residual'
  search:          string
  assignedTo:      string | null
  sort:            'created_at' | 'residual_score' | 'inherent_score' | 'next_review_date' | 'risk_number'
  dir:             'asc' | 'desc' | null
  limit:           number
  offset:          number
}

const VALID_STATUSES: RiskStatus[] = ['open','in_review','controls_in_progress','monitoring','closed','accepted_exception']
const VALID_BANDS:    Band[]       = ['low','moderate','high','extreme']
const VALID_CATS:     HazardCategory[] = ['physical','chemical','biological','mechanical','electrical','ergonomic','psychosocial','environmental','radiological']
const VALID_SORTS = ['created_at','residual_score','inherent_score','next_review_date','risk_number'] as const

export function parseRiskFilters(search: URLSearchParams | null): RiskFilterState {
  const safe = search ?? new URLSearchParams()

  const status = (safe.get('status') ?? '')
    .split(',').map(s => s.trim()).filter((s): s is RiskStatus => VALID_STATUSES.includes(s as RiskStatus))

  const hazardCategory = (safe.get('hazard_category') ?? '')
    .split(',').map(s => s.trim()).filter((s): s is HazardCategory => VALID_CATS.includes(s as HazardCategory))

  const bandRaw = safe.get('band')
  const band: Band | null = (bandRaw && VALID_BANDS.includes(bandRaw as Band)) ? bandRaw as Band : null

  const viewRaw = safe.get('view')
  const view: 'inherent' | 'residual' = viewRaw === 'inherent' ? 'inherent' : 'residual'

  const search_ = safe.get('search')?.trim() ?? ''
  const assignedTo = safe.get('assigned_to')?.trim() || null

  const sortRaw = safe.get('sort')
  const sort = (sortRaw && (VALID_SORTS as readonly string[]).includes(sortRaw))
    ? sortRaw as RiskFilterState['sort']
    : 'residual_score'

  const dirRaw = safe.get('dir')
  const dir: RiskFilterState['dir'] = dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : null

  const limit = clampInt(safe.get('limit'), 50, 1, 200)
  const offset = clampInt(safe.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)

  return {
    status, hazardCategory, band, view, search: search_, assignedTo,
    sort, dir, limit, offset,
  }
}

/**
 * Build query-string params for the API based on current filter
 * state. Centralising this means the heat map + list page can both
 * call the same backend without inventing different param names.
 */
export function toApiParams(filters: RiskFilterState): URLSearchParams {
  const out = new URLSearchParams()
  if (filters.status.length > 0)        out.set('status', filters.status.join(','))
  if (filters.hazardCategory.length > 0) out.set('hazard_category', filters.hazardCategory.join(','))
  if (filters.band)                     out.set('band', filters.band)
  if (filters.view !== 'residual')      out.set('view', filters.view)
  if (filters.search)                   out.set('search', filters.search)
  if (filters.assignedTo)               out.set('assigned_to', filters.assignedTo)
  if (filters.sort !== 'residual_score') out.set('sort', filters.sort)
  if (filters.dir)                      out.set('dir', filters.dir)
  if (filters.limit !== 50)             out.set('limit',  String(filters.limit))
  if (filters.offset !== 0)             out.set('offset', String(filters.offset))
  return out
}

/**
 * Build the query-string portion of a URL (no host) preserving only
 * the filter params we care about. Used when the heat map navigates
 * to /risk/list with the same filters applied.
 */
export function toUrlSearch(filters: Partial<RiskFilterState>): string {
  const out = new URLSearchParams()
  if (filters.status?.length)         out.set('status', filters.status.join(','))
  if (filters.hazardCategory?.length) out.set('hazard_category', filters.hazardCategory.join(','))
  if (filters.band)                   out.set('band', filters.band)
  if (filters.view && filters.view !== 'residual') out.set('view', filters.view)
  if (filters.search)                 out.set('search', filters.search)
  if (filters.assignedTo)             out.set('assigned_to', filters.assignedTo)
  return out.toString()
}

/** Convert filter state to the shape `loadRisksFiltered` expects. */
export function toQueryFilters(filters: RiskFilterState): RiskListFilters {
  return {
    status:         filters.status.length ? filters.status : undefined,
    hazardCategory: filters.hazardCategory.length ? filters.hazardCategory : undefined,
    band:           filters.band ?? undefined,
    view:           filters.view,
    search:         filters.search || undefined,
    assignedTo:     filters.assignedTo ?? undefined,
    sort:           filters.sort,
    dir:            filters.dir ?? undefined,
    limit:          filters.limit,
    offset:         filters.offset,
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}
