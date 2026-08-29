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

// ── Author agent: corrected-procedure drafter ───────────────────────────────
// Drafts a corrected, machine-specific energy-control procedure for a non-
// compliant machine. It is NEVER the authority — every draft is staged as a
// `procedure_draft` change for a qualified safety professional to review, edit,
// and sign through the audit review link before it can touch live steps.
//
// energy_type is intentionally NOT enum-constrained: the canonical code set
// (packages/core/energyCodes.ts) is broad and evolves, and the prompt feeds the
// model the live table — an enum here would silently drift. step_type IS
// constrained to the five OSHA phases the placard + validateProcedure key on.

export type AuthorStepType = 'shutdown' | 'isolate' | 'release_stored_energy' | 'lockout' | 'verify_zero_energy'

export interface AuthorStep {
  energy_type:               string
  step_type:                 AuthorStepType
  tag_description:           string
  isolation_procedure:       string
  method_of_verification:    string
  // Spanish parity: every placard renders bilingually (EN/ES), so a corrected
  // draft MUST carry the matching Spanish text — otherwise the ES side of the
  // placard would blank out when the draft is applied. These are faithful
  // translations of the EN fields above, keeping the literal "[VERIFY ON SITE:
  // …]" marker token (in English) so unverified items stay detectable in both
  // languages.
  tag_description_es:        string
  isolation_procedure_es:    string
  method_of_verification_es: string
}

export interface AuthorResult {
  steps:   AuthorStep[]
  summary: string
}

export const AUTHOR_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      // minItems is load-bearing, not decorative: applying a draft replaces the
      // machine's entire step set, so an empty array deletes the procedure.
      // runAuthorAgent re-checks this at runtime — the schema is the first gate,
      // not the only one.
      minItems: 1,
      description: 'The corrected procedure: one step per independent energy source, ordered shutdown → isolate → release stored energy → lockout → verify zero energy. At least one step is required.',
      items: {
        type: 'object',
        properties: {
          energy_type: {
            type: 'string',
            description: 'Energy-source code from the facility table provided in the prompt (e.g. E, P, H, T). Use the code that best fits the source; do not invent codes.',
          },
          step_type: {
            type: 'string',
            enum: ['shutdown', 'isolate', 'release_stored_energy', 'lockout', 'verify_zero_energy'],
            description: 'Which OSHA energy-control phase this step belongs to.',
          },
          tag_description: {
            type: 'string',
            description: 'The specific energy source and its physical location. When the exact site identifier (disconnect/panel/breaker ID, valve tag, gauge ID, location) is NOT derivable from the given data, emit a literal "[VERIFY ON SITE: <what to confirm>]" placeholder — never fabricate an identifier.',
          },
          isolation_procedure: {
            type: 'string',
            description: 'Physical isolation action, lock/tag attachment point, and any stored-energy bleed/release. Use the same "[VERIFY ON SITE: <...>]" placeholder for any unknown site-specific detail.',
          },
          method_of_verification: {
            type: 'string',
            description: 'Concrete zero-energy test performed before work begins (meter reading, attempted start, gauge check, blocking-pin confirmation). Use "[VERIFY ON SITE: <...>]" for any unknown detail.',
          },
          tag_description_es: {
            type: 'string',
            description: 'Professional Spanish (es-MX) translation of tag_description, matching the register of the existing bilingual placards. Mirror any "[VERIFY ON SITE: <...>]" marker verbatim — keep that English token so unverified items stay detectable in both languages.',
          },
          isolation_procedure_es: {
            type: 'string',
            description: 'Spanish (es-MX) translation of isolation_procedure, carrying the same "[VERIFY ON SITE: <...>]" markers as the English field.',
          },
          method_of_verification_es: {
            type: 'string',
            description: 'Spanish (es-MX) translation of method_of_verification, carrying the same "[VERIFY ON SITE: <...>]" markers as the English field.',
          },
        },
        required: ['energy_type', 'step_type', 'tag_description', 'isolation_procedure', 'method_of_verification', 'tag_description_es', 'isolation_procedure_es', 'method_of_verification_es'],
        additionalProperties: false,
      },
    },
    summary: {
      type: 'string',
      description: 'One short paragraph for the reviewing safety professional: what was corrected versus the deficient procedure and which items still need on-site verification.',
    },
  },
  required: ['steps', 'summary'],
  additionalProperties: false,
} as const

// ── Cal/OSHA Regulator (post-audit review) ──────────────────────────────────
// A veteran Cal/OSHA compliance officer (CSHO) re-reviews the internal EHS
// verdict adversarially — concurring or dissenting — and an end-to-end program
// audit over the whole run. Like every other agent it NEVER writes live data:
// its critique is staged for the existing human review gate, and its corrections
// flow back through the EHS-correction → re-emit path.

