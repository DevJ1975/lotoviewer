// Static map of ISO 45001:2018 clauses to the platform modules that
// contribute evidence to them.
//
// This is intentionally NOT in the database. The auditor's clause
// map is a property of the platform's design, not of an individual
// tenant — every customer running the same module mix satisfies the
// same clauses. Tenant-specific pinning of evidence to clauses lives
// in iso45001_clause_evidence; this module is the canonical default.
//
// Conservative scope: every clause listed here is one we can
// genuinely produce evidence for. Clauses about leadership commitment
// (5.1), worker consultation (5.4), or competence (7.2) point at the
// concrete tables that demonstrate the activity, not at slogans.

export interface Iso45001ClauseEntry {
  /** Canonical clause code, e.g. "8.1.2". */
  code:    string
  /** Short title from ISO 45001:2018. */
  title:   string
  /** Where the supporting evidence lives in the platform. Non-empty. */
  sources: readonly string[]
}

// IMPORTANT: when adding a new clause entry, every name in `sources`
// MUST correspond to a real table or view. The unit test
// `iso45001-sources-exist` walks the map and asserts the source
// table appears in at least one migration — that's the contract.
export const ISO45001_CLAUSE_MAP: readonly Iso45001ClauseEntry[] = [
  {
    code:    '4.1',
    title:   'Understanding the organization and its context',
    sources: ['tenants', 'risks'],
  },
  {
    code:    '5.1',
    title:   'Leadership and commitment',
    sources: ['audit_log'],
  },
  {
    code:    '6.1.2.1',
    title:   'Hazard identification',
    sources: ['risks', 'near_misses', 'loto_equipment'],
  },
  {
    code:    '6.1.2.2',
    title:   'Assessment of OH&S risks and other risks',
    sources: ['risks', 'risk_reviews'],
  },
  {
    code:    '6.1.2.3',
    title:   'Assessment of OH&S opportunities and other opportunities',
    sources: ['risks'],
  },
  {
    code:    '6.1.3',
    title:   'Determination of legal requirements and other requirements',
    sources: ['prop65_annual_reviews', 'prop65_exposure_assessments'],
  },
  {
    code:    '7.2',
    title:   'Competence',
    sources: ['loto_training_records', 'loto_competency_exam_attempts'],
  },
  {
    code:    '7.3',
    title:   'Awareness',
    sources: ['loto_workers', 'loto_training_records'],
  },
  {
    code:    '7.4',
    title:   'Communication',
    sources: ['audit_log', 'prop65_notifications', 'prop65_warnings'],
  },
  {
    code:    '7.5',
    title:   'Documented information',
    sources: ['loto_equipment', 'loto_signed_pdf_artifacts'],
  },
  {
    code:    '8.1.1',
    title:   'Operational planning and control — general',
    sources: ['loto_equipment', 'loto_confined_space_permits', 'loto_hot_work_permits'],
  },
  {
    code:    '8.1.2',
    title:   'Eliminating hazards and reducing OH&S risks',
    sources: ['risks', 'risk_controls', 'incidents', 'near_misses'],
  },
  {
    code:    '8.1.3',
    title:   'Management of change',
    sources: ['risks', 'risk_reviews'],
  },
  {
    code:    '8.1.4',
    title:   'Procurement (incl. contractors)',
    sources: ['loto_contractor_companies'],
  },
  {
    code:    '8.2',
    title:   'Emergency preparedness and response',
    sources: ['loto_hot_work_permits', 'loto_confined_space_permits'],
  },
  {
    code:    '9.1',
    title:   'Monitoring, measurement, analysis and performance evaluation',
    sources: ['incidents', 'audit_log', 'loto_periodic_inspections'],
  },
  {
    code:    '9.1.2',
    title:   'Evaluation of compliance',
    sources: ['loto_periodic_inspections', 'audit_log'],
  },
  {
    code:    '9.2',
    title:   'Internal audit',
    sources: ['loto_walkdown_checklists', 'audit_log'],
  },
  {
    code:    '10.1',
    title:   'Continual improvement — general',
    sources: ['incidents', 'incident_capas'],
  },
  {
    code:    '10.2',
    title:   'Incident, nonconformity and corrective action',
    sources: ['incidents', 'incident_capas', 'near_misses'],
  },
] as const

/** Lookup a single clause entry by exact code. Returns null when the
 * code is not in the canonical map. The pages call this on every
 * route param to fail fast on typos. */
export function findClause(code: string): Iso45001ClauseEntry | null {
  return ISO45001_CLAUSE_MAP.find(c => c.code === code) ?? null
}

/** The union of every source table referenced by ISO45001_CLAUSE_MAP.
 * Used by the test to validate every source corresponds to a real
 * table in the migration history. */
export function uniqueSourceTables(): readonly string[] {
  const set = new Set<string>()
  for (const entry of ISO45001_CLAUSE_MAP) {
    for (const s of entry.sources) set.add(s)
  }
  return [...set].sort()
}
