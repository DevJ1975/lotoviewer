// Incident Classification Matrix — pure 5×5 lookup keyed by
// severity × probability. Used by the triage UI to surface a band
// label ("S4×P4 — High") and an SLA target the assigned investigator
// should beat.
//
// Phase 1 ships the matrix only. The OSHA recordability decision tree
// lives in this same file (skeleton) and is fleshed out in Phase 4
// when the classify route + AI suggestion arrive — keeping it here
// means the lookup tables stay co-located with the matrix.

import type {
  IncidentSeverityActual,
  IncidentSeverityPotential,
  IncidentProbability,
} from './incident'

// ──────────────────────────────────────────────────────────────────────────
// 5×5 Severity × Probability matrix
// ──────────────────────────────────────────────────────────────────────────
//
// Bands follow ISO 31000 conventions:
//   1–4   Low      blue     no SLA — review at next safety committee
//   5–9   Moderate yellow   investigate within 5 business days
//   10–14 High     orange   investigate within 24 hours
//   15+   Extreme  red      investigate immediately + notify execs

const SEVERITY_SCORES: Record<IncidentSeverityPotential, 1 | 2 | 3 | 4 | 5> = {
  low: 2, moderate: 3, high: 4, extreme: 5,
}

const PROBABILITY_SCORES: Record<IncidentProbability, 1 | 2 | 3 | 4 | 5> = {
  rare: 1, unlikely: 2, possible: 3, likely: 4, almost_certain: 5,
}

export type MatrixBand = 'low' | 'moderate' | 'high' | 'extreme'

export interface MatrixCell {
  /** Stable label persisted to incidents.classification_matrix_cell.
   *  Format: `S{severity}xP{probability}_{band}`, e.g. `S4xP4_high`. */
  cell:     string
  band:     MatrixBand
  score:    number
  /** Tailwind background utility — `bg-rose-500` etc. — used by the
   *  pill component on the incident detail page. */
  pillBg:   string
  pillText: string
  /** SLA target in hours from reported_at to status='investigating'.
   *  null = no SLA. The escalation cron uses this if the rule has no
   *  explicit escalation_minutes override. */
  slaHours: number | null
}

function bandFor(score: number): MatrixBand {
  if (score >= 15) return 'extreme'
  if (score >= 10) return 'high'
  if (score >= 5)  return 'moderate'
  return 'low'
}

const BAND_STYLE: Record<MatrixBand, { pillBg: string; pillText: string; slaHours: number | null }> = {
  low:      { pillBg: 'bg-emerald-100',  pillText: 'text-emerald-900', slaHours: null },
  moderate: { pillBg: 'bg-amber-200',    pillText: 'text-amber-950',   slaHours: 120 },
  high:     { pillBg: 'bg-orange-500',   pillText: 'text-white',       slaHours: 24 },
  extreme:  { pillBg: 'bg-rose-600',     pillText: 'text-white',       slaHours: 1 },
}

export function classifyMatrix(
  severity: IncidentSeverityPotential,
  probability: IncidentProbability,
): MatrixCell {
  const sev  = SEVERITY_SCORES[severity]
  const prob = PROBABILITY_SCORES[probability]
  const score = sev * prob
  const band  = bandFor(score)
  const style = BAND_STYLE[band]
  return {
    cell:  `S${sev}xP${prob}_${band}`,
    band, score,
    pillBg:   style.pillBg,
    pillText: style.pillText,
    slaHours: style.slaHours,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// OSHA recordability decision tree — Phase 4 surface, skeleton here.
// ──────────────────────────────────────────────────────────────────────────
//
// Implements 29 CFR 1904.7 — "Determining whether an injury or
// illness is recordable". Phase 1 only needs the type signatures so
// the API route can be stubbed; the actual decision logic lands in
// Phase 4. The decision path is recorded to `incident_classifications`
// so the wizard answers are auditable forever.

export interface RecordabilityAnswers {
  is_work_related:                boolean
  is_new_case:                    boolean
  resulted_in_death:              boolean
  resulted_in_days_away:          boolean
  days_away_count?:               number
  resulted_in_restricted_duty:    boolean
  days_restricted_count?:         number
  loss_of_consciousness:          boolean
  medical_treatment_beyond_first_aid: boolean
  significant_diagnosed_condition: boolean
}

export type OshaClassification =
  | 'death'
  | 'days_away'
  | 'restricted'
  | 'other_recordable'
  | null  // not recordable

export interface RecordabilityDecision {
  recordable:     boolean
  classification: OshaClassification
  /** Ordered Q&A path the wizard walked. Persisted to
   *  incident_classifications.decision_path for audit. */
  path: Array<{ question: string; answer: 'yes' | 'no' | 'n/a'; reason?: string }>
}

// First-aid list per 1904.7(b)(5)(ii) — treatments that do NOT count
// as medical treatment. Anything outside this list is medical treatment
// for OSHA purposes. Exported so the wizard can surface the canonical
// list to the classifier.
export const FIRST_AID_TREATMENTS: ReadonlyArray<string> = [
  'non_prescription_medication_at_non_prescription_strength',
  'tetanus_immunization',
  'cleaning_flushing_or_soaking_surface_wounds',
  'wound_coverings',
  'hot_or_cold_therapy',
  'non_rigid_means_of_support',
  'temporary_immobilization_during_transport',
  'drilling_fingernail_or_toenail',
  'eye_patches',
  'irrigation_or_cotton_swab_to_remove_foreign_body_eye',
  'irrigation_or_tweezers_to_remove_splinters_skin',
  'finger_guards',
  'massages',
  'drinking_fluids_for_heat_relief',
]

export function firstAidVsMedical(treatments: ReadonlyArray<string>): 'first_aid' | 'medical' {
  // If every treatment is on the first-aid list, it's first-aid only.
  // Anything else (stitches, prescription drugs, chiropractic
  // adjustment, etc.) elevates to medical treatment.
  for (const t of treatments) {
    if (!FIRST_AID_TREATMENTS.includes(t)) return 'medical'
  }
  return 'first_aid'
}

// Phase 1 stub — returns "needs Phase 4 implementation". The Phase 4
// migration will replace the body with the full decision tree; the
// signature is fixed now so callers can be written against it.
export function decideRecordability(_answers: RecordabilityAnswers): RecordabilityDecision {
  return {
    recordable: false,
    classification: null,
    path: [{
      question: 'OSHA recordability classifier not yet implemented',
      answer:   'n/a',
      reason:   'Ships in Phase 4 — Phase 1 only persists raw answers for audit.',
    }],
  }
}

// Convenience — derive an OSHA classification from severity_actual
// without running the full decision tree. The classify wizard in
// Phase 4 will override this with the full Q&A flow; Phase 1 uses it
// for the "preview your likely classification" hint on the intake.
export function previewClassificationFromSeverity(
  severity: IncidentSeverityActual,
): OshaClassification {
  switch (severity) {
    case 'fatality':
    case 'catastrophic':
      return 'death'
    case 'lost_time':
      return 'days_away'
    case 'medical':
      return 'other_recordable'
    case 'first_aid':
    case 'none':
    default:
      return null
  }
}
