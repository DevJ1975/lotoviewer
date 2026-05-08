// BBS aggregator — reads the active tenant's bbs_observations (RLS
// scopes the result for us) and computes the numbers that drive both
// the home KPI panel and the BBS scorecard page.
//
// Composite scorecard formula (per period — default = trailing 30d):
//
//   participation    = count(*) submissions
//   close_out_rate   = closed_unsafe / total_unsafe   (1.0 if no unsafe)
//   severity_weight  = avg(risk_score) / 9            (0..1)
//
//   ehs_score = clamp(
//     0,
//     100,
//     round( min(participation, target) / target * 60      // 0..60
//          + close_out_rate * 30                            // 0..30
//          + (1 - severity_weight) * 10                     // 0..10
//     )
//   )
//
// Tunables: `target` defaults to 20 submissions/period — adjust per
// tenant once we add bbs_settings (out of scope for this PR).

import { supabase } from './supabaseClient'
import {
  type BBSKind,
  type BBSStatus,
  ACTIVE_BBS_STATUSES,
} from './bbs'

export interface BBSObservationForMetrics {
  id:               string
  report_number:    string | null
  kind:             BBSKind
  status:           BBSStatus
  risk_score:       number | null
  points_awarded:   number
  submitted_by:     string | null
  observed_at:      string
  closed_at:        string | null
  created_at:       string
}

export interface BBSLeaderboardRow {
  user_id:                 string
  full_name:               string | null
  avatar_url:              string | null
  observation_count:       number
  points_total:            number
  unsafe_act_count:        number
  unsafe_condition_count:  number
  safe_behavior_count:     number
  last_submitted_at:       string | null
}

export interface BBSMetrics {
  totalActive:        number
  totalAll:           number
  totalUnsafeAct:     number
  totalUnsafeCondition: number
  totalSafeBehavior:  number
  /** Submissions in trailing 30 days. */
  newLast30Days:      number
  /** % of unsafe observations whose status is 'closed' (in window). */
  closeOutRate:       number
  /** Average risk_score among unsafe observations in window (1..9 or null). */
  avgRiskScore:       number | null
  /** Composite EHS scorecard contribution, 0..100. */
  ehsScore:           number
  /** Top contributors (logged-in users only). */
  leaderboard:        BBSLeaderboardRow[]
}

const DEFAULT_PARTICIPATION_TARGET = 20

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers — testable without a DB.
// ──────────────────────────────────────────────────────────────────────────

export function selectActive(rows: BBSObservationForMetrics[]): BBSObservationForMetrics[] {
  return rows.filter(r => (ACTIVE_BBS_STATUSES as readonly string[]).includes(r.status))
}

export function countCreatedSince(
  rows: BBSObservationForMetrics[],
  windowDays: number,
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - windowDays * 86_400_000
  let n = 0
  for (const r of rows) {
    if (Date.parse(r.created_at) >= cutoff) n++
  }
  return n
}

export function computeCloseOutRate(rows: BBSObservationForMetrics[]): number {
  const unsafe = rows.filter(r => r.kind !== 'safe_behavior' && r.status !== 'invalid')
  if (unsafe.length === 0) return 1
  const closed = unsafe.filter(r => r.status === 'closed').length
  return closed / unsafe.length
}

export function computeAvgRiskScore(rows: BBSObservationForMetrics[]): number | null {
  const scored = rows.filter(r => typeof r.risk_score === 'number')
  if (scored.length === 0) return null
  return scored.reduce((s, r) => s + (r.risk_score ?? 0), 0) / scored.length
}

export function computeEhsScore(args: {
  participation:       number
  closeOutRate:        number
  avgRiskScore:        number | null
  participationTarget?: number
}): number {
  const target = args.participationTarget ?? DEFAULT_PARTICIPATION_TARGET
  const participationComponent = Math.min(args.participation, target) / target * 60
  const closeOutComponent      = args.closeOutRate * 30
  const severityComponent      = (1 - (args.avgRiskScore ? args.avgRiskScore / 9 : 0)) * 10
  const total = participationComponent + closeOutComponent + severityComponent
  return Math.max(0, Math.min(100, Math.round(total)))
}

// ──────────────────────────────────────────────────────────────────────────
// Fetch
// ──────────────────────────────────────────────────────────────────────────

export async function fetchBBSMetrics(): Promise<BBSMetrics | null> {
  const [observationsRes, leaderboardRes] = await Promise.all([
    supabase
      .from('bbs_observations')
      .select('id, report_number, kind, status, risk_score, points_awarded, submitted_by, observed_at, closed_at, created_at')
      .order('created_at', { ascending: false })
      .limit(2000),
    supabase
      .from('bbs_leaderboard')
      .select('user_id, full_name, avatar_url, observation_count, points_total, unsafe_act_count, unsafe_condition_count, safe_behavior_count, last_submitted_at')
      .order('points_total', { ascending: false })
      .limit(10),
  ])

  if (observationsRes.error) {
    console.warn('[bbsMetrics] observations fetch failed', observationsRes.error)
    return null
  }
  if (leaderboardRes.error) {
    console.warn('[bbsMetrics] leaderboard fetch failed', leaderboardRes.error)
    // Leaderboard is non-fatal — we still return metrics with an
    // empty list rather than null the whole panel.
  }

  const rows = (observationsRes.data ?? []) as unknown as BBSObservationForMetrics[]
  const window30 = rows.filter(r => Date.parse(r.created_at) >= Date.now() - 30 * 86_400_000)
  const closeOutRate = computeCloseOutRate(window30)
  const avgRiskScore = computeAvgRiskScore(
    window30.filter(r => r.kind !== 'safe_behavior'),
  )

  const newLast30Days = window30.length
  const ehsScore = computeEhsScore({
    participation: newLast30Days,
    closeOutRate,
    avgRiskScore,
  })

  return {
    totalActive:          selectActive(rows).length,
    totalAll:             rows.length,
    totalUnsafeAct:       rows.filter(r => r.kind === 'unsafe_act').length,
    totalUnsafeCondition: rows.filter(r => r.kind === 'unsafe_condition').length,
    totalSafeBehavior:    rows.filter(r => r.kind === 'safe_behavior').length,
    newLast30Days,
    closeOutRate,
    avgRiskScore,
    ehsScore,
    leaderboard:          (leaderboardRes.data ?? []) as unknown as BBSLeaderboardRow[],
  }
}
