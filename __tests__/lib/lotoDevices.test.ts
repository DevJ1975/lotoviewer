import { describe, it, expect } from 'vitest'
import { isStaleCheckout, STALE_CHECKOUT_HOURS } from '@/lib/queries/lotoDevices'

// isStaleCheckout drives the "needs attention" banner on the admin
// inventory page. The threshold is the same one the audit's
// "forgotten lock" failure pattern targets (lock left on a panel
// across a shift change), so a misclassification here would either
// surface noise or hide a real safety issue.

describe('isStaleCheckout', () => {
  const NOW = new Date('2026-04-30T12:00:00Z').getTime()
  const HOUR = 60 * 60 * 1000

  it('returns false for a checkout less than threshold hours old', () => {
    const checkout = { checked_out_at: new Date(NOW - 3 * HOUR).toISOString() }
    expect(isStaleCheckout(checkout, NOW)).toBe(false)
  })

  it('returns false at exactly the threshold (boundary not stale)', () => {
    // 12h exactly should NOT yet be stale — we only flag once a
    // checkout has been open longer than the threshold.
    const checkout = { checked_out_at: new Date(NOW - STALE_CHECKOUT_HOURS * HOUR).toISOString() }
    expect(isStaleCheckout(checkout, NOW)).toBe(false)
  })

  it('returns true just past the threshold', () => {
    const checkout = { checked_out_at: new Date(NOW - (STALE_CHECKOUT_HOURS * HOUR + 1)).toISOString() }
    expect(isStaleCheckout(checkout, NOW)).toBe(true)
  })

  it('returns true for a multi-day-old checkout (the safety case)', () => {
    // The "left over the weekend" scenario — definitely stale.
    const checkout = { checked_out_at: new Date(NOW - 72 * HOUR).toISOString() }
    expect(isStaleCheckout(checkout, NOW)).toBe(true)
  })

  it('handles an invalid checked_out_at by returning false (defensive)', () => {
    // new Date('garbage').getTime() is NaN; nowMs - NaN is NaN; NaN > x is false.
    // Confirms we don't blow up the banner for a malformed row.
    const checkout = { checked_out_at: 'not-a-date' }
    expect(isStaleCheckout(checkout, NOW)).toBe(false)
  })
})
