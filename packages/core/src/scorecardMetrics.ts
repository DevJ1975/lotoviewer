import { supabase } from './supabaseClient'
import { evaluateTest, effectiveThresholds, type ThresholdSet } from './confinedSpaceThresholds'
import type {
  AtmosphericTest,
  ConfinedSpacePermit,
} from './types'

// EHS scorecard aggregator. The scorecard page is the "what does my
// safety program look like over time" view that an EHS director reads —
// distinct from the home page which is "what's happening right now."
//
// Same shape as homeMetrics: a pure summarizer + a thin DB orchestrator.
// The summarizer takes already-fetched rows so unit tests skip supabase
// entirely and just feed fixtures.

// ── Types ──────────────────────────────────────────────────────────────────

export interface DayBucket {
  // YYYY-MM-DD in UTC for stable sorting and chart keys.
  date:  string
  // Counts within the bucket.
  total: number
  fail:  number   // canceled permits / failing tests
}

export interface CancelReasonBucket {
  reason: string  // human-readable label, never a raw enum
  count:  number
}

export interface ScorecardMetrics {
  // Top KPI strip
  totalPermits:               number     // permits started in the window
  cancelRate:                 number     // 0-100 — share of permits in window canceled with reason != task_complete
  avgPermitDurationMinutes:   number     // canceled permits in window — start to cancel
  failingTestRate:            number     // 0-100 — share of tests in window with status === 'fail'
  photoCompletionPct:         number     // current LOTO photo coverage; same as home

  // Trend series
  permitsByDay:               DayBucket[]
  testsByDay:                 DayBucket[]
  cancelReasonBreakdown:      CancelReasonBucket[]

  // Echo of the window so the page can label charts accurately
  windowDays:                 number
  nowMs:                      number
}

// ── Pure helpers ───────────────────────────────────────────────────────────

// Bucket a list of timestamps into UTC days within a sliding window.
// Buckets are dense — every day in the window appears even if its count
// is zero, so a chart x-axis stays continuous.
export function bucketByDay<T>(
  rows: T[],
  getTimestamp: (r: T) => string | null | undefined,
  isFail:        (r: T) => boolean,
  windowDays:    number,
  nowMs:         number,
): DayBucket[] {
  const dayMs = 24 * 60 * 60 * 1000
  const startMs = nowMs - (windowDays - 1) * dayMs
  // Index: YYYY-MM-DD → bucket. Pre-fill with zeros so empty days render.
  const buckets = new Map<string, DayBucket>()
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(startMs + i * dayMs)
    const key = d.toISOString().slice(0, 10)
    buckets.set(key, { date: key, total: 0, fail: 0 })
  }
  for (const r of rows) {
    const ts = getTimestamp(r)
    if (!ts) continue
    const ms = new Date(ts).getTime()
    if (Number.isNaN(ms)) continue
    if (ms < startMs || ms > nowMs) continue
    const key = new Date(ms).toISOString().slice(0, 10)
    const b = buckets.get(key)
    if (!b) continue
    b.total += 1
    if (isFail(r)) b.fail += 1
  }
  // Map → array preserves insertion order, which is chronological.
  return [...buckets.values()]
}

// Group canceled permits by reason. Renders as a small horizontal bar
// chart. We humanize the enum values here so the page doesn't rebuild
// the lookup table.
const CANCEL_REASON_LABELS: Record<string, string> = {
  task_complete:        'Task complete',
  prohibited_condition: 'Prohibited condition',
  expired:              'Expired',
  other:                'Other',
}

export function cancelReasonBreakdown(
  permits: Pick<ConfinedSpacePermit, 'canceled_at' | 'cancel_reason' | 'started_at'>[],
  windowDays: number,
  nowMs: number,
): CancelReasonBucket[] {
  const startMs = nowMs - windowDays * 24 * 60 * 60 * 1000
  const counts = new Map<string, number>()
  for (const p of permits) {
    if (!p.canceled_at || !p.cancel_reason) continue
    const ms = new Date(p.canceled_at).getTime()
    if (Number.isNaN(ms) || ms < startMs || ms > nowMs) continue
    counts.set(p.cancel_reason, (counts.get(p.cancel_reason) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason: CANCEL_REASON_LABELS[reason] ?? reason,
      count,
    }))
    .sort((a, b) => b.count - a.count)
}

// Average permit duration in minutes for permits that started AND ended
// (canceled) inside the window. Permits still active are excluded — we
// don't want a long-running active permit to skew the historical average.
export function avgPermitDurationMinutes(
  permits: Pick<ConfinedSpacePermit, 'started_at' | 'canceled_at'>[],
  windowDays: number,
  nowMs: number,
): number {
  const startMs = nowMs - windowDays * 24 * 60 * 60 * 1000
  let totalMin = 0
  let count = 0
  for (const p of permits) {
    if (!p.canceled_at) continue
    const sMs = new Date(p.started_at).getTime()
    const cMs = new Date(p.canceled_at).getTime()
    if (Number.isNaN(sMs) || Number.isNaN(cMs)) continue
    if (cMs < startMs || cMs > nowMs) continue
    if (cMs <= sMs) continue   // dirty data — guard against negatives
    totalMin += (cMs - sMs) / 60_000
    count += 1
  }
  return count === 0 ? 0 : Math.round(totalMin / count)
}

