import type { SupabaseClient } from '@supabase/supabase-js'
import type { Band, HierarchyLevel } from '../risk'

// Shared Risk Assessment query helpers. Take a SupabaseClient so the
// same code works server-side (authenticated user, RLS-scoped) and
// admin-side (service role, RLS-bypass for cron / analytics jobs).
//
// All return shapes are JSON-serializable so they can flow through
// the API → page boundary unchanged.

// ──────────────────────────────────────────────────────────────────────────
// Types — narrowed for the views in this slice
// ──────────────────────────────────────────────────────────────────────────

export type RiskStatus =
  | 'open'
  | 'in_review'
  | 'controls_in_progress'
  | 'monitoring'
  | 'closed'
  | 'accepted_exception'

export type HazardCategory =
  | 'physical'
  | 'chemical'
  | 'biological'
  | 'mechanical'
  | 'electrical'
  | 'ergonomic'
  | 'psychosocial'
  | 'environmental'
  | 'radiological'

export interface RiskSummary {
  id:                   string
  risk_number:          string
  title:                string
  hazard_category:      HazardCategory
  status:               RiskStatus
  inherent_severity:    number
  inherent_likelihood:  number
  inherent_score:       number
  inherent_band:        Band
  residual_severity:    number | null
  residual_likelihood:  number | null
  residual_score:       number | null
  residual_band:        Band | null
  assigned_to:          string | null
  next_review_date:     string | null
  created_at:           string
  updated_at:           string
}

export interface RiskDetail extends RiskSummary {
  description:          string
  source:               string
  source_ref_id:        string | null
  location:             string | null
  process:              string | null
  activity_type:        string
  affected_personnel:   Record<string, boolean>
  exposure_frequency:   string
  ppe_only_justification: string | null
  reviewer:             string | null
  approver:             string | null
  last_reviewed_at:     string | null
  last_reviewed_by:     string | null
}

export interface RiskControl {
  id:                  string
  hierarchy_level:     HierarchyLevel
  control_id:          string | null
  custom_name:         string | null
  // Joined from controls_library when control_id is set.
  library_name:        string | null
  status:              'planned' | 'implemented' | 'verified' | 'superseded'
  notes:               string | null
  implemented_at:      string | null
  verified_at:         string | null
  created_at:          string
}

export interface RiskReviewRow {
  id:                        string
  reviewed_at:               string
  reviewed_by:               string
  trigger:                   'cadence' | 'incident' | 'moc' | 'audit' | 'worker_report' | 'regulatory' | 'manual'
  inherent_score_at_review:  number | null
  residual_score_at_review:  number | null
  outcome:                   'no_change' | 'rescored' | 'controls_updated' | 'closed' | 'escalated'
  notes:                     string | null
}

export interface RiskAuditEntry {
  id:           number
  event_type:   'insert' | 'update' | 'delete'
  actor_id:     string | null
  actor_email:  string | null
  context:      string | null
  occurred_at:  string
  // before_row/after_row are kept on the server for the diff
  // computation but the timeline only needs a small summary on
  // the client.
  summary:      string
}

// ──────────────────────────────────────────────────────────────────────────
// List filters
// ──────────────────────────────────────────────────────────────────────────

export interface RiskListFilters {
  status?:           RiskStatus[]
  band?:             Band
  hazardCategory?:   HazardCategory[]
  assignedTo?:       string
  search?:           string
  /**
   * Which band the `band` filter targets. Default 'residual' matches
   * the residual_band column; 'inherent' targets inherent_band.
   */
  view?:             'inherent' | 'residual'
  sort?:             'created_at' | 'residual_score' | 'inherent_score' | 'next_review_date' | 'risk_number'
  dir?:              'asc' | 'desc'
  limit?:            number
  offset?:           number
}

const SUMMARY_COLUMNS = [
  'id',
  'risk_number',
  'title',
  'hazard_category',
  'status',
  'inherent_severity',
  'inherent_likelihood',
  'inherent_score',
  'inherent_band',
  'residual_severity',
  'residual_likelihood',
  'residual_score',
  'residual_band',
  'assigned_to',
  'next_review_date',
  'created_at',
  'updated_at',
].join(',')

