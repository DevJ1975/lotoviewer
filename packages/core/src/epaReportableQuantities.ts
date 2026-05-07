// EPA CERCLA Reportable Quantities — common-substance subset.
//
// CERCLA §103 / 40 CFR 302.4 requires "any person in charge" of a
// facility to immediately notify the National Response Center when
// a Reportable Quantity (RQ) of a hazardous substance is released
// into the environment. The full RQ list has 800+ entries; this
// module ships the substances most commonly involved in workplace
// spills so the incident detail page can flag a likely RQ release
// the moment the intake form is saved.
//
// Sources: 40 CFR 302.4 (final rule, current as of 2024 revisions),
// EPA "List of Lists". Quantities are in pounds — we convert to
// pounds from the spill_quantity_unit before comparing.
//
// Pure data + a tiny lookup helper. No I/O, no DOM. Returns `null`
// when the substance isn't in the catalog so the UI can render a
// soft "consult SDS" prompt instead of a hard "below RQ" claim.

import { type IncidentSpillUnit } from './incident'

export interface RqEntry {
  /** CAS Registry Number — the regulator's primary identifier. */
  cas:        string
  /** Display name + common synonyms for fuzzy matching. */
  name:       string
  /** Synonyms that should match (lowercased) — caught alongside name. */
  synonyms?:  ReadonlyArray<string>
  /** Reportable quantity in pounds. */
  rq_lb:      number
  /** Hazard categories for the explanatory banner. */
  hazards:    ReadonlyArray<'flammable' | 'corrosive' | 'toxic' | 'oxidizer' | 'carcinogen'>
}

// Curated subset — common workplace spill substances. Do NOT treat
// this as exhaustive; the lookup helper returns `null` for anything
// not on the list and the UI must steer users to consult their SDS.
export const COMMON_RQ_LIST: ReadonlyArray<RqEntry> = [
  { cas: '7664-41-7',  name: 'Ammonia',           synonyms: ['anhydrous ammonia'], rq_lb: 100,   hazards: ['toxic', 'corrosive'] },
  { cas: '7647-01-0',  name: 'Hydrochloric acid', synonyms: ['muriatic acid'],     rq_lb: 5000,  hazards: ['corrosive', 'toxic'] },
  { cas: '7664-93-9',  name: 'Sulfuric acid',                                       rq_lb: 1000,  hazards: ['corrosive', 'oxidizer'] },
  { cas: '1310-73-2',  name: 'Sodium hydroxide',  synonyms: ['caustic soda', 'lye'], rq_lb: 1000, hazards: ['corrosive'] },
  { cas: '7782-50-5',  name: 'Chlorine',                                             rq_lb: 10,    hazards: ['toxic', 'oxidizer'] },
  { cas: '50-00-0',    name: 'Formaldehyde',                                         rq_lb: 100,   hazards: ['toxic', 'carcinogen'] },
  { cas: '7439-92-1',  name: 'Lead',                                                 rq_lb: 10,    hazards: ['toxic'] },
  { cas: '7440-43-9',  name: 'Cadmium',                                              rq_lb: 10,    hazards: ['toxic', 'carcinogen'] },
  { cas: '7440-50-8',  name: 'Copper',                                               rq_lb: 5000,  hazards: ['toxic'] },
  { cas: '67-66-3',    name: 'Chloroform',                                           rq_lb: 10,    hazards: ['toxic', 'carcinogen'] },
  { cas: '71-43-2',    name: 'Benzene',                                              rq_lb: 10,    hazards: ['toxic', 'carcinogen', 'flammable'] },
  { cas: '108-88-3',   name: 'Toluene',                                              rq_lb: 1000,  hazards: ['toxic', 'flammable'] },
  { cas: '1330-20-7',  name: 'Xylene',            synonyms: ['xylenes'],             rq_lb: 100,   hazards: ['toxic', 'flammable'] },
  { cas: '67-56-1',    name: 'Methanol',          synonyms: ['methyl alcohol'],      rq_lb: 5000,  hazards: ['toxic', 'flammable'] },
  { cas: '64-17-5',    name: 'Ethanol',           synonyms: ['ethyl alcohol'],       rq_lb: 0,     hazards: ['flammable'] },   // Not RQ-listed; rq_lb=0 sentinel for non-CERCLA.
  // Petroleum products — note: pure CERCLA exempts petroleum, but
  // EPA SPCC + state programs (e.g. CA Health & Safety Code) do
  // require notification of oil discharges. We flag at sheen-
  // forming quantities (1 quart ≈ 2 lb) so the user gets a prompt
  // even if CERCLA itself doesn't apply.
  { cas: 'PETROLEUM-DIESEL', name: 'Diesel fuel', synonyms: ['diesel'],             rq_lb: 2,     hazards: ['flammable'] },
  { cas: 'PETROLEUM-GAS',    name: 'Gasoline',                                       rq_lb: 2,     hazards: ['flammable'] },
  { cas: 'PETROLEUM-HYD',    name: 'Hydraulic oil', synonyms: ['hydraulic fluid'],  rq_lb: 2,     hazards: [] },
  { cas: 'PETROLEUM-MOT',    name: 'Motor oil',     synonyms: ['lubricant', 'engine oil'], rq_lb: 2, hazards: [] },
]

