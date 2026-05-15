// Hazard-control hierarchy helpers — ISO 45001 8.1.2.
//
// The five-level hierarchy of controls, in order of preference
// (highest first). An effective control program tilts toward the top
// of the list (eliminate / substitute / engineering) and uses PPE as
// a last line, not the first line. Surfacing the mix on a risk
// detail page is how the org sees whether their controls program is
// healthy or PPE-heavy.
//
// The DB column on risk_controls historically uses the long form
// (elimination, substitution). The classifier here accepts both forms
// so callers can pass values from either source without manual
// normalisation.

export type HazardControlHierarchyLevel =
  | 'eliminate'
  | 'substitute'
  | 'engineering'
  | 'administrative'
  | 'ppe'

export const HAZARD_CONTROL_HIERARCHY: readonly HazardControlHierarchyLevel[] = [
  'eliminate', 'substitute', 'engineering', 'administrative', 'ppe',
]

export const HAZARD_CONTROL_LABEL: Record<HazardControlHierarchyLevel, string> = {
  eliminate:      'Eliminate',
  substitute:     'Substitute',
  engineering:    'Engineering control',
  administrative: 'Administrative control',
  ppe:            'PPE',
}

// Long-form synonyms tolerated on input. Anything else returns null so
// the caller can decide how to handle it.
export function normalizeHierarchyLevel(raw: string | null | undefined): HazardControlHierarchyLevel | null {
  if (!raw) return null
  switch (raw) {
    case 'eliminate':
    case 'elimination':
      return 'eliminate'
    case 'substitute':
    case 'substitution':
      return 'substitute'
    case 'engineering':    return 'engineering'
    case 'administrative': return 'administrative'
    case 'ppe':            return 'ppe'
    default: return null
  }
}

export interface HazardControl {
  /** Either short form ('eliminate') or long form ('elimination'). */
  hierarchy_level: string
}

export interface HazardControlSummary {
  /** Count per level, in HAZARD_CONTROL_HIERARCHY order. */
  counts:      Record<HazardControlHierarchyLevel, number>
  total:       number
  /**
   * Highest-priority level represented in the list. NULL when the
   * input is empty or only contains unrecognised levels.
   */
  topOfStack:  HazardControlHierarchyLevel | null
}

/**
 * Aggregate a list of controls into per-level counts + the highest
 * level represented. "Highest" follows HAZARD_CONTROL_HIERARCHY order
 * — if any Eliminate exists, that's the top; else any Substitute; etc.
 *
 * Unrecognised hierarchy values are silently dropped — the summary is
 * UI-facing and rendering a blank-labeled bucket would confuse the
 * reader. Operators with unusual labels can extend the canonical list
 * here; the long-form fallback in normalizeHierarchyLevel already
 * covers the DB's existing values.
 */
export function summarizeControls(controls: HazardControl[]): HazardControlSummary {
  const counts: Record<HazardControlHierarchyLevel, number> = {
    eliminate:      0,
    substitute:     0,
    engineering:    0,
    administrative: 0,
    ppe:            0,
  }
  let total = 0
  for (const c of controls) {
    const normal = normalizeHierarchyLevel(c.hierarchy_level)
    if (!normal) continue
    counts[normal]++
    total++
  }
  // First match wins — HAZARD_CONTROL_HIERARCHY is ordered top → bottom.
  let topOfStack: HazardControlHierarchyLevel | null = null
  for (const level of HAZARD_CONTROL_HIERARCHY) {
    if (counts[level] > 0) {
      topOfStack = level
      break
    }
  }
  return { counts, total, topOfStack }
}
