// Shared contract for the multi-agent LOTO audit: the three agents' structured
// output schemas + the parsed result types + the DB-row DTOs. Everything that
// talks about an audit — the engine, the API routes, the review UI — imports
// from here so the shape is defined once.
//
// The JSON schemas feed Anthropic's structured-output path
// (output_config.format.json_schema). Per that path's rules, EVERY object sets
// additionalProperties:false and lists all its properties as required (see the
// proven pattern in app/api/generate-loto-steps/route.ts).

export type AuditConfidence = 'high' | 'medium' | 'low'
export type PhotoVerdict    = 'match' | 'mismatch' | 'low_confidence' | 'missing'
export type AuditSeverity   = 'info' | 'low' | 'medium' | 'high' | 'critical'

// ── Agent 1: Food-Production-Engineer (vision) ──────────────────────────────

export interface FpeResult {
  equip_photo: {
    verdict:    PhotoVerdict
    confidence: AuditConfidence
    notes:      string
  }
  iso_photo: {
    verdict:                      PhotoVerdict
    confidence:                   AuditConfidence
    shows_isolation_point:        boolean
    consistent_with_energy_steps: boolean
    notes:                        string
  }
}

export const FPE_SCHEMA = {
  type: 'object',
  properties: {
    equip_photo: {
      type: 'object',
      properties: {
        verdict:    { type: 'string', enum: ['match', 'mismatch', 'low_confidence', 'missing'] },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        notes:      { type: 'string', description: 'One sentence on what the equipment photo does/does not show.' },
      },
      required: ['verdict', 'confidence', 'notes'],
      additionalProperties: false,
    },
    iso_photo: {
      type: 'object',
      properties: {
        verdict:                      { type: 'string', enum: ['match', 'mismatch', 'low_confidence', 'missing'] },
        confidence:                   { type: 'string', enum: ['high', 'medium', 'low'] },
        shows_isolation_point:        { type: 'boolean', description: 'True if the photo clearly shows a real energy-isolation / lockout point.' },
        consistent_with_energy_steps: { type: 'boolean', description: 'True if the isolation point shown matches the equipment’s documented energy steps.' },
        notes:                        { type: 'string' },
      },
      required: ['verdict', 'confidence', 'shows_isolation_point', 'consistent_with_energy_steps', 'notes'],
      additionalProperties: false,
    },
  },
  required: ['equip_photo', 'iso_photo'],
  additionalProperties: false,
} as const

// ── Storage photo search (re-uses the FPE vision pass) ──────────────────────
// Verdict for ONE stored candidate image when searching the tenant's own
// `loto-photos` folder for a real isolation photo before the web placeholder.
// Single-image, single-question — narrower than FpeResult, which judges two
// photos at once.

export interface IsoMatchResult {
  is_isolation_point: boolean
  confidence:         AuditConfidence
  notes:              string
}

export const ISO_MATCH_SCHEMA = {
  type: 'object',
  properties: {
    is_isolation_point: { type: 'boolean', description: 'True only if the image clearly shows a real energy-isolation / lockout point plausibly belonging to this equipment.' },
    confidence:         { type: 'string', enum: ['high', 'medium', 'low'] },
    notes:              { type: 'string', description: 'One factual sentence on what the image shows.' },
  },
  required: ['is_isolation_point', 'confidence', 'notes'],
  additionalProperties: false,
} as const

// ── Agent 2: Data-Scientist (consistency) ───────────────────────────────────

export interface DsStepAssessment {
  step_id:    string
  confidence: AuditConfidence
  issue:      string  // '' when none
}

export interface DsResult {
  equipment_confidence: AuditConfidence
  low_confidence_iso:   boolean
  steps:                DsStepAssessment[]
  duplicates:           string[]
  outliers:             string[]
  notes:                string
}

