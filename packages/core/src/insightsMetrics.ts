import { supabase } from './supabaseClient'
import { evaluateTest, effectiveThresholds, type ThresholdSet } from './confinedSpaceThresholds'
import type {
  AtmosphericTest,
  ConfinedSpace,
  ConfinedSpacePermit,
} from './types'

// Risk intelligence — the dashboard one tier deeper than the EHS scorecard
// (lib/scorecardMetrics.ts). The scorecard answers "how is my safety
// program doing?" with KPI-shaped numbers. Insights answers "where should
// I look harder?" with attributable, drill-down-friendly views:
//
//   - Which SPACES fail tests most often (a tank that fails 3× more than
//     average is either a real hazard or a calibration issue worth
//     chasing).
//   - Which atmospheric READINGS are unusual for the space they came
//     from (z-score against the per-space historical baseline).
//   - Which SUPERVISORS issue permits, with their cancel-reason mix.
//
// Same shape as scorecardMetrics.ts: pure summarizers fed by a thin DB
// orchestrator. Tests skip supabase by feeding fixtures to the
// summarizers directly.

// ── Types ──────────────────────────────────────────────────────────────────

export interface SpaceFailureRow {
  space_id:    string
  description: string | null
  totalTests:  number
  passCount:   number
  failCount:   number
  // 0-100. Computed only when totalTests > 0; otherwise null so the row
  // can be filtered out of "worst spaces" rankings without a divide-by-
  // zero.
  failRatePct: number | null
}

export interface ReadingAnomaly {
  // Pinpoints the reading — open from the page to drill in.
  testId:       string
  permitId:     string
  spaceId:      string
  testedAt:     string
  // Which channel(s) were anomalous. A reading might be flagged on
  // multiple channels independently.
  channel:      'o2' | 'lel' | 'h2s' | 'co'
  value:        number
  // Per-space baseline used for the z-score. baseline === null when
  // the space has fewer than MIN_BASELINE_SAMPLES historical tests
  // for this channel; in that case zScore is also null.
  baselineMean: number | null
  baselineStd:  number | null
  zScore:       number | null
  // Quick-read severity: 'high' = |z| ≥ 3, 'moderate' = 2 ≤ |z| < 3.
  severity:     'high' | 'moderate'
}

export interface SupervisorRow {
  supervisorId:        string
  permitsIssued:       number
  permitsSigned:       number     // signed = supervisor authorized entry (active)
  cancelTaskComplete:  number     // canceled with reason 'task_complete' (clean close-out)
  cancelForCause:      number     // canceled with reason != 'task_complete' (concerning)
  avgPermitMinutes:    number     // mean of (canceled_at - started_at) for permits canceled in window
}

export interface InsightsMetrics {
  windowDays:        number
  nowMs:             number
  // Worst-failing spaces, sorted by failRatePct desc. Spaces with
  // < MIN_FAIL_RANK_TESTS tests are excluded so a single bad reading
  // doesn't put a never-tested space at the top.
  worstSpaces:       SpaceFailureRow[]
  // All anomalies in the window, sorted newest-first then by |z| desc.
  // Caller usually slices to the top N.
  anomalies:         ReadingAnomaly[]
  // Active supervisors in the window, sorted by permitsIssued desc.
  supervisors:       SupervisorRow[]
}

// ── Pure helpers ───────────────────────────────────────────────────────────

// Spaces with fewer than this many tests don't get ranked — too noisy.
// Tuned for "a space gets tested at least once a week"; loosen if you
// want to see less-busy spaces.
export const MIN_FAIL_RANK_TESTS = 5

// Spaces with fewer than this many historical tests for a channel don't
// get a z-score — the standard deviation of 4 samples isn't a baseline.
export const MIN_BASELINE_SAMPLES = 8

// |z| threshold for flagging an anomaly. 2σ is conventional for "worth
// looking at"; 3σ is "definitely investigate."
const Z_HIGH     = 3
const Z_MODERATE = 2

