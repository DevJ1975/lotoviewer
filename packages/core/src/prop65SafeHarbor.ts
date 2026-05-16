// Mirror of the seed in migration 170. Lets client-side flows
// (e.g. the chemicals-inventory auto-suggest preview) classify
// exposure without a Supabase round-trip.
//
// Keep this list in lockstep with the migration 170 INSERT. The
// vitest suite verifies the count + a sampling of values.

import type { Prop65Chemical } from './prop65'

// id is omitted here — the seed in Postgres assigns gen_random_uuid()
// and the API joins by cas_number anyway. SafeHarbor consumers use
// the CAS number as the identity.
export type Prop65SafeHarborEntry = Omit<Prop65Chemical, 'id'>

export const PROP65_SAFE_HARBOR: readonly Prop65SafeHarborEntry[] = [
  { cas_number: '7439-92-1',  chemical_name: 'Lead',                             harm_endpoint: 'both',         nsrl_mg_day: 0.015,  madl_mg_day: 0.0005 },
  { cas_number: '71-43-2',    chemical_name: 'Benzene',                          harm_endpoint: 'both',         nsrl_mg_day: 0.007,  madl_mg_day: 0.024 },
  { cas_number: '7440-43-9',  chemical_name: 'Cadmium',                          harm_endpoint: 'both',         nsrl_mg_day: 0.05,   madl_mg_day: 0.0041 },
  { cas_number: '18540-29-9', chemical_name: 'Chromium (hexavalent compounds)',  harm_endpoint: 'both',         nsrl_mg_day: 0.0002, madl_mg_day: 0.0085 },
  { cas_number: '50-00-0',    chemical_name: 'Formaldehyde (gas)',               harm_endpoint: 'cancer',       nsrl_mg_day: 0.04,   madl_mg_day: null },
  { cas_number: '75-09-2',    chemical_name: 'Methylene chloride',               harm_endpoint: 'cancer',       nsrl_mg_day: 0.20,   madl_mg_day: null },
  { cas_number: '127-18-4',   chemical_name: 'Tetrachloroethylene (PCE/perc)',   harm_endpoint: 'cancer',       nsrl_mg_day: 0.014,  madl_mg_day: null },
  { cas_number: '79-01-6',    chemical_name: 'Trichloroethylene (TCE)',          harm_endpoint: 'both',         nsrl_mg_day: 0.05,   madl_mg_day: 0.014 },
  { cas_number: '75-01-4',    chemical_name: 'Vinyl chloride',                   harm_endpoint: 'cancer',       nsrl_mg_day: 0.0003, madl_mg_day: null },
  { cas_number: '1332-21-4',  chemical_name: 'Asbestos',                         harm_endpoint: 'cancer',       nsrl_mg_day: null,   madl_mg_day: null },
  { cas_number: '7440-38-2',  chemical_name: 'Arsenic (inorganic, oxide)',       harm_endpoint: 'both',         nsrl_mg_day: 0.00010, madl_mg_day: 0.0001 },
  { cas_number: '7440-41-7',  chemical_name: 'Beryllium',                        harm_endpoint: 'cancer',       nsrl_mg_day: 0.0001, madl_mg_day: null },
  { cas_number: '7440-02-0',  chemical_name: 'Nickel (refinery dust)',           harm_endpoint: 'cancer',       nsrl_mg_day: 0.02,   madl_mg_day: null },
  { cas_number: '75-21-8',    chemical_name: 'Ethylene oxide',                   harm_endpoint: 'both',         nsrl_mg_day: 0.002,  madl_mg_day: 0.020 },
  { cas_number: '117-81-7',   chemical_name: 'Di(2-ethylhexyl)phthalate (DEHP)', harm_endpoint: 'both',         nsrl_mg_day: 0.31,   madl_mg_day: 0.41 },
  { cas_number: '80-05-7',    chemical_name: 'Bisphenol A (BPA)',                harm_endpoint: 'reproductive', nsrl_mg_day: null,   madl_mg_day: 0.003 },
  { cas_number: '1336-36-3',  chemical_name: 'Polychlorinated biphenyls (PCBs)', harm_endpoint: 'cancer',       nsrl_mg_day: 0.09,   madl_mg_day: null },
  { cas_number: '140-88-5',   chemical_name: 'Ethyl acrylate',                   harm_endpoint: 'cancer',       nsrl_mg_day: 0.022,  madl_mg_day: null },
  { cas_number: '91-20-3',    chemical_name: 'Naphthalene',                      harm_endpoint: 'cancer',       nsrl_mg_day: 0.0058, madl_mg_day: null },
  { cas_number: '100-42-5',   chemical_name: 'Styrene',                          harm_endpoint: 'cancer',       nsrl_mg_day: 0.027,  madl_mg_day: null },
] as const

/**
 * Strip everything that isn't a digit, then group digits back into the
 * canonical NNNN-NN-N CAS-Registry shape. Handles:
 *  - dashes vs no-dashes ('7440-43-9' vs '7440439')
 *  - leading zeros within a group ('0050-00-0' → '50-00-0')
 *  - stray whitespace around the input
 *
 * Returns null when the digit count doesn't yield a valid 3-group
 * CAS (final group is exactly 1 digit, middle group exactly 2,
 * first group between 2 and 7 inclusive).
 */
export function normalizeCasNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length < 4 || digits.length > 10) return null

  // Last digit is the checksum, second-to-last and third-to-last are the
  // mid group. Everything before is the first group, which must be 2..7
  // digits AFTER we strip leading zeros.
  const check = digits.slice(-1)
  const mid   = digits.slice(-3, -1)
  let head    = digits.slice(0, -3)
  // Strip leading zeros — '0050-00-0' is the same registry number as '50-00-0'.
  head = head.replace(/^0+/, '')
  if (head.length < 2 || head.length > 7) return null

  return `${head}-${mid}-${check}`
}

/**
 * Look up the safe-harbor entry by CAS number, tolerant of formatting
 * differences. Returns null when no entry matches.
 */
export function findByCasNumber(cas: string | null | undefined): Prop65SafeHarborEntry | null {
  const normalized = normalizeCasNumber(cas)
  if (!normalized) return null
  for (const e of PROP65_SAFE_HARBOR) {
    if (e.cas_number === normalized) return e
  }
  return null
}

/**
 * Bulk variant — given the cas_numbers[] array on a chemical_product,
 * return every safe-harbor entry that matches any of them. Used by
 * the chemicals-inventory auto-suggest flow.
 */
export function findMatchingSafeHarbor(
  casNumbers: readonly (string | null | undefined)[],
): Prop65SafeHarborEntry[] {
  const hits: Prop65SafeHarborEntry[] = []
  const seen = new Set<string>()
  for (const cas of casNumbers) {
    const match = findByCasNumber(cas)
    if (match && !seen.has(match.cas_number)) {
      seen.add(match.cas_number)
      hits.push(match)
    }
  }
  return hits
}