// ──────────────────────────────────────────────────────────────────────────
// Lookup
// ──────────────────────────────────────────────────────────────────────────

export function lookupRq(substance: string): RqEntry | null {
  const q = substance.trim().toLowerCase()
  if (!q) return null
  for (const e of COMMON_RQ_LIST) {
    if (e.name.toLowerCase() === q) return e
    if (e.cas.toLowerCase() === q) return e
    if (e.synonyms?.some(s => s.toLowerCase() === q)) return e
  }
  // Fuzzy: substring match against name + synonyms. Useful for
  // "anhydrous ammonia (refrigerant)" → matches "ammonia". We
  // require the full canonical name to be a substring of the user
  // input, not the other way around — avoids matching "iron" to
  // every entry containing the letters.
  for (const e of COMMON_RQ_LIST) {
    const name = e.name.toLowerCase()
    if (q.includes(name) && name.length >= 5) return e
    if (e.synonyms) {
      for (const s of e.synonyms) {
        const sl = s.toLowerCase()
        if (q.includes(sl) && sl.length >= 5) return e
      }
    }
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────────
// Quantity conversion
// ──────────────────────────────────────────────────────────────────────────

// Density assumption for converting volumetric units (gallons, litres,
// m³) to pounds. Without an explicit substance density we use water
// (8.345 lb/gal); diesel ≈ 7.0, gasoline ≈ 6.2. Phase 6 ships the
// generic conversion so the banner errs on the side of caution. A
// per-substance density override could ship in a future iteration.
const LB_PER_GAL_WATER = 8.345
const LB_PER_LITRE_WATER = 2.205        // 1 L ≈ 2.205 lb water
const LB_PER_KG = 2.2046
const LB_PER_M3_WATER = 2204.6

export function quantityInPounds(quantity: number, unit: IncidentSpillUnit): number | null {
  if (!Number.isFinite(quantity) || quantity < 0) return null
  switch (unit) {
    case 'lb':  return quantity
    case 'kg':  return quantity * LB_PER_KG
    case 'gal': return quantity * LB_PER_GAL_WATER
    case 'L':   return quantity * LB_PER_LITRE_WATER
    case 'm3':  return quantity * LB_PER_M3_WATER
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Threshold check — the banner uses this directly.
// ──────────────────────────────────────────────────────────────────────────

export type RqDecision =
  | { kind: 'unknown_substance';   message: string }
  | { kind: 'unknown_quantity';    entry: RqEntry; message: string }
  | { kind: 'below_rq';            entry: RqEntry; rq_lb: number; quantity_lb: number }
  | { kind: 'meets_rq';            entry: RqEntry; rq_lb: number; quantity_lb: number; message: string }
  | { kind: 'non_cercla_petroleum'; entry: RqEntry; quantity_lb: number; message: string }

/** Decides whether a spill triggers a CERCLA notification under
 *  40 CFR 302.4. NULL inputs return 'unknown_*' kinds so the UI
 *  can render a soft prompt rather than a misleading "below RQ"
 *  conclusion. */
export function checkSpillRq(opts: {
  substance:           string | null | undefined
  quantity:            number | null | undefined
  quantity_unit:       IncidentSpillUnit | null | undefined
}): RqDecision {
  const subStr = (opts.substance ?? '').trim()
  if (!subStr) {
    return {
      kind: 'unknown_substance',
      message: 'No substance entered. Consult the SDS to determine if this release is a CERCLA reportable quantity.',
    }
  }
  const entry = lookupRq(subStr)
  if (!entry) {
    return {
      kind: 'unknown_substance',
      message: `${subStr} is not in the common-RQ catalog. Consult the SDS + 40 CFR 302.4 to determine if this release is reportable.`,
    }
  }
  if (opts.quantity == null || !opts.quantity_unit) {
    return {
      kind: 'unknown_quantity',
      entry,
      message: `Substance is on the RQ catalog (${entry.name}, RQ ${entry.rq_lb} lb). Quantity not entered — flag pending.`,
    }
  }
  const lb = quantityInPounds(opts.quantity, opts.quantity_unit)
  if (lb == null) {
    return {
      kind: 'unknown_quantity',
      entry,
      message: 'Quantity could not be converted to pounds.',
    }
  }
  // Petroleum products are CERCLA-exempt for crude oil + petroleum
  // fractions but trigger SPCC + state notification on visible
  // sheens (~1 quart for diesel/gas). We flag at our 2-lb sentinel.
  if (entry.cas.startsWith('PETROLEUM-')) {
    if (lb >= entry.rq_lb) {
      return {
        kind: 'non_cercla_petroleum',
        entry,
        quantity_lb: lb,
        message: 'Petroleum products are exempt from CERCLA RQ but still subject to SPCC + Clean Water Act sheen reporting + many state programs. Notify the appropriate state agency.',
      }
    }
    return { kind: 'below_rq', entry, rq_lb: entry.rq_lb, quantity_lb: lb }
  }
  if (entry.rq_lb > 0 && lb >= entry.rq_lb) {
    return {
      kind: 'meets_rq',
      entry,
      rq_lb: entry.rq_lb,
      quantity_lb: lb,
      message: 'CERCLA RQ met. Notify the National Response Center at 1-800-424-8802 immediately.',
    }
  }
  return { kind: 'below_rq', entry, rq_lb: entry.rq_lb, quantity_lb: lb }
}
