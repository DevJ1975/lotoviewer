import { describe, it, expect } from 'vitest'
import {
  severityHintToInherent,
  nextHazardHuntDueDate,
  isHazardHuntDueOn,
  cadenceAdherence,
} from '@soteria/core/hazardHunt'

// Weekday (0=Sun..6=Sat) of a 'YYYY-MM-DD' date, in UTC — matches the helper.
const dow = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()
}

describe('severityHintToInherent', () => {
  it('maps hints to the shared inherent-severity scale', () => {
    expect(severityHintToInherent('low')).toBe(2)
    expect(severityHintToInherent('moderate')).toBe(3)
    expect(severityHintToInherent('high')).toBe(4)
    expect(severityHintToInherent('extreme')).toBe(5)
  })
  it('defaults a missing hint to the conservative middle', () => {
    expect(severityHintToInherent(null)).toBe(3)
    expect(severityHintToInherent(undefined)).toBe(3)
  })
})

describe('nextHazardHuntDueDate', () => {
  it('daily is due the same day', () => {
    expect(nextHazardHuntDueDate('daily', {}, '2026-06-19')).toBe('2026-06-19')
  })

  it('weekly returns asOf when asOf is already the anchor weekday', () => {
    const asOf = '2026-06-19'
    expect(nextHazardHuntDueDate('weekly', { dayOfWeek: dow(asOf) }, asOf)).toBe(asOf)
  })

  it('weekly advances to the next matching weekday within 7 days', () => {
    const asOf = '2026-06-19'
    const target = (dow(asOf) + 2) % 7
    const next = nextHazardHuntDueDate('weekly', { dayOfWeek: target }, asOf)
    expect(next >= asOf).toBe(true)
    expect(dow(next)).toBe(target)
    expect(new Date(next).getTime() - new Date(asOf).getTime()).toBeLessThan(7 * 86_400_000)
  })

  it('monthly returns this month when the day is still ahead', () => {
    expect(nextHazardHuntDueDate('monthly', { dayOfMonth: 15 }, '2026-06-10')).toBe('2026-06-15')
  })

  it('monthly rolls to next month when the day has passed', () => {
    expect(nextHazardHuntDueDate('monthly', { dayOfMonth: 5 }, '2026-06-10')).toBe('2026-07-05')
  })

  it('monthly rolls across a year boundary', () => {
    expect(nextHazardHuntDueDate('monthly', { dayOfMonth: 5 }, '2026-12-10')).toBe('2027-01-05')
  })
})

describe('isHazardHuntDueOn', () => {
  it('daily is due every day', () => {
    expect(isHazardHuntDueOn('daily', {}, '2026-06-19')).toBe(true)
  })
  it('monthly is due only on its day-of-month', () => {
    expect(isHazardHuntDueOn('monthly', { dayOfMonth: 15 }, '2026-06-15')).toBe(true)
    expect(isHazardHuntDueOn('monthly', { dayOfMonth: 15 }, '2026-06-14')).toBe(false)
  })
})

describe('cadenceAdherence', () => {
  it('is vacuously perfect when nothing is scheduled', () => {
    expect(cadenceAdherence(0, 0)).toBe(1)
  })
  it('is the completed/generated ratio, clamped to 0..1', () => {
    expect(cadenceAdherence(10, 10)).toBe(1)
    expect(cadenceAdherence(10, 5)).toBe(0.5)
    expect(cadenceAdherence(10, 0)).toBe(0)
    expect(cadenceAdherence(10, 20)).toBe(1)
  })
})
