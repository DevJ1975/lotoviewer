import type { ConfinedSpacePermit } from './types'

// Helpers for the big-monitor permit status board. Pure functions so the
// page can pass `now` from a setInterval tick and still benchmark + test
// trivially. Times are all milliseconds.

export const TWO_HOURS_MS    = 2 * 60 * 60 * 1000
export const THIRTY_MIN_MS   = 30 * 60 * 1000

export type CountdownTone = 'safe' | 'warning' | 'critical' | 'expired'

export interface PermitCountdown {
  remainingMs: number
  tone:        CountdownTone
  /** "1:23:45", "23:45", "0:45" depending on magnitude. */
  label:       string
  expired:     boolean
}

// Returns the live countdown view for a permit at time `now`. `expired`
// is true once we've crossed expires_at — UI uses this to gate the
// "verify evacuation" banner. A null/Invalid Date expires_at is treated
// as expired (fail-closed, same call as permitState).
export function permitCountdown(
  permit: Pick<ConfinedSpacePermit, 'expires_at'>,
  now: number = Date.now(),
): PermitCountdown {
  const expiresMs = new Date(permit.expires_at).getTime()
  if (Number.isNaN(expiresMs)) {
    return { remainingMs: 0, tone: 'expired', label: 'EXPIRED', expired: true }
  }
  const remainingMs = expiresMs - now
  if (remainingMs <= 0) {
    return { remainingMs: 0, tone: 'expired', label: 'EXPIRED', expired: true }
  }
  return {
    remainingMs,
    tone:    countdownTone(remainingMs),
    label:   formatRemaining(remainingMs),
    expired: false,
  }
}

export function countdownTone(remainingMs: number): CountdownTone {
  if (remainingMs <= 0)            return 'expired'
  if (remainingMs <= THIRTY_MIN_MS) return 'critical'
  if (remainingMs <= TWO_HOURS_MS)  return 'warning'
  return 'safe'
}

// Format a positive ms value as H:MM:SS (or M:SS when under an hour).
// Caller pre-checks remainingMs > 0; this function rounds DOWN to the
// nearest second so the displayed value never reads "0:00:01" while
// already-expired logic elsewhere has flipped to expired.
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad2 = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`
  return `${m}:${pad2(s)}`
}

// Aggregate counters for the status-board headline tiles. Pure function
// so we can test it deterministically against fixture timestamps.
export interface StatusBoardSummary {
  active:       number
  closeToExpiry: number          // ≤ 2 hours but > 0
  critical:     number            // ≤ 30 minutes but > 0
  expired:      number            // past expires_at, not yet canceled
  totalEntrants: number           // sum of entrants across active permits
}

export function summarize(
  permits: Array<Pick<ConfinedSpacePermit, 'expires_at' | 'canceled_at' | 'entry_supervisor_signature_at' | 'entrants'>>,
  now: number = Date.now(),
): StatusBoardSummary {
  const summary: StatusBoardSummary = {
    active: 0, closeToExpiry: 0, critical: 0, expired: 0, totalEntrants: 0,
  }
  for (const p of permits) {
    if (p.canceled_at) continue
    if (!p.entry_supervisor_signature_at) continue   // unsigned drafts not "out"
    const c = permitCountdown(p, now)
    if (c.expired) {
      summary.expired += 1
      continue
    }
    summary.active        += 1
    summary.totalEntrants += p.entrants.length
    if (c.tone === 'critical') summary.critical      += 1
    if (c.tone === 'critical' || c.tone === 'warning') summary.closeToExpiry += 1
  }
  return summary
}