// Compose the scorecard from already-fetched rows.
export function summarizeScorecardFromRows({
  permits, tests, thresholds, equipPhotoStatus, windowDays, nowMs,
}: {
  permits:          ConfinedSpacePermit[]
  tests:            AtmosphericTest[]
  // One ThresholdSet for evaluation. Real plants vary thresholds by
  // permit/space; the scorecard accepts a single set for simplicity —
  // the failing-rate it produces is "vs. the site default" which is the
  // most actionable framing for an EHS director (per-permit overrides
  // produce noise on a 30-day rollup).
  thresholds:       ThresholdSet
  equipPhotoStatus: Array<{ photo_status: 'missing' | 'partial' | 'complete' }>
  windowDays:       number
  nowMs:            number
}): ScorecardMetrics {
  const startMs = nowMs - windowDays * 24 * 60 * 60 * 1000

  // Permits started in the window — what an EHS director treats as
  // "permits this month."
  const permitsInWindow = permits.filter(p => {
    const ms = new Date(p.started_at).getTime()
    return !Number.isNaN(ms) && ms >= startMs && ms <= nowMs
  })

  // Cancel rate excludes task_complete from the "failure" definition —
  // that's a normal close-out, not a problem.
  const canceledNonRoutine = permitsInWindow.filter(p =>
    p.canceled_at && p.cancel_reason && p.cancel_reason !== 'task_complete',
  )
  const cancelRate = permitsInWindow.length === 0
    ? 0
    : Math.round((canceledNonRoutine.length / permitsInWindow.length) * 100)

  const testsInWindow = tests.filter(t => {
    const ms = new Date(t.tested_at).getTime()
    return !Number.isNaN(ms) && ms >= startMs && ms <= nowMs
  })
  const failingTests = testsInWindow.filter(t => evaluateTest(t, thresholds).status === 'fail')
  const failingTestRate = testsInWindow.length === 0
    ? 0
    : Math.round((failingTests.length / testsInWindow.length) * 100)

  const totalEquip    = equipPhotoStatus.length
  const completeEquip = equipPhotoStatus.filter(r => r.photo_status === 'complete').length
  const photoCompletionPct = totalEquip === 0 ? 0 : Math.round((completeEquip / totalEquip) * 100)

  return {
    totalPermits:             permitsInWindow.length,
    cancelRate,
    avgPermitDurationMinutes: avgPermitDurationMinutes(permitsInWindow, windowDays, nowMs),
    failingTestRate,
    photoCompletionPct,
    permitsByDay: bucketByDay(
      permitsInWindow,
      p => p.started_at,
      p => !!(p.canceled_at && p.cancel_reason && p.cancel_reason !== 'task_complete'),
      windowDays, nowMs,
    ),
    testsByDay: bucketByDay(
      testsInWindow,
      t => t.tested_at,
      t => evaluateTest(t, thresholds).status === 'fail',
      windowDays, nowMs,
    ),
    cancelReasonBreakdown: cancelReasonBreakdown(permitsInWindow, windowDays, nowMs),
    windowDays,
    nowMs,
  }
}

// ── DB orchestration ───────────────────────────────────────────────────────

export async function fetchScorecardMetrics(windowDays: number = 30): Promise<ScorecardMetrics> {
  const nowMs = Date.now()
  const startIso = new Date(nowMs - windowDays * 24 * 60 * 60 * 1000).toISOString()

  // Three parallel reads, scoped server-side by created_at / tested_at /
  // started_at to keep payloads small even on busy sites. We don't paginate
  // — at 30 days the upper bound is hundreds of permits, easily inline.
  const [permitsRes, testsRes, equipRes] = await Promise.all([
    supabase
      .from('loto_confined_space_permits')
      .select('*')
      .gte('started_at', startIso)
      .order('started_at', { ascending: true }),
    supabase
      .from('loto_atmospheric_tests')
      .select('*')
      .gte('tested_at', startIso)
      .order('tested_at', { ascending: true }),
    supabase
      .from('loto_equipment')
      .select('photo_status')
      .eq('decommissioned', false),
  ])

  const permits          = (permitsRes.data ?? []) as ConfinedSpacePermit[]
  const tests            = (testsRes.data   ?? []) as AtmosphericTest[]
  const equipPhotoStatus = (equipRes.data   ?? []) as Array<{ photo_status: 'missing' | 'partial' | 'complete' }>

  return summarizeScorecardFromRows({
    permits, tests,
    thresholds: effectiveThresholds(null, null),  // site defaults
    equipPhotoStatus, windowDays, nowMs,
  })
}