// Dense per-space failure rate over a window. Spaces with no tests in
// the window simply don't appear; that's fine — the rank list is for
// "where to look harder," not "every space ever."
export function computeSpaceFailureRows(args: {
  tests:      AtmosphericTest[]
  permits:    ConfinedSpacePermit[]
  spaces:     ConfinedSpace[]
  windowDays: number
  nowMs:      number
  // Per-permit threshold computer. Defaults to effectiveThresholds
  // against the parent space, which is what the runtime evaluator uses.
  computeThresholds?: (permit: ConfinedSpacePermit, space: ConfinedSpace) => ThresholdSet
}): SpaceFailureRow[] {
  const { tests, permits, spaces, windowDays, nowMs } = args
  const thresholdsFor = args.computeThresholds ?? effectiveThresholds
  const startMs = nowMs - windowDays * 24 * 60 * 60 * 1000

  const permitById = new Map<string, ConfinedSpacePermit>()
  for (const p of permits) permitById.set(p.id, p)
  const spaceById = new Map<string, ConfinedSpace>()
  for (const s of spaces) spaceById.set(s.space_id, s)

  // Aggregate per space.
  const bySpace = new Map<string, SpaceFailureRow>()
  for (const t of tests) {
    const ts = new Date(t.tested_at).getTime()
    if (Number.isNaN(ts) || ts < startMs || ts > nowMs) continue
    const permit = permitById.get(t.permit_id)
    if (!permit) continue
    const space = spaceById.get(permit.space_id)
    if (!space) continue

    let row = bySpace.get(space.space_id)
    if (!row) {
      row = {
        space_id:    space.space_id,
        description: space.description,
        totalTests:  0,
        passCount:   0,
        failCount:   0,
        failRatePct: null,
      }
      bySpace.set(space.space_id, row)
    }
    const status = evaluateTest(t, thresholdsFor(permit, space)).status
    row.totalTests += 1
    if (status === 'pass') row.passCount += 1
    if (status === 'fail') row.failCount += 1
  }

  for (const row of bySpace.values()) {
    if (row.totalTests > 0) {
      row.failRatePct = Math.round((row.failCount / row.totalTests) * 100)
    }
  }

  return [...bySpace.values()]
    // Filter the noisy floor — the rank is about confidence, not
    // completeness.
    .filter(r => r.totalTests >= MIN_FAIL_RANK_TESTS)
    .sort((a, b) => (b.failRatePct ?? 0) - (a.failRatePct ?? 0))
}

// Per-space, per-channel mean and stdev used for anomaly detection.
// Computed over historical tests OUTSIDE the evaluation window so the
// candidate readings inside the window don't contaminate their own
// baseline. A space that only has tests inside the window simply doesn't
// get a baseline (and its readings don't get z-scored) — that's the
// right answer for a brand-new space without enough history.
//
// Tests with null values for a channel are excluded from that channel's
// stats but contribute to others.
function buildBaselines(
  tests:    AtmosphericTest[],
  permits:  ConfinedSpacePermit[],
  startMs:  number,    // start of the evaluation window
): Map<string, {
  o2:  { mean: number; std: number; n: number } | null
  lel: { mean: number; std: number; n: number } | null
  h2s: { mean: number; std: number; n: number } | null
  co:  { mean: number; std: number; n: number } | null
}> {
  const permitById = new Map<string, ConfinedSpacePermit>()
  for (const p of permits) permitById.set(p.id, p)

  // First pass — collect raw values per (space, channel) for tests
  // older than the window only.
  const samples = new Map<string, { o2: number[]; lel: number[]; h2s: number[]; co: number[] }>()
  for (const t of tests) {
    const ts = new Date(t.tested_at).getTime()
    if (Number.isNaN(ts) || ts >= startMs) continue
    const permit = permitById.get(t.permit_id)
    if (!permit) continue
    let s = samples.get(permit.space_id)
    if (!s) {
      s = { o2: [], lel: [], h2s: [], co: [] }
      samples.set(permit.space_id, s)
    }
    if (t.o2_pct  != null) s.o2.push(t.o2_pct)
    if (t.lel_pct != null) s.lel.push(t.lel_pct)
    if (t.h2s_ppm != null) s.h2s.push(t.h2s_ppm)
    if (t.co_ppm  != null) s.co.push(t.co_ppm)
  }

  // Second pass — compute mean / stdev when sample count is enough.
  type ChannelStat = { mean: number; std: number; n: number } | null
  type SpaceBaseline = { o2: ChannelStat; lel: ChannelStat; h2s: ChannelStat; co: ChannelStat }
  const out = new Map<string, SpaceBaseline>()
  for (const [spaceId, s] of samples) {
    out.set(spaceId, {
      o2:  computeStat(s.o2),
      lel: computeStat(s.lel),
      h2s: computeStat(s.h2s),
      co:  computeStat(s.co),
    })
  }
  return out
}

