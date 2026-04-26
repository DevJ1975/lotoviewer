import { describe, it, expect } from 'vitest'
import {
  permitCountdown,
  countdownTone,
  formatRemaining,
  summarize,
  TWO_HOURS_MS,
  THIRTY_MIN_MS,
} from '@/lib/permitStatus'
import type { ConfinedSpacePermit } from '@/lib/types'

// Fixed reference time so every test is deterministic. All "now" inputs
// are derived from this so we never get flaky behavior from real Date.now().
const NOW = new Date('2026-04-26T12:00:00Z').getTime()

function permit(
  partial: Partial<Pick<ConfinedSpacePermit,
    'expires_at' | 'canceled_at' | 'entry_supervisor_signature_at' | 'entrants'>>,
): Pick<ConfinedSpacePermit, 'expires_at' | 'canceled_at' | 'entry_supervisor_signature_at' | 'entrants'> {
  // Spread last so explicit null/undefined in `partial` is respected. Using
  // ?? for defaults silently swallows an explicit null and would invalidate
  // the "unsigned permit" fixture (signature_at: null).
  return {
    expires_at:                    new Date(NOW + 4 * 3600_000).toISOString(),
    canceled_at:                   null,
    entry_supervisor_signature_at: '2026-04-26T11:00:00Z',
    entrants:                      [],
    ...partial,
  }
}

// ── countdownTone — boundary conditions on the colour switches ─────────────

describe('countdownTone', () => {
  it('returns "safe" comfortably above 2 hours', () => {
    expect(countdownTone(4 * 3600_000)).toBe('safe')
  })

  it('returns "warning" at exactly 2 hours (≤ TWO_HOURS_MS is the boundary)', () => {
    // The user's spec said "≤ 2 hours" counts as close-to-expiring.
    expect(countdownTone(TWO_HOURS_MS)).toBe('warning')
  })

  it('returns "warning" just below 2 hours', () => {
    expect(countdownTone(TWO_HOURS_MS - 1)).toBe('warning')
  })

  it('returns "critical" at exactly 30 minutes', () => {
    expect(countdownTone(THIRTY_MIN_MS)).toBe('critical')
  })

  it('returns "critical" just below 30 minutes', () => {
    expect(countdownTone(THIRTY_MIN_MS - 1)).toBe('critical')
  })

  it('returns "expired" at zero', () => {
    expect(countdownTone(0)).toBe('expired')
  })

  it('returns "expired" for negative remainders (defensive)', () => {
    expect(countdownTone(-1)).toBe('expired')
    expect(countdownTone(-1_000_000)).toBe('expired')
  })
})

// ── formatRemaining — H:MM:SS / M:SS depending on magnitude ─────────────────

describe('formatRemaining', () => {
  it('formats hours when >= 1h', () => {
    expect(formatRemaining(3600_000)).toBe('1:00:00')
    expect(formatRemaining(3600_000 + 23 * 60_000 + 45_000)).toBe('1:23:45')
    expect(formatRemaining(7 * 3600_000 + 59 * 60_000 + 59_000)).toBe('7:59:59')
  })

  it('drops the hour digit when under 1h', () => {
    expect(formatRemaining(45 * 60_000 + 30_000)).toBe('45:30')
    expect(formatRemaining(60_000)).toBe('1:00')
  })

  it('zero-pads seconds and minutes (under an hour)', () => {
    expect(formatRemaining(1000)).toBe('0:01')
    expect(formatRemaining(5_000)).toBe('0:05')
    expect(formatRemaining(10_000)).toBe('0:10')
  })

  it('returns "0:00" for zero', () => {
    expect(formatRemaining(0)).toBe('0:00')
  })

  it('treats negative values as zero (defensive — caller should branch first)', () => {
    expect(formatRemaining(-5_000)).toBe('0:00')
  })

  it('rounds DOWN to whole seconds — never displays "0:00:01" while expired logic flips elsewhere', () => {
    // 999ms is "less than a second" — should round down to 0.
    expect(formatRemaining(999)).toBe('0:00')
    // 1500ms should display as 0:01 (whole second elapsed).
    expect(formatRemaining(1500)).toBe('0:01')
  })
})

// ── permitCountdown — composes tone + format + expired flag ─────────────────

