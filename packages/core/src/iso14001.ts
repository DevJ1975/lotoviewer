// Static map of ISO 14001:2015 clauses to the platform modules that
// contribute evidence to them.
//
// Parallel to iso45001.ts (ISO 45001 is the OH&S twin; ISO 14001 is the
// environmental twin — both share the Annex SL clause-4-to-10 skeleton).
// This is intentionally NOT in the database: the auditor's clause map is
// a property of the platform's design, not of an individual tenant.
// Tenant-specific pinning of evidence to clauses lives in
// iso14001_clause_evidence; this module is the canonical default.
//
// Conservative scope: every clause listed here is one we can genuinely
// produce environmental evidence for from existing modules (incidents,
// chemicals, hazardous waste, Prop 65, compliance calendar, inspections,
// risk register, plus the environmental_aspects register added alongside
// this map). Clauses with no real evidence home yet (e.g. 9.3 management
// review) are deliberately omitted rather than mapped to a slogan.

export interface Iso14001ClauseEntry {
  /** Canonical clause code, e.g. "6.1.2". */
  code:    string
  /** Short title from ISO 14001:2015. */
  title:   string
  /** Where the supporting evidence lives in the platform. Non-empty. */
  sources: readonly string[]
}

// IMPORTANT: when adding a new clause entry, every name in `sources`
// MUST correspond to a real table or view. The unit test
// `iso14001.test.ts` walks the map and asserts each source table appears
// in at least one migration — that's the contract.
export const ISO14001_CLAUSE_MAP: readonly Iso14001ClauseEntry[] = [
  {
    code:    '4.1',
    title:   'Understanding the organization and its context',
    sources: ['tenants', 'risks'],
  },
  {
    code:    '5.2',
    title:   'Environmental policy',
    sources: ['audit_log'],
  },
  {
    code:    '6.1.1',
    title:   'Actions to address risks and opportunities — general',
    sources: ['risks', 'risk_reviews'],
  },
  {
    code:    '6.1.2',
    title:   'Environmental aspects',
    sources: ['environmental_aspects', 'chemical_inventory_items', 'hazardous_waste_streams'],
  },
  {
    code:    '6.1.3',
    title:   'Compliance obligations',
    sources: ['compliance_calendar_obligations', 'prop65_annual_reviews'],
  },
  {
    code:    '6.1.4',
    title:   'Planning action',
    sources: ['risk_controls', 'incident_capas', 'environmental_aspects'],
  },
  {
    code:    '6.2.1',
    title:   'Environmental objectives',
    sources: ['environmental_aspects', 'ehs_scorecard_targets'],
  },
  {
    code:    '7.2',
    title:   'Competence',
    sources: ['loto_training_records'],
  },
  {
    code:    '7.3',
    title:   'Awareness',
    sources: ['loto_training_records', 'audit_log'],
  },
  {
    code:    '7.4',
    title:   'Communication',
    sources: ['audit_log', 'prop65_notifications', 'prop65_warnings'],
  },
  {
    code:    '7.5',
    title:   'Documented information',
    sources: ['chemical_sds_documents', 'inspection_templates'],
  },
  {
    code:    '8.1',
    title:   'Operational planning and control',
    sources: ['chemical_inventory_items', 'hazardous_waste_containers', 'hazardous_waste_streams', 'inspections'],
  },
  {
    code:    '8.2',
    title:   'Emergency preparedness and response',
    sources: ['incidents', 'hazardous_waste_inspections'],
  },
  {
    code:    '9.1.1',
    title:   'Monitoring, measurement, analysis and evaluation — general',
    sources: ['inspections', 'chemical_exposure_events', 'hazardous_waste_inspections'],
  },
  {
    code:    '9.1.2',
    title:   'Evaluation of compliance',
    sources: ['compliance_calendar_obligations', 'prop65_exposure_assessments', 'prop65_annual_reviews'],
  },
  {
    code:    '9.2',
    title:   'Internal audit',
    sources: ['inspections', 'inspection_templates', 'audit_log'],
  },
  {
    code:    '10.2',
    title:   'Nonconformity and corrective action',
    sources: ['incidents', 'incident_capas', 'near_misses'],
  },
  {
    code:    '10.3',
    title:   'Continual improvement',
    sources: ['incident_capas', 'environmental_aspects'],
  },
] as const

/** Lookup a single clause entry by exact code. Returns null when the
 * code is not in the canonical map. Pages call this on every route
 * param to fail fast on typos. */
export function findClause(code: string): Iso14001ClauseEntry | null {
  return ISO14001_CLAUSE_MAP.find(c => c.code === code) ?? null
}

/** The union of every source table referenced by ISO14001_CLAUSE_MAP.
 * Used by the test to validate every source corresponds to a real table
 * in the migration history. */
export function uniqueSourceTables(): readonly string[] {
  const set = new Set<string>()
  for (const entry of ISO14001_CLAUSE_MAP) {
    for (const s of entry.sources) set.add(s)
  }
  return [...set].sort()
}