export async function loadRisksFiltered(
  supabase: SupabaseClient,
  filters: RiskListFilters,
): Promise<{ risks: RiskSummary[]; total: number }> {
  const limit  = Math.max(1, Math.min(200, filters.limit ?? 50))
  const offset = Math.max(0, filters.offset ?? 0)
  const view   = filters.view ?? 'residual'
  const sort   = filters.sort ?? 'residual_score'
  // Default direction depends on the sort field — score sorts go
  // desc (highest impact first) and date sorts go asc (oldest /
  // soonest review first).
  const dir = filters.dir ?? (
    sort === 'next_review_date' || sort === 'risk_number' || sort === 'created_at'
      ? (sort === 'created_at' ? 'desc' : 'asc')
      : 'desc'
  )

  let query = supabase
    .from('risks')
    .select(SUMMARY_COLUMNS, { count: 'exact' })
    .order(sort, { ascending: dir === 'asc', nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (filters.status && filters.status.length > 0) {
    query = query.in('status', filters.status)
  }
  if (filters.hazardCategory && filters.hazardCategory.length > 0) {
    query = query.in('hazard_category', filters.hazardCategory)
  }
  if (filters.assignedTo) {
    query = query.eq('assigned_to', filters.assignedTo)
  }
  if (filters.band) {
    const bandCol = view === 'inherent' ? 'inherent_band' : 'residual_band'
    query = query.eq(bandCol, filters.band)
  }
  if (filters.search) {
    // ILIKE on title OR risk_number. PostgREST's `or` filter takes
    // an inline list of conditions; we URL-encode the wildcard.
    const safe = filters.search.replace(/[,%()]/g, '')
    query = query.or(`title.ilike.%${safe}%,risk_number.ilike.%${safe}%`)
  }

  const { data, error, count } = await query
  if (error) throw new Error(`loadRisksFiltered: ${error.message}`)
  return {
    risks: (data ?? []) as unknown as RiskSummary[],
    total: count ?? 0,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Heatmap aggregate
// ──────────────────────────────────────────────────────────────────────────

export type HeatmapView = 'inherent' | 'residual'

export interface HeatmapFilters {
  hazardCategory?: HazardCategory[]
  status?:         RiskStatus[]
}

/**
 * Aggregate count of risks per (severity, likelihood) cell for the
 * 5×5 grid. Returns an object keyed "S,L" (e.g. "3,4" = severity 3,
 * likelihood 4); missing keys are zero (no risks at that cell).
 *
 * For 'residual' view: rows where either residual_* is NULL are
 * excluded — they have no cell to land in. The list view exposes
 * those via a separate filter.
 */
export async function loadHeatmapCells(
  supabase: SupabaseClient,
  view:     HeatmapView,
  filters:  HeatmapFilters = {},
): Promise<{ cells: Record<string, number>; total: number }> {
  const sevCol  = view === 'inherent' ? 'inherent_severity'   : 'residual_severity'
  const likeCol = view === 'inherent' ? 'inherent_likelihood' : 'residual_likelihood'

  let query = supabase
    .from('risks')
    .select(`${sevCol}, ${likeCol}`)
  if (view === 'residual') {
    query = query.not(sevCol, 'is', null).not(likeCol, 'is', null)
  }
  if (filters.status && filters.status.length > 0) {
    query = query.in('status', filters.status)
  }
  if (filters.hazardCategory && filters.hazardCategory.length > 0) {
    query = query.in('hazard_category', filters.hazardCategory)
  }
  const { data, error } = await query
  if (error) throw new Error(`loadHeatmapCells: ${error.message}`)

  const cells: Record<string, number> = {}
  let total = 0
  for (const row of (data ?? []) as Array<Record<string, number | null>>) {
    const s = row[sevCol]
    const l = row[likeCol]
    if (s == null || l == null) continue
    const key = `${s},${l}`
    cells[key] = (cells[key] ?? 0) + 1
    total += 1
  }
  return { cells, total }
}

// ──────────────────────────────────────────────────────────────────────────
// Detail load
// ──────────────────────────────────────────────────────────────────────────

export interface RiskDetailBundle {
  risk:     RiskDetail
  controls: RiskControl[]
  reviews:  RiskReviewRow[]
  audit:    RiskAuditEntry[]
}

export async function loadRiskDetail(
  supabase: SupabaseClient,
  id: string,
): Promise<RiskDetailBundle | null> {
  const [riskRes, controlsRes, reviewsRes, auditRes] = await Promise.all([
    supabase.from('risks').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('risk_controls')
      .select('id, hierarchy_level, control_id, custom_name, status, notes, implemented_at, verified_at, created_at, controls_library(name)')
      .eq('risk_id', id)
      .order('hierarchy_level', { ascending: true })
      .order('created_at',      { ascending: true }),
    supabase
      .from('risk_reviews')
      .select('id, reviewed_at, reviewed_by, trigger, inherent_score_at_review, residual_score_at_review, outcome, notes')
      .eq('risk_id', id)
      .order('reviewed_at', { ascending: false })
      .limit(50),
    supabase
      .from('risk_audit_log')
      .select('id, event_type, actor_id, actor_email, context, occurred_at, before_row, after_row')
      .eq('risk_id', id)
      .order('occurred_at', { ascending: false })
      .limit(20),
  ])

  if (riskRes.error) throw new Error(`loadRiskDetail.risk: ${riskRes.error.message}`)
  if (!riskRes.data) return null
  if (controlsRes.error) throw new Error(`loadRiskDetail.controls: ${controlsRes.error.message}`)
  if (reviewsRes.error)  throw new Error(`loadRiskDetail.reviews: ${reviewsRes.error.message}`)
  if (auditRes.error)    throw new Error(`loadRiskDetail.audit: ${auditRes.error.message}`)

  // Flatten the controls_library join into library_name.
  type ControlRow = RiskControl & { controls_library?: { name?: string } | null }
  const controls: RiskControl[] = ((controlsRes.data ?? []) as unknown as ControlRow[]).map(c => ({
    id:               c.id,
    hierarchy_level:  c.hierarchy_level,
    control_id:       c.control_id,
    custom_name:      c.custom_name,
    library_name:     c.controls_library?.name ?? null,
    status:           c.status,
    notes:            c.notes,
    implemented_at:   c.implemented_at,
    verified_at:      c.verified_at,
    created_at:       c.created_at,
  }))

  return {
    risk:     riskRes.data as unknown as RiskDetail,
    controls,
    reviews:  (reviewsRes.data ?? []) as unknown as RiskReviewRow[],
    audit:    ((auditRes.data ?? []) as unknown as Array<RiskAuditEntry & { before_row: Record<string, unknown> | null; after_row: Record<string, unknown> | null }>).map(a => ({
      id:           a.id,
      event_type:   a.event_type,
      actor_id:     a.actor_id,
      actor_email:  a.actor_email,
      context:      a.context,
      occurred_at:  a.occurred_at,
      summary:      summarizeAudit(a.event_type, a.before_row, a.after_row),
    })),
  }
}

/**
 * Tiny diff summarizer for the audit timeline. Renders a short
 * human-readable description of what changed in an UPDATE event.
 * INSERT / DELETE produce single-line summaries.
 */
function summarizeAudit(
  eventType: 'insert' | 'update' | 'delete',
  before:    Record<string, unknown> | null,
  after:     Record<string, unknown> | null,
): string {
  if (eventType === 'insert') return 'Risk created'
  if (eventType === 'delete') return 'Risk deleted'
  if (!before || !after) return 'Risk updated'

  const interesting = [
    'status', 'inherent_severity', 'inherent_likelihood',
    'residual_severity', 'residual_likelihood',
    'assigned_to', 'reviewer', 'approver', 'next_review_date',
    'ppe_only_justification', 'description', 'title',
  ]
  const changes: string[] = []
  for (const k of interesting) {
    if (before[k] !== after[k]) {
      const beforeStr = String(before[k] ?? '∅').slice(0, 40)
      const afterStr  = String(after[k]  ?? '∅').slice(0, 40)
      changes.push(`${k}: ${beforeStr} → ${afterStr}`)
    }
  }
  if (changes.length === 0) return 'Risk updated (no tracked-field changes)'
  if (changes.length === 1) return changes[0]!
  return `${changes[0]!} (+${changes.length - 1} more)`
}