function computeStat(values: number[]): { mean: number; std: number; n: number } | null {
  if (values.length < MIN_BASELINE_SAMPLES) return null
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  // Sample standard deviation (n-1). On ≥8 samples this is materially
  // the same as population stdev; we pick sample to match what most
  // statistics texts call "the" standard deviation.
  let sumSq = 0
  for (const v of values) sumSq += (v - mean) ** 2
  const std = Math.sqrt(sumSq / Math.max(1, n - 1))
  return { mean, std, n }
}

// Z-score-based anomaly detection over a window. A reading is "anomalous"
// when its value is > Z_MODERATE stdevs from the per-space historical
// baseline for that channel. Channels are evaluated independently — a
// reading flagged on O₂ is one row; if it's also flagged on LEL, that's a
// second row.
//
// Returns nothing if the per-space baseline doesn't have enough samples
// for the channel — small spaces don't produce false positives just
// because their stdev is tiny.
export function computeAnomalies(args: {
  tests:      AtmosphericTest[]      // all tests, for baseline + window slice
  permits:    ConfinedSpacePermit[]
  windowDays: number
  nowMs:      number
}): ReadingAnomaly[] {
  const { tests, permits, windowDays, nowMs } = args
  const startMs = nowMs - windowDays * 24 * 60 * 60 * 1000
  const baselines = buildBaselines(tests, permits, startMs)
  const permitById = new Map<string, ConfinedSpacePermit>()
  for (const p of permits) permitById.set(p.id, p)

  const out: ReadingAnomaly[] = []
  for (const t of tests) {
    const ts = new Date(t.tested_at).getTime()
    if (Number.isNaN(ts) || ts < startMs || ts > nowMs) continue
    const permit = permitById.get(t.permit_id)
    if (!permit) continue
    const baseline = baselines.get(permit.space_id)
    if (!baseline) continue

    const channels: Array<['o2' | 'lel' | 'h2s' | 'co', number | null]> = [
      ['o2',  t.o2_pct],
      ['lel', t.lel_pct],
      ['h2s', t.h2s_ppm],
      ['co',  t.co_ppm],
    ]
    for (const [channel, value] of channels) {
      if (value == null) continue
      const stat = baseline[channel]
      if (!stat) continue                     // not enough history
      // Skip when the baseline is effectively constant. Strict-equality
      // doesn't catch floating-point residue (10 readings of 20.9 produce
      // a stdev of ~3.7e-15 due to binary FP, not exactly 0). 1e-6 sits
      // safely below real measurement noise — atmospheric readings are
      // reported to 1-2 decimals — so anything below it is FP only.
      if (stat.std < 1e-6) continue
      const z = (value - stat.mean) / stat.std
      const az = Math.abs(z)
      if (az < Z_MODERATE) continue
      out.push({
        testId:       t.id,
        permitId:     t.permit_id,
        spaceId:      permit.space_id,
        testedAt:     t.tested_at,
        channel,
        value,
        baselineMean: stat.mean,
        baselineStd:  stat.std,
        zScore:       z,
        severity:     az >= Z_HIGH ? 'high' : 'moderate',
      })
    }
  }

  // Newest-first; tie-breaks by absolute z desc so the most striking
  // anomalies on the same day sort to the top.
  return out.sort((a, b) => {
    const da = new Date(a.testedAt).getTime()
    const db = new Date(b.testedAt).getTime()
    if (db !== da) return db - da
    return Math.abs(b.zScore ?? 0) - Math.abs(a.zScore ?? 0)
  })
}

