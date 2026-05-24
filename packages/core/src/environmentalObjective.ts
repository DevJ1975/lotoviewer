// Shared logic for ISO 14001:2015 clause-6.2 environmental objectives and
// their clause-9.1.1 monitoring readings. Progress + "achieved?" depend on
// the improvement direction (most environmental targets reduce a quantity;
// some, like recycling rate, increase one), so they live here rather than
// being re-derived per surface.

export type ObjectiveStatus =
  | 'planned'
  | 'in_progress'
  | 'achieved'
  | 'missed'
  | 'cancelled'

export type ImprovementDirection = 'decrease' | 'increase'

export const OBJECTIVE_STATUSES: readonly { value: ObjectiveStatus; label: string }[] = [
  { value: 'planned',     label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'achieved',    label: 'Achieved' },
  { value: 'missed',      label: 'Missed' },
  { value: 'cancelled',   label: 'Cancelled' },
]

export const IMPROVEMENT_DIRECTIONS: readonly { value: ImprovementDirection; label: string }[] = [
  { value: 'decrease', label: 'Decrease (lower is better)' },
  { value: 'increase', label: 'Increase (higher is better)' },
]

/** True once the latest measured value meets the target in the objective's
 * improvement direction. Null inputs (no target or no reading yet) → false. */
export function isObjectiveAchieved(
  target: number | null,
  latest: number | null,
  direction: ImprovementDirection,
): boolean {
  if (target === null || latest === null) return false
  return direction === 'decrease' ? latest <= target : latest >= target
}

/** Progress from baseline toward target, 0..100, in the improvement
 * direction. Returns null when baseline/target/latest aren't all known.
 * When baseline === target (a "maintain" objective) progress is 100 once
 * achieved, else 0. Clamped so an overshoot reads as complete and a
 * regression past baseline reads as 0. */
export function objectiveProgressPct(
  baseline: number | null,
  target: number | null,
  latest: number | null,
  direction: ImprovementDirection,
): number | null {
  if (baseline === null || target === null || latest === null) return null

  const span = direction === 'decrease' ? baseline - target : target - baseline
  if (span === 0) return isObjectiveAchieved(target, latest, direction) ? 100 : 0

  const gained = direction === 'decrease' ? baseline - latest : latest - baseline
  const pct = (gained / span) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}
