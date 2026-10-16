// Validator for 29 CFR 1910.147(c)(4)(ii) procedure structure.
//
// OSHA requires the documented procedure to spell out: shutdown,
// isolation, lockout, release of stored energy, and verification of
// de-energization (the "tryout" step under §147(d)(6)). Of those, the
// verify_zero_energy step is the one auditors hammer on hardest — a
// procedure that locks out a machine but never verifies zero state
// is the leading cause of LOTO citations.
//
// This module is pure TS so the placard renderer (web + future PDF
// generator) and the placard-generation API can both call it. No DB,
// no React, no Node.

export type LotoStepType =
  | 'shutdown'
  | 'isolate'
  | 'release_stored_energy'
  | 'lockout'
  | 'verify_zero_energy'

export const LOTO_STEP_TYPE_LABELS: Record<LotoStepType, string> = {
  shutdown:               'Notify & shut down',
  isolate:                'Isolate energy source',
  release_stored_energy:  'Release stored energy',
  lockout:                'Apply lock & tag',
  verify_zero_energy:     'Verify zero energy (tryout)',
}

// The order of application in §1910.147(d): shut down (d)(2), isolate
// (d)(3), apply lockout devices (d)(4), then relieve stored energy
// (d)(5)(i) — "Following the application of lockout or tagout
// devices…" — and verify isolation (d)(6). The placard's printed
// application box lists the same order, and the placard renderer uses
// this list to group steps. A procedure can have multiple rows per
// phase (e.g. two disconnects to isolate), but every phase except
// shutdown must be represented at least once.
export const LOTO_STEP_ORDER: LotoStepType[] = [
  'shutdown',
  'isolate',
  'lockout',
  'release_stored_energy',
  'verify_zero_energy',
]

export interface ProcedureStepInput {
  step_type: LotoStepType
  sequence_order: number
  // Tie-breakers for placard print order; see groupStepsByPhase.
  step_number?: number | null
  isolation_procedure?: string | null
}

export interface ProcedureValidationResult {
  valid: boolean
  /** Phase codes that the procedure is missing — in OSHA's order. */
  missing: LotoStepType[]
}

// Phases that MUST appear at least once. Shutdown is best-practice but
// not always documentable (some equipment is shut down by the previous
// production step), so we only block on the other four. Verify-zero
// is the one §147(d)(6) calls out by name — it is the hardest no.
const REQUIRED_PHASES: LotoStepType[] = LOTO_STEP_ORDER.filter(phase => phase !== 'shutdown')

/**
 * Validate a single equipment's energy-isolation procedure.
 *
 * Returns valid=true when every required phase is represented by at
 * least one step. Missing phases are returned in OSHA's documentation
 * order so the UI can render "Add a Release stored energy step" with
 * the same wording the standard uses.
 */
export function validateProcedure(steps: ProcedureStepInput[]): ProcedureValidationResult {
  const presentPhases = new Set<LotoStepType>(steps.map(s => s.step_type))
  const missing = REQUIRED_PHASES.filter(phase => !presentPhases.has(phase))
  return { valid: missing.length === 0, missing }
}

const PREREQUISITE = /\bAfter ([A-Za-z ,&/]+?) isolation/i

/**
 * How many other isolations a step says must already be done, read from
 * the opening clause of its isolation procedure: "After electrical and
 * pneumatic isolation…" names two. Mirrors `_prerequisite_count` in
 * scripts/export_placards_xlsx.py so the app and the workbook print the
 * same order.
 */
export function prerequisiteCount(step: Pick<ProcedureStepInput, 'isolation_procedure'>): number {
  const match = PREREQUISITE.exec(step.isolation_procedure ?? '')
  if (!match) return 0
  return match[1].split(/,|\band\b|&|\//).filter(name => name.trim()).length
}

function compareWithinPhase(a: ProcedureStepInput, b: ProcedureStepInput): number {
  return (a.sequence_order - b.sequence_order)
    || ((a.step_number ?? 0) - (b.step_number ?? 0))
    || (prerequisiteCount(a) - prerequisiteCount(b))
}

/**
 * Group steps by their OSHA phase for placard rendering. Within each
 * phase the steps are sorted by sequence_order so a multi-isolation
 * machine (two disconnects) renders in the order the admin keyed them.
 * Many placards number every step 1, so ties fall back to step_number
 * and then to the step's own "After … isolation" clause: a step prints
 * after the isolations it names instead of wherever the query left it.
 */
export function groupStepsByPhase<T extends ProcedureStepInput>(
  steps: T[],
): Array<{ phase: LotoStepType; steps: T[] }> {
  const buckets = new Map<LotoStepType, T[]>()
  for (const s of steps) {
    const list = buckets.get(s.step_type) ?? []
    list.push(s)
    buckets.set(s.step_type, list)
  }
  for (const list of buckets.values()) {
    list.sort(compareWithinPhase)
  }
  return LOTO_STEP_ORDER
    .filter(phase => buckets.has(phase))
    .map(phase => ({ phase, steps: buckets.get(phase)! }))
}
