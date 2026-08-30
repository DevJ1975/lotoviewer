// Hazardous-waste code classification.
//
// A California manifest carries BOTH federal EPA waste codes (the D/F/K/P/U
// lists) AND California three-digit waste codes, and California regulates
// "non-RCRA" wastes that have no federal code at all. The stream record keeps a
// single flat `waste_codes` array, so this module partitions and validates it
// by pattern rather than forcing a schema split:
//
//   EPA:        ^[DFKPU]\d{3}$   e.g. D001, F003, K071, P030, U154
//   California: ^\d{3}$          e.g. 134, 221, 791
//
// The full F/K/P/U lists are long and change by rule; we validate their
// structure (letter + 3 digits) and carry the finite, stable characteristic
// D-list in full for labels and auto-complete.

export type WasteCodeSystem = 'epa' | 'california' | 'unknown'

export type EpaWasteKind =
  | 'characteristic' // D-list
  | 'non_specific_source' // F-list
  | 'specific_source' // K-list
  | 'acute' // P-list
  | 'toxic' // U-list

const EPA_KIND_BY_LETTER: Record<string, EpaWasteKind> = {
  D: 'characteristic',
  F: 'non_specific_source',
  K: 'specific_source',
  P: 'acute',
  U: 'toxic',
}

/** Finite, stable federal characteristic codes (40 CFR 261.21–261.24). */
export const EPA_CHARACTERISTIC_CODES: Record<string, string> = {
  D001: 'Ignitability',
  D002: 'Corrosivity',
  D003: 'Reactivity',
  // Toxicity characteristic (TCLP), 40 CFR 261.24
  D004: 'Arsenic', D005: 'Barium', D006: 'Cadmium', D007: 'Chromium',
  D008: 'Lead', D009: 'Mercury', D010: 'Selenium', D011: 'Silver',
  D012: 'Endrin', D013: 'Lindane', D014: 'Methoxychlor', D015: 'Toxaphene',
  D016: '2,4-D', D017: '2,4,5-TP (Silvex)', D018: 'Benzene',
  D019: 'Carbon tetrachloride', D020: 'Chlordane', D021: 'Chlorobenzene',
  D022: 'Chloroform', D023: 'o-Cresol', D024: 'm-Cresol', D025: 'p-Cresol',
  D026: 'Cresol', D027: '1,4-Dichlorobenzene', D028: '1,2-Dichloroethane',
  D029: '1,1-Dichloroethylene', D030: '2,4-Dinitrotoluene', D031: 'Heptachlor',
  D032: 'Hexachlorobenzene', D033: 'Hexachlorobutadiene',
  D034: 'Hexachloroethane', D035: 'Methyl ethyl ketone', D036: 'Nitrobenzene',
  D037: 'Pentachlorophenol', D038: 'Pyridine', D039: 'Tetrachloroethylene',
  D040: 'Trichloroethylene', D041: '2,4,5-Trichlorophenol',
  D042: '2,4,6-Trichlorophenol', D043: 'Vinyl chloride',
}

const EPA_RE = /^[DFKPU]\d{3}$/
const CA_RE = /^\d{3}$/

export interface WasteCodeClassification {
  code: string
  system: WasteCodeSystem
  /** Structurally valid for its detected system. */
  valid: boolean
  /** Present for EPA codes. */
  epaKind?: EpaWasteKind
  /** Present for known EPA characteristic codes. */
  label?: string
}

/** Classify one code. Input is upper-cased and trimmed first. */
export function classifyWasteCode(raw: string): WasteCodeClassification {
  const code = raw.trim().toUpperCase()
  if (EPA_RE.test(code)) {
    const kind = EPA_KIND_BY_LETTER[code[0]!]
    return { code, system: 'epa', valid: true, epaKind: kind, label: EPA_CHARACTERISTIC_CODES[code] }
  }
  if (CA_RE.test(code)) {
    return { code, system: 'california', valid: true }
  }
  return { code, system: 'unknown', valid: false }
}

export interface WasteCodePartition {
  epa: string[]
  california: string[]
  unknown: string[]
}

/** Partition a stream's flat code array into EPA / California / unrecognized. */
export function partitionWasteCodes(codes: readonly string[]): WasteCodePartition {
  const out: WasteCodePartition = { epa: [], california: [], unknown: [] }
  for (const raw of codes) {
    const { code, system } = classifyWasteCode(raw)
    if (system === 'epa') out.epa.push(code)
    else if (system === 'california') out.california.push(code)
    else if (code) out.unknown.push(code)
  }
  return out
}

/** True when every code is structurally valid for a known system. */
export function allWasteCodesValid(codes: readonly string[]): boolean {
  return codes.every(c => classifyWasteCode(c).valid)
}
