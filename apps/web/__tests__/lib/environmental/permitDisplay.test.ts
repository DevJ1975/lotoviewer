import { describe, it, expect } from 'vitest'
import { permitCountdown } from '@/lib/environmental/permitDisplay'
import type { PermitRow } from '@/lib/environmental/client'

// How a permit's renewal countdown is worded and how loudly. The tiers and the
// standing are decided in packages/core; these tests pin only the sentence and
// the tone a reader gets, in particular that a permit is never said to "expire"
// when only its renewal application is due.

type Countdown = Parameters<typeof permitCountdown>[0]

const base = {
  standing: 'renewal_due', escalation: { tier: 90, daysLeft: 60, nextTierOn: '2026-12-01' },
  renewal_deadline: '2026-12-01', renewal_application_due_on: '2026-12-01', renewal_submitted_on: null, expires_on: '2027-03-01',
} as const satisfies Countdown

describe('permitCountdown', () => {
  it('says an application is due, not that the permit expires, when the permit gives an application date', () => {
    expect(permitCountdown(base)).toEqual({ label: 'Renewal application due 2026-12-01, in 60 days', tone: 'urgent' })
  })

  it('says the permit expires when there is no application date', () => {
    const label = permitCountdown({ ...base, renewal_application_due_on: null, renewal_deadline: '2027-03-01' }).label
    expect(label).toBe('Expires 2027-03-01, in 60 days')
  })

  it.each([
    [180, 'watch'], [90, 'urgent'], [30, 'urgent'], ['none', 'ok'],
  ] as const)('tones the %s-day tier %s', (tier, tone) => {
    expect(permitCountdown({ ...base, escalation: { tier, daysLeft: 100, nextTierOn: null } }).tone).toBe(tone)
  })

  it('says today, and one day, correctly', () => {
    expect(permitCountdown({ ...base, escalation: { tier: 30, daysLeft: 0, nextTierOn: null } }).label).toMatch(/, today$/)
    expect(permitCountdown({ ...base, escalation: { tier: 30, daysLeft: 1, nextTierOn: null } }).label).toMatch(/, in 1 day$/)
  })

  it('says how long ago a passed deadline was', () => {
    expect(permitCountdown({ ...base, escalation: { tier: 'passed', daysLeft: -3, nextTierOn: null } }))
      .toEqual({ label: 'Renewal application due 2026-12-01, 3 days ago', tone: 'urgent' })
  })

  it('stops the countdown once the renewal is submitted', () => {
    expect(permitCountdown({ ...base, standing: 'renewal_submitted', renewal_submitted_on: '2026-10-01' }))
      .toEqual({ label: 'Renewal submitted 2026-10-01', tone: 'ok' })
  })

  it('sends the reader to the agency for an expired permit with a renewal pending, rather than guessing its status', () => {
    const { label, tone } = permitCountdown({ ...base, standing: 'expired_renewal_pending' })
    expect(label).toContain('confirm its status with the agency')
    expect(tone).toBe('urgent')
  })

  it('words the standings that have no countdown', () => {
    expect(permitCountdown({ ...base, standing: 'no_expiry', escalation: null, renewal_deadline: null }).label).toBe('No expiry')
    expect(permitCountdown({ ...base, standing: 'retired' as PermitRow['standing'] }).label).toBe('Retired')
    expect(permitCountdown({ ...base, standing: 'expired' }).label).toBe('Expired 2027-03-01')
  })
})
