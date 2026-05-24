// Shared constants + logic for the ISO 14001:2015 §9.3 management review
// (migration 207). The standard input/output agendas live here so the
// review form renders the same checklist an auditor expects.

export type ReviewStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export const REVIEW_STATUSES: readonly { value: ReviewStatus; label: string }[] = [
  { value: 'scheduled',   label: 'Scheduled' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed',   label: 'Completed' },
  { value: 'cancelled',   label: 'Cancelled' },
]

/** §9.3.2 — the inputs a management review must consider. */
export const MANAGEMENT_REVIEW_INPUTS: readonly string[] = [
  'Status of actions from previous management reviews',
  'Changes in external & internal issues relevant to the EMS',
  'Changes in compliance obligations and significant environmental aspects',
  'Extent to which environmental objectives have been met',
  'Nonconformities and corrective actions',
  'Monitoring & measurement results',
  'Audit results and evaluation of compliance',
  'Adequacy of resources',
  'Relevant communications from interested parties',
  'Opportunities for continual improvement',
]

/** §9.3.3 — the outputs a management review must produce. */
export const MANAGEMENT_REVIEW_OUTPUTS: readonly string[] = [
  'Conclusions on the continuing suitability, adequacy & effectiveness of the EMS',
  'Decisions on continual-improvement opportunities',
  'Decisions on any need for changes to the EMS',
  'Decisions on resource needs',
  'Actions needed where objectives have not been met',
  'Implications for the strategic direction of the organization',
]

/** Mirrors the DB check (period_end >= period_start). Either bound absent
 * is valid (an open or single-date review). */
export function isValidReviewPeriod(
  periodStart: string | null,
  periodEnd: string | null,
): boolean {
  if (!periodStart || !periodEnd) return true
  return periodEnd >= periodStart
}

/** A review has produced §9.3.3 outputs once it records conclusions or
 * decisions — used to flag reviews still awaiting write-up. */
export function reviewHasOutputs(review: { conclusions: string | null; decisions: string | null }): boolean {
  return Boolean(review.conclusions?.trim() || review.decisions?.trim())
}
