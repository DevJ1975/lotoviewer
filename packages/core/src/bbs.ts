// Behavior-Based Safety (BBS) — shared types + pure scoring helpers.
//
// Mirrors the shape of `nearMiss.ts` so the web + mobile clients can
// import a single source of truth. Pure functions only — no DB calls.
// `bbsMetrics.ts` has the Supabase-bound aggregator.

export const BBS_KINDS = ['unsafe_act', 'unsafe_condition', 'safe_behavior'] as const
export type BBSKind = typeof BBS_KINDS[number]

export const BBS_KIND_LABEL: Record<BBSKind, string> = {
  unsafe_act:       'Unsafe Act',
  unsafe_condition: 'Unsafe Condition',
  safe_behavior:    'Safe Behavior',
}

export const BBS_SEVERITY = ['low', 'medium', 'high'] as const
export type BBSSeverity = typeof BBS_SEVERITY[number]

export const BBS_LIKELIHOOD = ['low', 'medium', 'high'] as const
export type BBSLikelihood = typeof BBS_LIKELIHOOD[number]

export const BBS_STATUSES = ['open', 'in_progress', 'closed', 'invalid'] as const
export type BBSStatus = typeof BBS_STATUSES[number]

export const ACTIVE_BBS_STATUSES = ['open', 'in_progress'] as const

export const BBS_STATUS_LABEL: Record<BBSStatus, string> = {
  open:        'Open',
  in_progress: 'In progress',
  closed:      'Closed',
  invalid:     'Invalid',
}

// 3x3 risk matrix score: severity * likelihood, 1..3 each. Returns
// 1..9, or null if either input is missing. Matches the Postgres
// function `bbs_score_for()` in migration 081 — keep them in sync.
export function bbsScoreFor(
  severity:   BBSSeverity | null | undefined,
  likelihood: BBSLikelihood | null | undefined,
): number | null {
  if (!severity || !likelihood) return null
  const sev  = severity   === 'low' ? 1 : severity   === 'medium' ? 2 : 3
  const like = likelihood === 'low' ? 1 : likelihood === 'medium' ? 2 : 3
  return sev * like
}

// Risk band by score:
//   1..2  → low
//   3..4  → moderate
//   6..9  → high  (5 isn't possible on 1..3 axes; included defensively)
export type BBSRiskBand = 'low' | 'moderate' | 'high'
export function bbsRiskBand(score: number | null | undefined): BBSRiskBand | null {
  if (score == null) return null
  if (score <= 2) return 'low'
  if (score <= 4) return 'moderate'
  return 'high'
}

// Gamification points. Mirrors the Postgres `bbs_points_for_kind()`
// helper. Anonymous submissions still produce a point value, but the
// leaderboard view filters them out at the SQL level.
export function bbsPointsForKind(
  kind:  BBSKind,
  score: number | null | undefined,
): number {
  switch (kind) {
    case 'safe_behavior':    return 5
    case 'unsafe_condition': return 10 + (score ?? 0)
    case 'unsafe_act':       return 10 + (score ?? 0)
  }
}

// Validate a submission payload before sending it to the server. Used
// by both the authenticated form and the anonymous QR form.
export interface BBSCreateInput {
  kind:                 BBSKind
  description:          string
  severity?:            BBSSeverity | null
  likelihood?:          BBSLikelihood | null
  category?:            string | null
  location_text?:       string | null
  department?:          string | null
  immediate_action_taken?: string | null
  abc_antecedent?:      string | null
  abc_behavior?:        string | null
  abc_consequence?:     string | null
  submitted_name?:      string | null
  submitted_email?:     string | null
  qr_token?:            string | null
}

export interface BBSValidationError {
  field:   keyof BBSCreateInput | '_form'
  message: string
}

export function validateBBSCreateInput(input: BBSCreateInput): BBSValidationError[] {
  const errors: BBSValidationError[] = []

  if (!BBS_KINDS.includes(input.kind)) {
    errors.push({ field: 'kind', message: 'Pick a kind' })
  }
  if (!input.description || input.description.trim().length < 5) {
    errors.push({ field: 'description', message: 'Describe what you observed (at least 5 characters)' })
  }
  if (input.kind !== 'safe_behavior') {
    if (!input.severity)   errors.push({ field: 'severity',   message: 'Severity is required for unsafe observations' })
    if (!input.likelihood) errors.push({ field: 'likelihood', message: 'Likelihood is required for unsafe observations' })
  }
  if (input.submitted_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.submitted_email)) {
    errors.push({ field: 'submitted_email', message: 'Enter a valid email or leave blank' })
  }
  return errors
}
