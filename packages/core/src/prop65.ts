// California Proposition 65 — pure classification helpers.
//
// Why this file exists:
//   The §25249.6 affirmative defense rests on documenting that the
//   exposure is below the OEHHA safe-harbor level (NSRL for cancer,
//   MADL for reproductive). The classification is decided at the
//   database boundary (migrations 173, 177) AND at the UI boundary
//   (admin form preview). Both sides MUST agree. This module is the
//   single source of truth for the rule.
//
// Fail-safe posture (load-bearing):
//   When the safe-harbor value is null, return 'unknown'. NEVER
//   silently treat a missing number as below-safe-harbor — that's
//   precisely the gap a bounty-hunter plaintiff would aim for.
//
// 1000x safety factor note:
//   The 1000x lifetime safety factor IS the law's NSRL definition
//   (Cal. Code Regs tit. 27 §25721). The number stored in
//   prop65_chemicals.nsrl_mg_day is ALREADY the safe daily exposure.
//   Callers MUST NOT multiply it again.

export type Prop65HarmEndpoint = 'cancer' | 'reproductive' | 'both'

export type Prop65ExposureRoute = 'inhalation' | 'dermal' | 'ingestion' | 'multiple'

export const PROP65_HARM_ENDPOINTS: readonly Prop65HarmEndpoint[] =
  ['cancer', 'reproductive', 'both'] as const

export const PROP65_EXPOSURE_ROUTES: readonly Prop65ExposureRoute[] =
  ['inhalation', 'dermal', 'ingestion', 'multiple'] as const

export interface Prop65Chemical {
  id:             string
  cas_number:     string
  chemical_name:  string
  harm_endpoint:  Prop65HarmEndpoint
  /** mg/day. Null when OEHHA has not published a number. */
  nsrl_mg_day:    number | null
  /** mg/day. Null when OEHHA has not published a number. */
  madl_mg_day:    number | null
}

export type ExposureClassification =
  | 'below_safe_harbor'
  | 'requires_warning'
  | 'unknown'

/**
 * Decide whether the documented daily exposure clears the OEHHA
 * safe-harbor level for the given endpoint.
 *
 * Endpoint dispatch:
 *  - 'cancer'       → compare to nsrl_mg_day
 *  - 'reproductive' → compare to madl_mg_day
 *  - 'both'         → BOTH endpoints must individually clear; if one
 *                     endpoint's number is missing, the overall result
 *                     is 'unknown' even if the other endpoint clears.
 *                     (Fail-safe — a missing repro number doesn't
 *                      get masked by a clearing cancer number.)
 *
 * Strict less-than: an exposure exactly AT the safe-harbor level is
 * NOT documented as cleared. OEHHA's published numbers are upper
 * bounds; a record sitting on the line invites enforcement scrutiny.
 */
export function classifyExposure(
  daily_mg: number,
  chemical: Pick<Prop65Chemical, 'nsrl_mg_day' | 'madl_mg_day'>,
  endpoint: Prop65HarmEndpoint,
): ExposureClassification {
  if (!Number.isFinite(daily_mg) || daily_mg < 0) return 'unknown'

  switch (endpoint) {
    case 'cancer': {
      if (chemical.nsrl_mg_day == null) return 'unknown'
      return daily_mg < chemical.nsrl_mg_day ? 'below_safe_harbor' : 'requires_warning'
    }
    case 'reproductive': {
      if (chemical.madl_mg_day == null) return 'unknown'
      return daily_mg < chemical.madl_mg_day ? 'below_safe_harbor' : 'requires_warning'
    }
    case 'both': {
      // Both endpoints must be present AND clearing.
      if (chemical.nsrl_mg_day == null || chemical.madl_mg_day == null) return 'unknown'
      const cancerOk = daily_mg < chemical.nsrl_mg_day
      const reproOk  = daily_mg < chemical.madl_mg_day
      return cancerOk && reproOk ? 'below_safe_harbor' : 'requires_warning'
    }
  }
}
