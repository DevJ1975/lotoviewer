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
  // Photo overlay annotations (migration 015). Array of arrows + labels
  // with relative (0-1) coordinates so they scale with the rendered
  // photo. See lib/photoAnnotations.ts for the schema.
  annotations: unknown[]
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
  // Human-readable serial CSP-YYYYMMDD-NNNN populated by a BEFORE INSERT
  // trigger (migration 011). Used on the printed permit, the QR code,
  // and the status board for traceability.
  serial:                          string
  space_id:                        string
  purpose:                         string
  started_at:                      string
  expires_at:                      string
  canceled_at:                     string | null
  entry_supervisor_id:             string
  entry_supervisor_signature_at:   string | null
  attendants:                      string[]   // names per §(f)(5)
  entrants:                        string[]   // names per §(f)(4)
  hazards_present:                 string[]
  isolation_measures:              string[]   // human-readable lines per §(f)(8)
  acceptable_conditions_override:  AcceptableConditions | null
  rescue_service:                  RescueService
  communication_method:            string | null
  equipment_list:                  string[]
  concurrent_permits:              string | null
  notes:                           string | null
  cancel_reason:                   CancelReason | null
  cancel_notes:                    string | null
  // Multi-party signatures (migration 012). All optional — the entry
  // supervisor signature above is the OSHA-mandated authorization;
  // these strengthen the audit trail when the site requires them.
  attendant_signature_at:          string | null
  attendant_signature_name:        string | null
  entrant_acknowledgement_at:      string | null
  // Free-text reference to the upstream work order (CMMS / WO system).
  // Migration 014. Rendered as a hyperlink when loto_org_config has a
  // work_order_url_template configured.
  work_order_ref:                  string | null
  created_at:                      string
  updated_at:                      string
}

// Single-row org-level configuration (migration 014). One row, id = 1.
export interface OrgConfig {
  id:                       1
  work_order_url_template:  string | null
  updated_at:               string
  updated_by:               string | null
}

// Per-entrant in/out timestamps. §1910.146(i)(4) — the attendant must
// know who is inside the space at any moment. One row per entry/exit
// cycle for one named entrant. exited_at = null while still inside.
export interface ConfinedSpaceEntry {
  id:           string
  permit_id:    string
  entrant_name: string
  entered_at:   string
  exited_at:    string | null
  entered_by:   string                  // attendant profile id
  exited_by:    string | null
  notes:        string | null
  created_at:   string
}

// Calibration / bump-test register for direct-reading meters per
// §1910.146(d)(5)(i). Keyed by free-text instrument_id to match the
// shape we already have on loto_atmospheric_tests.
export interface GasMeter {
  instrument_id:        string
  description:          string | null
  last_bump_at:         string | null
  last_calibration_at:  string | null
  next_calibration_due: string | null
  decommissioned:       boolean
  notes:                string | null
  created_at:           string
  updated_at:           string
}

// Per-worker training records for §1910.146(g) compliance. The four
// canonical roles plus an "other" slot for site-specific certifications
// (e.g. fall-protection, hot-work). Migration 017.
export type TrainingRole = 'entrant' | 'attendant' | 'entry_supervisor' | 'rescuer' | 'other'

export interface TrainingRecord {
  id:             string
  worker_name:    string
  role:           TrainingRole
  completed_at:   string                 // YYYY-MM-DD
  expires_at:     string | null          // null = no expiry
  cert_authority: string | null
  notes:          string | null
  created_by:     string | null
  created_at:     string
  updated_at:     string
}

// Outbound webhook subscription (migration 013). Each row receives the
// events listed in `events[]` whenever the corresponding lifecycle
// transition fires on the permit / test tables.
export type WebhookEvent =
  | 'permit.created'
  | 'permit.signed'
  | 'permit.canceled'
  | 'test.recorded'
  | 'test.failed'

export interface WebhookSubscription {
  id:         string
  name:       string
  url:        string
  // Optional shared secret — when present the dispatcher signs the body
  // with HMAC-SHA256 and adds an X-Soteria-Signature header.
  secret:     string | null
  events:     WebhookEvent[]
  active:     boolean
  created_by: string | null
  created_at: string
  updated_at: string
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
