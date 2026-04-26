export interface Equipment {
  equipment_id: string
  description: string
  department: string
  prefix: string | null
  photo_status: 'missing' | 'partial' | 'complete'
  has_equip_photo: boolean
  has_iso_photo: boolean
  equip_photo_url: string | null
  iso_photo_url: string | null
  placard_url: string | null
  signed_placard_url: string | null
  notes: string | null
  notes_es: string | null
  internal_notes: string | null
  spanish_reviewed: boolean
  verified: boolean
  verified_date: string | null
  verified_by: string | null
  needs_equip_photo: boolean
  needs_iso_photo: boolean
  needs_verification: boolean
  decommissioned: boolean
  created_at: string | null
  updated_at: string | null
}

export interface LotoEnergyStep {
  id: string
  equipment_id: string
  energy_type: string
  step_number: number
  tag_description: string | null
  isolation_procedure: string | null
  method_of_verification: string | null
  tag_description_es: string | null
  isolation_procedure_es: string | null
  method_of_verification_es: string | null
}

export interface LotoReview {
  id: string
  department: string
  reviewer_name: string | null
  reviewer_email: string | null
  signed_at: string | null
  approved: boolean
  notes: string | null
  created_at: string
}

export interface DepartmentStats {
  department: string
  total: number
  complete: number
  partial: number
  missing: number
  pct: number
}

export interface Profile {
  id:                   string
  email:                string
  full_name:            string | null
  is_admin:             boolean
  must_change_password: boolean
  created_at:           string
  updated_at:           string
}

// ── Confined Space module (OSHA 29 CFR 1910.146) ────────────────────────────
// Mirrors the schema introduced in migration 009. The split is:
//   ConfinedSpace        — the inventory (one row per physical space)
//   ConfinedSpacePermit  — a single entry permit with the 15 §(f) fields
//   AtmosphericTest      — one reading; many per permit per §(d)(5)
// Photo URLs piggy-back on the existing loto-photos bucket under a
// confined-spaces/{space_id}/... prefix.

export type ConfinedSpaceClassification =
  | 'permit_required'
  | 'non_permit'
  | 'reclassified'

export type ConfinedSpaceType =
  | 'tank' | 'silo' | 'vault' | 'pit' | 'hopper'
  | 'vessel' | 'sump' | 'plenum' | 'manhole' | 'other'

// Atmospheric thresholds. NULL fields fall back to site defaults
// (O2 19.5–23.5%, LEL <10%, H2S <10ppm, CO <35ppm).
export interface AcceptableConditions {
  o2_min?:  number  // % oxygen, default 19.5
  o2_max?:  number  // % oxygen, default 23.5
  lel_max?: number  // % LEL,    default 10
  h2s_max?: number  // ppm,      default 10
  co_max?:  number  // ppm,      default 35
  other?:   Array<{ name: string; unit: string; max: number }>
}

export interface ConfinedSpace {
  space_id:               string
  description:            string
  department:             string
  classification:         ConfinedSpaceClassification
  space_type:             ConfinedSpaceType
  entry_dimensions:       string | null
  known_hazards:          string[]
  acceptable_conditions:  AcceptableConditions | null
  isolation_required:     string | null
  equip_photo_url:        string | null
  interior_photo_url:     string | null
  internal_notes:         string | null
  decommissioned:         boolean
  created_at:             string
  updated_at:             string
}

// Free-form because OSHA doesn't enumerate isolation methods. Common shapes:
//   { type: 'LOTO',        ref: 'EQ-123' }
//   { type: 'ventilation', method: 'forced air' }
//   { type: 'purging',     medium: 'N2' }
//   { type: 'flushing',    medium: 'water' }
export type IsolationMeasure = {
  type:    string
  [key: string]: string | number | boolean | null
}

export interface RescueService {
  name?:         string
  phone?:        string
  eta_minutes?:  number
  equipment?:    string[]
}

export type CancelReason =
  | 'task_complete'
  | 'prohibited_condition'
  | 'expired'
  | 'other'

export interface ConfinedSpacePermit {
  id:                              string
  space_id:                        string
  purpose:                         string
  started_at:                      string
  expires_at:                      string
  canceled_at:                     string | null
  entry_supervisor_id:             string
  entry_supervisor_signature_at:   string | null
  attendants:                      string[]   // profile ids
  entrants:                        string[]   // profile ids
  hazards_present:                 string[]
  isolation_measures:              IsolationMeasure[]
  acceptable_conditions_override:  AcceptableConditions | null
  rescue_service:                  RescueService
  communication_method:            string | null
  equipment_list:                  string[]
  concurrent_permits:              string | null
  notes:                           string | null
  cancel_reason:                   CancelReason | null
  cancel_notes:                    string | null
  created_at:                      string
  updated_at:                      string
}

export type AtmosphericTestKind = 'pre_entry' | 'periodic' | 'post_alarm'

export interface AtmosphericTest {
  id:              string
  permit_id:       string
  tested_at:       string
  tested_by:       string
  o2_pct:          number | null
  lel_pct:         number | null
  h2s_ppm:         number | null
  co_ppm:          number | null
  other_readings:  Array<{ name: string; value: number; unit: string; threshold?: number }>
  instrument_id:   string | null
  kind:            AtmosphericTestKind
  notes:           string | null
  created_at:      string
}