export const DS_SCHEMA = {
  type: 'object',
  properties: {
    equipment_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    low_confidence_iso:   { type: 'boolean', description: 'True if the isolation point should be treated as low-confidence (triggers a reference-placeholder photo).' },
    steps: {
      type: 'array',
      description: 'One assessment per energy step.',
      items: {
        type: 'object',
        properties: {
          step_id:    { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          issue:      { type: 'string', description: 'Short description of the inconsistency, or empty string if none.' },
        },
        required: ['step_id', 'confidence', 'issue'],
        additionalProperties: false,
      },
    },
    duplicates: { type: 'array', items: { type: 'string' }, description: 'step_ids that duplicate another step.' },
    outliers:   { type: 'array', items: { type: 'string' }, description: 'step_ids whose energy_type or text looks anomalous for this equipment.' },
    notes:      { type: 'string' },
  },
  required: ['equipment_confidence', 'low_confidence_iso', 'steps', 'duplicates', 'outliers', 'notes'],
  additionalProperties: false,
} as const

// ── Agent 3: Senior EHS Specialist (Cal/OSHA gate) ──────────────────────────

export interface EhsCitation {
  code:     string
  text:     string
  severity: AuditSeverity
}

export interface EhsResult {
  pass:            boolean
  citations:       EhsCitation[]
  recommendations: string[]
  notes:           string
}

export const EHS_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'True only if the procedure meets Cal/OSHA T8 §3314 + 1910.147 for documented energy control.' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code:     { type: 'string', description: 'e.g. "Cal/OSHA T8 §3314(g)(2)" or "29 CFR 1910.147(c)(4)(ii)".' },
          text:     { type: 'string' },
          severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
        },
        required: ['code', 'text', 'severity'],
        additionalProperties: false,
      },
    },
    recommendations: { type: 'array', items: { type: 'string' } },
    notes:           { type: 'string' },
  },
  required: ['pass', 'citations', 'recommendations', 'notes'],
  additionalProperties: false,
} as const

// ── DB-row DTOs (mirror migrations 218/219) ─────────────────────────────────

export type AuditRunStatus =
  | 'running' | 'awaiting_review' | 'partially_applied' | 'applied' | 'failed' | 'cancelled'

export type AuditAgentPhase = 'pending' | 'fpe_done' | 'ds_done' | 'ehs_done' | 'error'

export type AuditChangeKind =
  | 'step_field_edit' | 'step_confidence' | 'equipment_field_edit'
  | 'photo_provenance' | 'placeholder_photo' | 'ehs_finding'

export type AuditChangeStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'superseded'

export interface LotoAuditRun {
  id:                  string
  tenant_id:           string
  status:              AuditRunStatus
  scope:               { department?: string; equipment_ids?: string[]; only_active?: boolean; limit?: number }
  total_equipment:     number
  processed_equipment: number
  models:              Record<string, string> | null
  review_link_id:      string | null
  created_by:          string | null
  started_at:          string
  finished_at:         string | null
  error:               string | null
}

export interface LotoAuditChange {
  id:                  string
  run_id:              string
  tenant_id:           string
  equipment_id:        string
  change_kind:         AuditChangeKind
  target_table:        'loto_energy_steps' | 'loto_equipment'
  target_row_pk:       string | null
  target_column:       string | null
  old_value:           unknown
  new_value:           unknown
  agent:               'FPE' | 'DS' | 'EHS' | 'SSD'
  rationale:           string
  severity:            AuditSeverity | null
  status:              AuditChangeStatus
  staged_storage_path: string | null
  staged_photo_url:    string | null
  decided_by:          string | null
  decided_at:          string | null
  decided_note:        string | null
  applied_at:          string | null
  apply_error:         string | null
  created_at:          string
}

// Columns the apply RPC's whitelist accepts. Kept here so the engine proposes
// only changes the DB will actually apply (illegal columns RAISE in the RPC).
export const EDITABLE_STEP_COLUMNS = [
  'tag_description', 'isolation_procedure', 'method_of_verification',
  'tag_description_es', 'isolation_procedure_es', 'method_of_verification_es',
] as const

export const EDITABLE_EQUIPMENT_COLUMNS = [
  'description', 'notes', 'notes_es', 'internal_notes', 'manufacturer', 'model', 'department',
] as const
