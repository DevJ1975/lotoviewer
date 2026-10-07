// The parts of the CFR the Python service can load into the assistant's
// knowledge base (services/sds-parser/app/regulations/catalog.py). A test on the
// service side fails if this list and that catalog drift apart.

export interface RegulationSource {
  /** regulation_update_checks.source: the freshness cron's key for this part. */
  key:        string
  label:      string
  ecfrTitle:  string
  ecfrPart:   string
}

export const REGULATION_SOURCES: readonly RegulationSource[] = [
  { key: 'epa-40-cfr-261', label: 'EPA 40 CFR Part 261 (Identification and Listing of Hazardous Waste)',          ecfrTitle: '40', ecfrPart: '261' },
  { key: 'epa-40-cfr-262', label: 'EPA 40 CFR Part 262 (Generators of Hazardous Waste)',                          ecfrTitle: '40', ecfrPart: '262' },
  { key: 'epa-40-cfr-263', label: 'EPA 40 CFR Part 263 (Transporters of Hazardous Waste)',                        ecfrTitle: '40', ecfrPart: '263' },
  { key: 'epa-40-cfr-112', label: 'EPA 40 CFR Part 112 (Oil Pollution Prevention, SPCC)',                         ecfrTitle: '40', ecfrPart: '112' },
  { key: 'epa-40-cfr-122', label: 'EPA 40 CFR Part 122 (NPDES Permit Program: stormwater, outfalls)',             ecfrTitle: '40', ecfrPart: '122' },
  { key: 'epa-40-cfr-403', label: 'EPA 40 CFR Part 403 (General Pretreatment Regulations)',                      ecfrTitle: '40', ecfrPart: '403' },
  { key: 'epa-40-cfr-70',  label: 'EPA 40 CFR Part 70 (State Operating Permit Programs, Title V air)',            ecfrTitle: '40', ecfrPart: '70'  },
]

export function findRegulationSource(key: string): RegulationSource | undefined {
  return REGULATION_SOURCES.find(s => s.key === key)
}