export interface RegulatorMachineResult {
  // The inspector's stance on the internal EHS pass/fail. Made explicit (not
  // inferred from the citation list) so a dissent is unambiguous.
  concurs_with_ehs:       boolean
  additional_citations:   EhsCitation[]
  severity_escalations:   { code: string; from: AuditSeverity; to: AuditSeverity; reason: string }[]
  procedure_deficiencies: string[]
  inspector_narrative:    string
}

export const REGULATOR_MACHINE_SCHEMA = {
  type: 'object',
  properties: {
    concurs_with_ehs: { type: 'boolean', description: 'True to CONCUR with the internal EHS pass/fail verdict; false to DISSENT.' },
    additional_citations: {
      type: 'array',
      description: 'Citations an inspector would write up that the internal EHS review missed.',
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
    severity_escalations: {
      type: 'array',
      description: 'Existing findings whose severity the inspector would raise (or lower), with the regulatory reason.',
      items: {
        type: 'object',
        properties: {
          code:   { type: 'string', description: 'The citation code whose severity is being changed.' },
          from:   { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
          to:     { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
          reason: { type: 'string' },
        },
        required: ['code', 'from', 'to', 'reason'],
        additionalProperties: false,
      },
    },
    procedure_deficiencies: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific procedure deficiencies an inspector would cite (e.g. a missing zero-energy verification).',
    },
    inspector_narrative: { type: 'string', description: 'The CSHO’s narrative finding for this machine, as it would read in an inspection report.' },
  },
  required: ['concurs_with_ehs', 'additional_citations', 'severity_escalations', 'procedure_deficiencies', 'inspector_narrative'],
  additionalProperties: false,
} as const

// Program-level audit over the whole run aggregate. Evaluates the §3314 program
// elements, surfaces systemic patterns, and orders the top priorities.
export type RegulatorElementStatus = 'compliant' | 'deficient' | 'not_evaluable'

export interface RegulatorProgramResult {
  executive_summary: string
  program_elements: {
    element:  string
    status:   RegulatorElementStatus
    finding:  string
    citation: string
  }[]
  systemic_findings: {
    pattern:            string
    affected_count:     number
    severity:           AuditSeverity
    citation:           string
    recommended_action: string
  }[]
  top_priorities: string[]
}

export const REGULATOR_PROGRAM_SCHEMA = {
  type: 'object',
  properties: {
    executive_summary: { type: 'string', description: 'One-paragraph executive summary of the LOTO program’s compliance posture.' },
    program_elements: {
      type: 'array',
      description: 'Each §3314 / 1910.147 program element evaluated for the whole program.',
      items: {
        type: 'object',
        properties: {
          element:  { type: 'string', description: 'The program element evaluated (e.g. "Periodic/annual inspection").' },
          status:   { type: 'string', enum: ['compliant', 'deficient', 'not_evaluable'] },
          finding:  { type: 'string' },
          citation: { type: 'string', description: 'The governing regulation for this element.' },
        },
        required: ['element', 'status', 'finding', 'citation'],
        additionalProperties: false,
      },
    },
    systemic_findings: {
      type: 'array',
      description: 'Patterns that recur across machines, with how many are affected.',
      items: {
        type: 'object',
        properties: {
          pattern:            { type: 'string' },
          affected_count:     { type: 'integer', description: 'Number of machines exhibiting the pattern.' },
          severity:           { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
          citation:           { type: 'string' },
          recommended_action: { type: 'string' },
        },
        required: ['pattern', 'affected_count', 'severity', 'citation', 'recommended_action'],
        additionalProperties: false,
      },
    },
    top_priorities: { type: 'array', items: { type: 'string' }, description: 'Ordered, most-urgent-first corrective priorities for the program.' },
  },
  required: ['executive_summary', 'program_elements', 'systemic_findings', 'top_priorities'],
  additionalProperties: false,
} as const

// ── DB-row DTOs (mirror migrations 218/219) ─────────────────────────────────

export type AuditRunStatus =
  | 'running' | 'awaiting_review' | 'partially_applied' | 'applied' | 'failed' | 'cancelled'

export type AuditAgentPhase = 'pending' | 'fpe_done' | 'ds_done' | 'ehs_done' | 'error'

export type AuditChangeKind =
  | 'step_field_edit' | 'step_confidence' | 'equipment_field_edit'
  | 'photo_provenance' | 'placeholder_photo' | 'ehs_finding'
  // Full corrected procedure drafted by the Author agent (migration 220).
  // new_value carries the complete replacement step set + a reviewer summary;
  // applying it replaces the machine's loto_energy_steps. Never auto-applied.
  | 'procedure_draft'

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
