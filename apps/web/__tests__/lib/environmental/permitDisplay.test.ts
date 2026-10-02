import { describe, it, expect } from 'vitest'
import { permitCountdown } from '@/lib/environmental/permitDisplay'
import type { PermitRow } from '@/lib/environmental/client'

// How a permit's renewal countdown is worded and how loudly. The tiers and the
// standing are decided in packages/core; these tests pin only the sentence and
// the tone a reader gets: that a permit is never said to "expire" when only its
// renewal application is due, that nothing reads as legally "valid", that the
// tones agree with the register light, and that a renewal the platform has only
// the user's word for is never shown green.

type Countdown = Parameters<typeof permitCountdown>[0]

const base = {
  standing: 'renewal_due', escalation: { tier: 90, daysLeft: 60, nextTierOn: '2026-12-01' },
  renewal_deadline: '2026-12-01', renewal_application_due_on: '2026-12-01', renewal_submitted_on: null, expires_on: '2027-03-01',
} as const satisfies Countdown

describe('permitCountdown', () => {
  it('says an application is due, not that the permit expires, when the permit gives an application date', () => {
    expect(permitCountdown(base)).toEqual({ label: 'Renewal application due 2026-12-01, in 60 days', tone: 'watch' })
  })

  it('says the permit expires when there is no application date', () => {
    const label = permitCountdown({ ...base, renewal_application_due_on: null, renewal_deadline: '2027-03-01' }).label
    expect(label).toBe('Expires 2027-03-01, in 60 days')
  })

  it.each([
    [180, 'neutral'], [90, 'watch'], [30, 'urgent'], ['none', 'neutral'],
  ] as const)('tones the %s-day tier %s, matching the register light (amber from 90 days)', (tier, tone) => {
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

  it('shows a submitted renewal as the user\'s word: watched, never green, and flagged when dated after the due date', () => {
    expect(permitCountdown({ ...base, standing: 'renewal_submitted', renewal_submitted_on: '2026-11-20' }))
      .toEqual({ label: 'Renewal submitted 2026-11-20', tone: 'watch' })
    expect(permitCountdown({ ...base, standing: 'renewal_submitted', renewal_submitted_on: '2026-12-05' }))
      .toEqual({ label: 'Renewal submitted 2026-12-05, after the 2026-12-01 due date', tone: 'urgent' })
    // With no application date to be late against, there is nothing to flag.
    expect(permitCountdown({ ...base, standing: 'renewal_submitted', renewal_application_due_on: null, renewal_submitted_on: '2026-12-05' }).tone)
      .toBe('watch')
  })

  it('sends the reader to the agency for an expired permit with a renewal pending, rather than guessing its status', () => {
    expect(permitCountdown({ ...base, standing: 'expired_renewal_pending' })).toEqual({
      label: 'Past its recorded expiry, renewal pending', tone: 'urgent', note: 'Confirm its status with the agency.',
    })
  })

  it('words the standings that have no countdown by what is recorded, never by what is valid', () => {
    expect(permitCountdown({ ...base, standing: 'no_expiry', escalation: null, renewal_deadline: null }).label).toBe('No expiry date recorded')
    expect(permitCountdown({ ...base, standing: 'retired' as PermitRow['standing'] }).label).toBe('Retired')
    expect(permitCountdown({ ...base, standing: 'expired' }).label).toBe('Past its recorded expiry 2027-03-01')
  })
})
