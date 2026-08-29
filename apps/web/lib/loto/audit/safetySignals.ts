// THE deterministic isolation-point safety signal.
//
// The Fable 5 audit's unifying finding: the engine derived "is the isolation
// point verified?" three different ways — the EHS gate from two FPE verdicts,
// the change emitter from three, and the regulator correction from a regex over
// MODEL-GENERATED citation text — and none of them read the equipment row's own
// placeholder flags. Each divergence was a gate bypass (findings A-C1, A-C2,
// A-H7).
//
// This helper is the single source of truth. Compute it once from deterministic
// inputs (the equipment row + the stored FPE/DS verdicts), then thread the
// boolean everywhere: the gate, the emitter, and the correction. Never re-derive
// a safety floor from generated text.

import type { Equipment } from '@soteria/core/types'
import type { DsResult, FpeResult } from './schemas'

// True unless the isolation photo is affirmatively verified. The direction
// matters: "verified" requires strong evidence (a high-conviction match whose
// sub-flags agree), while ANY doubt — placeholder on file, weak/absent/contrary
// verdict, or a DS flag — reads as unverified. A worker locks out where this
// photo says to; a false "verified" is the failure mode every downstream
// defense is blind to.
export function isIsolationUnverified(
  equipment: Equipment,
  fpe: FpeResult,
  ds: DsResult,
): boolean {
  // A placeholder already applied to the row can never be re-judged "verified"
  // by a fresh vision call — the DB knows it is a stand-in (migration 217).
  if (equipment.iso_photo_is_placeholder === true) return true
  if (equipment.iso_photo_provenance === 'reference_placeholder') return true

  if (ds.low_confidence_iso) return true

  // A self-contradictory "match" (doesn't show the isolation point, or is
  // inconsistent with the energy steps) is not a match.
  const iso = fpe.iso_photo
  return !(iso.verdict === 'match' && iso.shows_isolation_point && iso.consistent_with_energy_steps)
}
