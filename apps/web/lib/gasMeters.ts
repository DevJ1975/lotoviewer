import type { GasMeter } from '@/lib/types'

// Pure helpers for the bump-test / calibration register from migration 012.
// Kept tiny and side-effect-free so the test form can render the warning
// without round-tripping through supabase.

// A daily bump test is the de facto OSHA / ANSI Z117.1 expectation: every
// shift, every meter, before entry. We treat 24h as the freshness window —
// a meter bumped yesterday is "due", today it's fresh.
export const BUMP_TEST_WINDOW_MS = 24 * 60 * 60 * 1000

export type BumpStatus =
  | { kind: 'fresh';      hoursSince: number }   // bumped within the last 24h
  | { kind: 'overdue';    hoursSince: number }   // bumped >24h ago
  | { kind: 'never' }                            // meter row exists but has never been bumped
  | { kind: 'unknown' }                          // no meter row matching the instrument_id

// Compute how stale a meter is. nowMs is a parameter so tests are
// deterministic — same shape as partitionPermits / findExpiringSoon.
export function bumpStatus(meter: GasMeter | null, nowMs: number): BumpStatus {
  if (!meter) return { kind: 'unknown' }
  if (!meter.last_bump_at) return { kind: 'never' }
  const lastMs = new Date(meter.last_bump_at).getTime()
  if (Number.isNaN(lastMs)) return { kind: 'never' }
  const elapsed = nowMs - lastMs
  const hoursSince = Math.max(0, Math.round(elapsed / 3_600_000))
  if (elapsed <= BUMP_TEST_WINDOW_MS) return { kind: 'fresh',   hoursSince }
  return { kind: 'overdue', hoursSince }
}

// True when calibration is overdue per the meter's own next_calibration_due.
// Kept separate from bumpStatus because the failure mode is different —
// "calibration past due" is a red banner; "bump-test today missed" is a
// soft warning.
export function calibrationOverdue(meter: GasMeter | null, nowMs: number): boolean {
  if (!meter?.next_calibration_due) return false
  const dueMs = new Date(meter.next_calibration_due).getTime()
  if (Number.isNaN(dueMs)) return false
  return dueMs < nowMs
}
