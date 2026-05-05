// Job Hazard Analysis (JHA) — types + small pure helpers shared
// across web and mobile. Mirrors near-miss/risk module idiom.
//
// JHA breaks a task into ordered steps, identifies hazards in each
// step, and applies controls from the hierarchy of controls. The
// data shape is hierarchical: jha → steps → hazards → controls.

import { HIERARCHY_ORDER, type HierarchyLevel } from './risk'

// ──────────────────────────────────────────────────────────────────────────
// Enums (text-CHECK columns in migration 043)
// ──────────────────────────────────────────────────────────────────────────

export const JHA_HAZARD_CATEGORIES = [
  'physical', 'chemical', 'biological', 'mechanical', 'electrical',
  'ergonomic', 'psychosocial', 'environmental', 'radiological',
] as const
export type JhaHazardCategory = typeof JHA_HAZARD_CATEGORIES[number]

// Same 4-band scheme as near-miss + risk for visual symmetry.
export const JHA_SEVERITY_BANDS = ['low', 'moderate', 'high', 'extreme'] as const
export type JhaSeverity = typeof JHA_SEVERITY_BANDS[number]

export const JHA_FREQUENCIES = [
  'continuous', 'daily', 'weekly', 'monthly', 'quarterly', 'annually', 'as_needed',
] as const
export type JhaFrequency = typeof JHA_FREQUENCIES[number]

export const JHA_STATUSES = ['draft', 'in_review', 'approved', 'superseded'] as const
export type JhaStatus = typeof JHA_STATUSES[number]

// ──────────────────────────────────────────────────────────────────────────
// Row shapes
// ──────────────────────────────────────────────────────────────────────────

export interface JhaRow {
  id:                  string
  tenant_id:           string
  job_number:          string                // JHA-YYYY-NNNN, set by trigger
  title:               string
  description:         string | null
  location:            string | null
  performed_by:        string | null
  frequency:           JhaFrequency
  required_ppe:        string[]
  status:              JhaStatus
  assigned_to:         string | null
  reviewer:            string | null
  approver:            string | null
  approved_at:         string | null
  approved_by:         string | null
  next_review_date:    string | null
  last_reviewed_at:    string | null
  last_reviewed_by:    string | null
  created_at:          string
  updated_at:          string
  created_by:          string
  updated_by:          string | null
}

export interface JhaStep {
  id:          string
  tenant_id:   string
  jha_id:      string
  sequence:    number
  description: string
  notes:       string | null
  created_at:  string
}

export interface JhaHazard {
  id:                 string
  tenant_id:          string
  jha_id:             string
  step_id:            string | null   // null = "general" hazard spanning the job
  hazard_category:    JhaHazardCategory
  description:        string
  potential_severity: JhaSeverity
  notes:              string | null
  created_at:         string
}

export interface JhaHazardControl {
  id:              string
  tenant_id:       string
  jha_id:          string
  hazard_id:       string
  control_id:      string | null   // FK to controls_library
  custom_name:     string | null
  hierarchy_level: HierarchyLevel
  notes:           string | null
  created_at:      string
}

// Bundled detail — what /api/jha/[id] returns (slice 2). Steps,
// hazards, and controls all sit under their parent for easy
// rendering.
export interface JhaDetailBundle {
  jha:      JhaRow
  steps:    JhaStep[]
  hazards:  JhaHazard[]
  controls: JhaHazardControl[]
}