// Per-supervisor activity summary in a window.
export function computeSupervisorRows(args: {
  permits:    ConfinedSpacePermit[]
  windowDays: number
  nowMs:      number
}): SupervisorRow[] {
  const { permits, windowDays, nowMs } = args
  const startMs = nowMs - windowDays * 24 * 60 * 60 * 1000

  const bySupervisor = new Map<string, SupervisorRow & { _durations: number[] }>()
  for (const p of permits) {
    const sid = p.entry_supervisor_id
    if (!sid) continue
    const startedMs = new Date(p.started_at).getTime()
    if (Number.isNaN(startedMs) || startedMs < startMs || startedMs > nowMs) continue

    let row = bySupervisor.get(sid)
    if (!row) {
      row = {
        supervisorId:        sid,
        permitsIssued:       0,
        permitsSigned:       0,
        cancelTaskComplete:  0,
        cancelForCause:      0,
        avgPermitMinutes:    0,
        _durations:          [],
      }
      bySupervisor.set(sid, row)
    }
    row.permitsIssued += 1
    if (p.entry_supervisor_signature_at) row.permitsSigned += 1
    if (p.canceled_at) {
      const cancelMs = new Date(p.canceled_at).getTime()
      // Defensive against backwards clocks / bad data.
      if (!Number.isNaN(cancelMs) && cancelMs >= startedMs) {
        row._durations.push((cancelMs - startedMs) / 60_000)
      }
      if (p.cancel_reason === 'task_complete') row.cancelTaskComplete += 1
      else                                     row.cancelForCause += 1
    }
  }

  // Avg duration per supervisor, then drop the working accumulator.
  const out: SupervisorRow[] = []
  for (const row of bySupervisor.values()) {
    const n = row._durations.length
    const avg = n === 0 ? 0
      : Math.round(row._durations.reduce((a, b) => a + b, 0) / n)
    out.push({
      supervisorId:       row.supervisorId,
      permitsIssued:      row.permitsIssued,
      permitsSigned:      row.permitsSigned,
      cancelTaskComplete: row.cancelTaskComplete,
      cancelForCause:     row.cancelForCause,
      avgPermitMinutes:   avg,
    })
  }
  return out.sort((a, b) => b.permitsIssued - a.permitsIssued)
}

// ── Orchestrator ───────────────────────────────────────────────────────────

export async function fetchInsightsMetrics(windowDays: number = 90): Promise<InsightsMetrics> {
  // Ranking + anomaly detection both want the FULL test history (for
  // baselines), so we don't filter at the DB. Permits are bounded by
  // started_at because canceling outside the window doesn't change
  // who issued them in the window.
  const [permitsRes, testsRes, spacesRes] = await Promise.all([
    supabase.from('loto_confined_space_permits').select('*'),
    supabase.from('loto_atmospheric_tests').select('*'),
    supabase.from('loto_confined_spaces').select('*'),
  ])
  if (permitsRes.error) throw new Error(`permits: ${permitsRes.error.message}`)
  if (testsRes.error)   throw new Error(`tests: ${testsRes.error.message}`)
  if (spacesRes.error)  throw new Error(`spaces: ${spacesRes.error.message}`)

  const permits = (permitsRes.data ?? []) as ConfinedSpacePermit[]
  const tests   = (testsRes.data   ?? []) as AtmosphericTest[]
  const spaces  = (spacesRes.data  ?? []) as ConfinedSpace[]
  const nowMs   = Date.now()

  return {
    windowDays,
    nowMs,
    worstSpaces: computeSpaceFailureRows({ tests, permits, spaces, windowDays, nowMs }),
    anomalies:   computeAnomalies({ tests, permits, windowDays, nowMs }),
    supervisors: computeSupervisorRows({ permits, windowDays, nowMs }),
  }
}
