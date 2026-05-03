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
  // Same schema, but for the isolation photo (migration 022).
  iso_annotations: unknown[]
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
  // Per-permit token for the worker QR sign-on flow (migration 024).
  // 32 hex chars, populated by a BEFORE INSERT trigger. Anyone with the
  // QR can hit /permit-signon/<token> and self-log in/out — the API
  // server-side validates training + roster before writing. Pre-migration
  // permits and intentionally-unmigrated rows have null and just don't
  // expose a sign-on URL on their printed QR.
  signon_token:                    string | null
  created_at:                      string
  updated_at:                      string
}

// Single-row org-level configuration. Migration 014 created the row;
// migration 018 added the push-dispatch fields used by the Postgres
// auto-trigger.
export interface OrgConfig {
  id:                       1
  work_order_url_template:  string | null
  // Set together with INTERNAL_PUSH_SECRET on the API side. Both
  // null = auto-push triggers no-op silently.
  push_dispatch_url:        string | null
  push_dispatch_secret:     string | null
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

// One-off LOTO data-hygiene operations journal — populated by manual
// scripts run from Supabase SQL Editor (e.g.
// migrations/data_hygiene_snak_king_2026-04-27.sql). The standard audit
// log captures per-row before/after via triggers; this table sits one
// level higher and records "what hygiene op did we do, why, and when."
export type HygieneAction =
  | 'decommission'
  | 'rename'
  | 'note_append'
  | 'fk_repair'
  | 'orphan_detected'
  | 'snapshot'
  | 'error'

export interface HygieneLogRow {
  id:           string
  ran_at:      string
  section:      string                  // e.g. 'section_1', 'section_4_cheese_curl', 'baseline'
  equipment_id: string | null           // null for baseline / summary rows
  action:       HygieneAction
  reason:       string
  detail:       Record<string, unknown> | null
}

// Per-worker training records. Two regulatory anchors covered:
//   • §1910.146(g) — Confined Space roles (entrant / attendant /
//     entry_supervisor / rescuer)
//   • §1910.252(a)(2)(xv) + NFPA 51B — Hot Work roles (hot_work_operator
//     for welders/cutters/grinders; fire_watcher for the dedicated
//     fire-watch role required during AND for ≥60 min after hot work).
// "other" is the catch-all for site-specific certifications.
// Migration 017 (CS roles), extended in migration 019 / app code for HW.
export type TrainingRole =
  | 'entrant'
  | 'attendant'
  | 'entry_supervisor'
  | 'rescuer'
  | 'hot_work_operator'
  | 'fire_watcher'
  | 'other'

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
  // Hot Work lifecycle (migration 019 / Phase 3 trigger). 'work_complete'
  // fires when the supervisor flips the work-done toggle on a hot-work
  // permit (this kicks off the 60-min post-watch timer). 'fire_observed'
  // is the emergency cancel — fans out a high-priority push to every
  // subscriber.
  | 'hot_work.created'
  | 'hot_work.signed'
  | 'hot_work.work_complete'
  | 'hot_work.canceled'
  | 'hot_work.fire_observed'

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

// ── Hot Work (OSHA 1910.252 + NFPA 51B + Cal/OSHA Title 8 §6777) ─────────
// Migration 019. Mirrors the Confined Space lifecycle but the regulatory
// shape is different: no atmospheric tests, fire watch is the central
// concept, and there's a distinct post-work watch period that the CS
// permit doesn't have.

export type HotWorkType =
  | 'welding'
  | 'cutting'
  | 'grinding'
  | 'soldering'
  | 'brazing'
  | 'torch_roof'
  | 'other'

export type HotWorkCancelReason =
  | 'task_complete'
  | 'fire_observed'
  | 'unsafe_condition'
  | 'expired'
  | 'other'

// Pre-work checklist matching the FM Global 7-40 / Cal/OSHA §4848-4853
// shape. Stored as jsonb so v2 can extend without a migration. All keys
// optional in the type so partially-filled forms parse; the validator
// in lib/hotWorkChecklist.ts enforces sign-time completeness.
export interface HotWorkPreChecks {
  combustibles_cleared_35ft?:       boolean
  floor_swept?:                     boolean
  floor_openings_protected?:        boolean
  wall_openings_protected?:         boolean
  sprinklers_operational?:          boolean
  // Required when sprinklers_operational === false. Free-text describing
  // the alternate (e.g. "two ABC extinguishers staged + dedicated watcher").
  alternate_protection_if_no_spr?:  string | null
  ventilation_adequate?:            boolean
  fire_extinguisher_present?:       boolean
  fire_extinguisher_type?:          string | null   // 'ABC' | 'CO2' | etc.
  curtains_or_shields_in_place?:    boolean
  // null when the work doesn't involve gas lines at all.
  gas_lines_isolated?:              boolean | null
  adjacent_areas_notified?:         boolean
  // Triggers the cross-link to a CS permit. When true, the form requires
  // associated_cs_permit_id before sign per §1910.146(f)(15).
  confined_space?:                  boolean
  // Triggers fall-protection downstream (out of scope this build).
  elevated_work?:                   boolean
  // Note that designated_area=true would normally exempt the work from
  // a permit per §1910.252(a)(2)(iii). For v1 we still require the
  // permit so every hot-work job has an audit trail; the flag exists
  // for v2 reporting.
  designated_area?:                 boolean
}

export interface HotWorkPermit {
  id:                          string
  // Human-readable serial HWP-YYYYMMDD-NNNN populated by the BEFORE INSERT
  // trigger from migration 019. Mirrors the CSP- format from migration 011.
  serial:                      string
  work_location:               string
  work_description:            string
  work_types:                  HotWorkType[]
  // Cross-references — both nullable.
  associated_cs_permit_id:     string | null
  equipment_id:                string | null
  work_order_ref:              string | null
  // Time bounding (8h CHECK constraint mirrors CS)
  started_at:                  string
  expires_at:                  string
  // Permit Authorizing Individual per NFPA 51B
  pai_id:                      string
  pai_signature_at:            string | null
  // Personnel rosters. Cal/OSHA §6777 requires fire_watch_personnel to
  // be disjoint from hot_work_operators — enforced in app validation,
  // not in schema.
  hot_work_operators:          string[]
  fire_watch_personnel:        string[]
  fire_watch_signature_at:     string | null
  fire_watch_signature_name:   string | null
  // Pre-work checklist as structured jsonb.
  pre_work_checks:             HotWorkPreChecks
  // Post-work fire watch — supervisor flips work_completed_at on; the
  // permit can't close until now() ≥ work_completed_at + post_watch_minutes.
  // Default 60 min (NFPA 51B floor); per-permit override up to 240.
  work_completed_at:           string | null
  post_watch_minutes:          number
  // Cancel / close-out
  canceled_at:                 string | null
  cancel_reason:               HotWorkCancelReason | null
  cancel_notes:                string | null
  notes:                       string | null
  created_at:                  string
  updated_at:                  string
}

// Human-readable labels for HotWorkType — used in form pickers and
// PDF generation. Mirrors the CONFINED_SPACE labels in
// lib/confinedSpaceLabels.ts (which is where this would live if it
// grew — for now the type is small enough to inline).
export const HOT_WORK_TYPE_LABELS: Record<HotWorkType, string> = {
  welding:    'Welding (arc / gas)',
  cutting:    'Cutting (oxy-fuel / plasma)',
  grinding:   'Grinding',
  soldering:  'Soldering',
  brazing:    'Brazing',
  torch_roof: 'Torch-applied roofing',
  other:      'Other',
}

export const HOT_WORK_CANCEL_REASON_LABELS: Record<HotWorkCancelReason, string> = {
  task_complete:    'Task complete (post-watch elapsed)',
  fire_observed:    'Fire observed — emergency cancel',
  unsafe_condition: 'Unsafe condition (e.g. sprinklers down)',
  expired:          'Time expired',
  other:            'Other',
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
