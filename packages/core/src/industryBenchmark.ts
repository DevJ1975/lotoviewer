// Industry-benchmark reference data for the EHS scorecard.
//
// Lets a tenant compare its own TRIR/DART against the average for its
// industry. The comparison needs an industry rate; we ship the U.S. BLS
// Survey of Occupational Injuries and Illnesses (SOII) private-industry
// incidence rates per 100 FTE, keyed by 2-digit NAICS sector. A tenant
// can override any of these with its own figure (kind='benchmark' in
// ehs_scorecard_targets) — the embedded numbers are the zero-config
// default, not the final word.
//
// SOURCE: BLS SOII, reference year below. These are sector-level averages
// (TRC = total recordable case rate; DART = days-away/restricted/transfer
// rate). Refresh SECTOR_RATES + BLS_DATA_YEAR when BLS publishes a newer
// year. Treat the values as approximate sector benchmarks.

export interface IndustryBenchmark {
  /** Human-readable NAICS sector name, e.g. 'Manufacturing'. */
  sector: string
  /** Total recordable case rate per 100 FTE (compare against TRIR). */
  trir: number
  /** Days away/restricted/transfer rate per 100 FTE (compare against DART). */
  dart: number
}

/** Reference year of the embedded BLS SOII data. */
export const BLS_DATA_YEAR = 2022

/** Fallback when the tenant's NAICS sector isn't mapped (or is unknown). */
export const ALL_PRIVATE_INDUSTRY: IndustryBenchmark = {
  sector: 'All private industry',
  trir: 2.7,
  dart: 1.7,
}

// Sectors that span several 2-digit prefixes share one record.
const MANUFACTURING: IndustryBenchmark = { sector: 'Manufacturing', trir: 3.0, dart: 1.7 }
const RETAIL_TRADE:  IndustryBenchmark = { sector: 'Retail trade', trir: 3.0, dart: 1.8 }
const TRANSPORT:     IndustryBenchmark = { sector: 'Transportation & warehousing', trir: 4.1, dart: 2.8 }

// Keyed by the 2-digit NAICS sector prefix.
const SECTOR_RATES: Record<string, IndustryBenchmark> = {
  '11': { sector: 'Agriculture, forestry, fishing & hunting', trir: 4.6, dart: 2.6 },
  '21': { sector: 'Mining, quarrying, oil & gas extraction', trir: 1.1, dart: 0.7 },
  '22': { sector: 'Utilities', trir: 1.6, dart: 0.9 },
  '23': { sector: 'Construction', trir: 2.3, dart: 1.4 },
  '31': MANUFACTURING,
  '32': MANUFACTURING,
  '33': MANUFACTURING,
  '42': { sector: 'Wholesale trade', trir: 2.6, dart: 1.7 },
  '44': RETAIL_TRADE,
  '45': RETAIL_TRADE,
  '48': TRANSPORT,
  '49': TRANSPORT,
  '51': { sector: 'Information', trir: 1.0, dart: 0.6 },
  '52': { sector: 'Finance & insurance', trir: 0.5, dart: 0.3 },
  '53': { sector: 'Real estate & rental & leasing', trir: 2.2, dart: 1.3 },
  '54': { sector: 'Professional, scientific & technical services', trir: 0.6, dart: 0.3 },
  '55': { sector: 'Management of companies & enterprises', trir: 0.6, dart: 0.4 },
  '56': { sector: 'Administrative, support & waste management', trir: 2.5, dart: 1.6 },
  '61': { sector: 'Educational services', trir: 1.9, dart: 1.0 },
  '62': { sector: 'Health care & social assistance', trir: 4.5, dart: 2.6 },
  '71': { sector: 'Arts, entertainment & recreation', trir: 3.7, dart: 2.2 },
  '72': { sector: 'Accommodation & food services', trir: 3.0, dart: 1.7 },
  '81': { sector: 'Other services (except public administration)', trir: 2.1, dart: 1.2 },
}

/**
 * Resolve the BLS industry benchmark for a NAICS code (6-digit or any
 * prefix). Falls back to the all-private-industry average when the sector
 * isn't mapped or the code is missing — so the scorecard always has a
 * benchmark to show.
 */
export function benchmarkForNaics(naics: string | null | undefined): IndustryBenchmark {
  const prefix = (naics ?? '').replace(/\D/g, '').slice(0, 2)
  return SECTOR_RATES[prefix] ?? ALL_PRIVATE_INDUSTRY
}