// Shape used by the create / update editor.
export interface JhaCreateInput {
  title:        string
  description?: string | null
  location?:    string | null
  performed_by?: string | null
  frequency:    JhaFrequency
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

// Default review cadence in days, derived from frequency. Matches
// industry guidance: high-cadence tasks reviewed quarterly, daily
// reviewed annually, "as_needed" reviewed every 2 years.
const REVIEW_CADENCE_DAYS: Record<JhaFrequency, number> = {
  continuous: 90,    // continuous → quarterly review
  daily:      365,
  weekly:     365,
  monthly:    365,
  quarterly:  365,
  annually:   730,   // annually-performed tasks reviewed every 2 years
  as_needed:  730,
}

export function jhaReviewCadenceDays(frequency: JhaFrequency): number {
  return REVIEW_CADENCE_DAYS[frequency]
}

// Roll up the hazards' potential severities into a single "worst
// case" band for the JHA header. Empty hazards → null.
export function highestPotentialSeverity(hazards: JhaHazard[]): JhaSeverity | null {
  if (hazards.length === 0) return null
  const rank: Record<JhaSeverity, number> = { extreme: 4, high: 3, moderate: 2, low: 1 }
  let best: JhaSeverity = 'low'
  for (const h of hazards) {
    if (rank[h.potential_severity] > rank[best]) best = h.potential_severity
  }
  return best
}

// Group hazards under their step. Steps without hazards are still
// included (empty array). Hazards with step_id=null land in a
// special 'general' bucket. Returns a stable order keyed by step
// sequence.
export function groupHazardsByStep(
  steps: JhaStep[],
  hazards: JhaHazard[],
): { step: JhaStep | null; hazards: JhaHazard[] }[] {
  const out: { step: JhaStep | null; hazards: JhaHazard[] }[] = []
  const sortedSteps = steps.slice().sort((a, b) => a.sequence - b.sequence)
  for (const s of sortedSteps) {
    out.push({ step: s, hazards: hazards.filter(h => h.step_id === s.id) })
  }
  const general = hazards.filter(h => h.step_id == null)
  if (general.length > 0) out.push({ step: null, hazards: general })
  return out
}

// Group controls under their hazard, ordered by hierarchy level
// (highest-impact first: elimination → substitution → engineering →
// administrative → ppe). Powers the print/detail view.
export function groupControlsByHazard(
  hazards: JhaHazard[],
  controls: JhaHazardControl[],
): Map<string, JhaHazardControl[]> {
  const out = new Map<string, JhaHazardControl[]>()
  for (const h of hazards) {
    const matching = controls
      .filter(c => c.hazard_id === h.id)
      .slice()
      .sort((a, b) => HIERARCHY_ORDER.indexOf(a.hierarchy_level) - HIERARCHY_ORDER.indexOf(b.hierarchy_level))
    out.set(h.id, matching)
  }
  return out
}

// Roll up every PPE-level control across the JHA into a deduped,
// sorted list. Used to populate jhas.required_ppe at save-time so
// the print view doesn't have to re-aggregate.
export function aggregateRequiredPpe(controls: JhaHazardControl[]): string[] {
  const set = new Set<string>()
  for (const c of controls) {
    if (c.hierarchy_level !== 'ppe') continue
    const name = c.custom_name?.trim() || ''
    if (name) set.add(name)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

// PPE-alone heuristic (UX warning, not a DB constraint — per the
// migration's notes, JHAs legitimately capture "PPE today,
// engineering control coming Q3"). Returns the count of hazards
// where `potential_severity` is high or extreme AND every linked
// control has hierarchy_level='ppe'. Editor surfaces the count
// inline; the user can override.
export function countPpeAloneWarnings(
  hazards: JhaHazard[],
  controls: JhaHazardControl[],
): number {
  let n = 0
  for (const h of hazards) {
    if (h.potential_severity !== 'high' && h.potential_severity !== 'extreme') continue
    const linked = controls.filter(c => c.hazard_id === h.id)
    if (linked.length === 0) continue                    // no controls = different problem
    if (linked.every(c => c.hierarchy_level === 'ppe')) n++
  }
  return n
}

// Validate a create-input payload. Returns null if valid, error
// string otherwise. Mirrors the near-miss validator but renamed
// so consumers using the barrel re-export get an unambiguous
// import.
export function validateJhaCreateInput(input: Partial<JhaCreateInput>): string | null {
  if (!input.title || !input.title.trim()) return 'Title is required'
  if (!input.frequency) return 'Frequency is required'
  if (!(JHA_FREQUENCIES as readonly string[]).includes(input.frequency))
    return `Invalid frequency: ${input.frequency}`
  return null
}