describe('permitCountdown', () => {
  it('returns safe state for a permit 4h out', () => {
    const r = permitCountdown(permit({
      expires_at: new Date(NOW + 4 * 3600_000).toISOString(),
    }), NOW)
    expect(r.tone).toBe('safe')
    expect(r.label).toBe('4:00:00')
    expect(r.expired).toBe(false)
    expect(r.remainingMs).toBe(4 * 3600_000)
  })

  it('returns warning state at exactly 2 hours remaining', () => {
    const r = permitCountdown(permit({
      expires_at: new Date(NOW + TWO_HOURS_MS).toISOString(),
    }), NOW)
    expect(r.tone).toBe('warning')
    expect(r.expired).toBe(false)
  })

  it('returns critical state at 15 minutes remaining', () => {
    const r = permitCountdown(permit({
      expires_at: new Date(NOW + 15 * 60_000).toISOString(),
    }), NOW)
    expect(r.tone).toBe('critical')
    expect(r.label).toBe('15:00')
    expect(r.expired).toBe(false)
  })

  it('returns expired when expires_at is in the past', () => {
    const r = permitCountdown(permit({
      expires_at: new Date(NOW - 60_000).toISOString(),
    }), NOW)
    expect(r.tone).toBe('expired')
    expect(r.expired).toBe(true)
    expect(r.label).toBe('EXPIRED')
    expect(r.remainingMs).toBe(0)
  })

  it('returns expired when expires_at is exactly now', () => {
    const r = permitCountdown(permit({
      expires_at: new Date(NOW).toISOString(),
    }), NOW)
    expect(r.expired).toBe(true)
  })

  it('returns expired when expires_at is unparseable (fail-closed)', () => {
    // Same fail-closed behavior as permitState() — corrupted timestamps
    // should not silently classify a permit as still active.
    const r = permitCountdown({ expires_at: 'not-a-date' }, NOW)
    expect(r.expired).toBe(true)
    expect(r.tone).toBe('expired')
  })

  it('uses Date.now() when `now` is omitted', () => {
    // Hard to assert exact value; just confirm it doesn't throw and
    // returns a sensible shape.
    const r = permitCountdown(permit({
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }))
    expect(r.expired).toBe(false)
    expect(r.tone).toBe('critical')
  })
})

// ── summarize — board-headline aggregator ──────────────────────────────────

describe('summarize', () => {
  it('returns all zeros for an empty list', () => {
    expect(summarize([], NOW)).toEqual({
      active: 0, closeToExpiry: 0, critical: 0, expired: 0, totalEntrants: 0,
    })
  })

  it('skips canceled permits entirely', () => {
    const s = summarize([
      permit({ canceled_at: '2026-04-26T11:30:00Z', entrants: ['Alice'] }),
    ], NOW)
    expect(s).toEqual({
      active: 0, closeToExpiry: 0, critical: 0, expired: 0, totalEntrants: 0,
    })
  })

  it('skips unsigned drafts (no entry_supervisor_signature_at)', () => {
    // A pending-signature permit isn't "out" — entry isn't authorized yet.
    const s = summarize([
      permit({ entry_supervisor_signature_at: null, entrants: ['Alice'] }),
    ], NOW)
    expect(s.active).toBe(0)
    expect(s.totalEntrants).toBe(0)
  })

  it('counts a signed, future-expiry permit as active and sums entrants', () => {
    const s = summarize([
      permit({ expires_at: new Date(NOW + 4 * 3600_000).toISOString(), entrants: ['A', 'B', 'C'] }),
    ], NOW)
    expect(s.active).toBe(1)
    expect(s.totalEntrants).toBe(3)
    expect(s.closeToExpiry).toBe(0)
    expect(s.critical).toBe(0)
    expect(s.expired).toBe(0)
  })

  it('counts close-to-expiry as warning + critical (both flavors of "≤ 2h")', () => {
    const s = summarize([
      permit({ expires_at: new Date(NOW + 90 * 60_000).toISOString(), entrants: ['A'] }),  // warning (1.5h)
      permit({ expires_at: new Date(NOW + 15 * 60_000).toISOString(), entrants: ['B'] }),  // critical (15m)
      permit({ expires_at: new Date(NOW + 4 * 3600_000).toISOString(), entrants: ['C'] }), // safe
    ], NOW)
    expect(s.active).toBe(3)
    expect(s.closeToExpiry).toBe(2)
    expect(s.critical).toBe(1)
    expect(s.totalEntrants).toBe(3)
  })

  it('counts expired-but-not-canceled separately and excludes them from active/totalEntrants', () => {
    const s = summarize([
      permit({ expires_at: new Date(NOW - 60_000).toISOString(), entrants: ['Alice', 'Bob'] }),
      permit({ expires_at: new Date(NOW + 4 * 3600_000).toISOString(), entrants: ['Carol'] }),
    ], NOW)
    expect(s.expired).toBe(1)
    expect(s.active).toBe(1)
    expect(s.totalEntrants).toBe(1)  // expired permit's entrants don't count
  })

  it('handles a mixed roster cleanly — canceled, unsigned, active, expired', () => {
    const s = summarize([
      permit({ canceled_at: '2026-04-26T10:00:00Z', entrants: ['skipped'] }),
      permit({ entry_supervisor_signature_at: null, entrants: ['draft'] }),
      permit({ expires_at: new Date(NOW + 4 * 3600_000).toISOString(), entrants: ['A'] }),
      permit({ expires_at: new Date(NOW + 90 * 60_000).toISOString(), entrants: ['B', 'C'] }),
      permit({ expires_at: new Date(NOW - 60_000).toISOString(), entrants: ['expired-X'] }),
    ], NOW)
    expect(s.active).toBe(2)
    expect(s.closeToExpiry).toBe(1)
    expect(s.critical).toBe(0)
    expect(s.expired).toBe(1)
    expect(s.totalEntrants).toBe(3)  // A + B + C
  })

  it('treats unparseable expires_at as expired (matches permitCountdown fail-closed)', () => {
    const s = summarize([
      permit({ expires_at: 'not-a-date', entrants: ['A'] }),
    ], NOW)
    expect(s.expired).toBe(1)
    expect(s.active).toBe(0)
  })
})
