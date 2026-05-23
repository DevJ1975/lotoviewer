import { describe, it, expect } from 'vitest'
import {
  classifyUrgency,
  daysUntilDue,
  advanceDueDate,
  nextAnnualOccurrence,
  planSystemSeeds,
  DUE_SOON_DAYS,
  SYSTEM_OBLIGATIONS,
} from '@soteria/core/complianceCalendar'

const NOW = new Date('2026-05-23T12:00:00Z')

describe('daysUntilDue', () => {
  it('is 0 for today and ignores time-of-day', () => {
    expect(daysUntilDue('2026-05-23', NOW)).toBe(0)
  })
  it('is negative in the past, positive in the future', () => {
    expect(daysUntilDue('2026-05-20', NOW)).toBe(-3)
    expect(daysUntilDue('2026-05-30', NOW)).toBe(7)
  })
})

describe('classifyUrgency', () => {
  it('flags past dates overdue', () => {
    expect(classifyUrgency('2026-05-22', NOW)).toBe('overdue')
  })
  it('flags today and within the window as due_soon', () => {
    expect(classifyUrgency('2026-05-23', NOW)).toBe('due_soon')
    expect(classifyUrgency('2026-06-22', NOW)).toBe('due_soon') // 30 days
  })
  it('flags beyond the window as upcoming', () => {
    expect(classifyUrgency('2026-06-23', NOW)).toBe('upcoming') // 31 days
  })
  it('respects a custom due-soon window', () => {
    expect(classifyUrgency('2026-05-30', NOW, 5)).toBe('upcoming')
    expect(classifyUrgency('2026-05-27', NOW, 5)).toBe('due_soon')
    expect(DUE_SOON_DAYS).toBe(30)
  })
})

describe('advanceDueDate', () => {
  it('advances by calendar cadence', () => {
    expect(advanceDueDate('2026-03-01', 'annual')).toBe('2027-03-01')
    expect(advanceDueDate('2026-03-01', 'quarterly')).toBe('2026-06-01')
    expect(advanceDueDate('2026-03-01', 'monthly')).toBe('2026-04-01')
    expect(advanceDueDate('2026-03-01', 'triennial')).toBe('2029-03-01')
    expect(advanceDueDate('2026-03-01', 'quinquennial')).toBe('2031-03-01')
  })
  it('advances custom_days by the given count', () => {
    expect(advanceDueDate('2026-03-01', 'custom_days', 10)).toBe('2026-03-11')
  })
  it('leaves once-cadence dates unchanged (caller closes instead)', () => {
    expect(advanceDueDate('2026-03-01', 'once')).toBe('2026-03-01')
  })
})

describe('nextAnnualOccurrence', () => {
  it('returns this year when the anchor is still ahead', () => {
    // June 1 is after May 23
    expect(nextAnnualOccurrence(6, 1, NOW)).toBe('2026-06-01')
  })
  it('rolls to next year when the anchor already passed', () => {
    // Feb 1 already passed in 2026
    expect(nextAnnualOccurrence(2, 1, NOW)).toBe('2027-02-01')
  })
  it('treats the anchor day itself as still due this year', () => {
    expect(nextAnnualOccurrence(5, 23, NOW)).toBe('2026-05-23')
  })
})

describe('planSystemSeeds', () => {
  const allEnabled = () => true

  it('seeds all catalog obligations when none exist and modules are enabled', () => {
    const seeds = planSystemSeeds(new Set(), allEnabled, NOW)
    expect(seeds.length).toBe(SYSTEM_OBLIGATIONS.length)
    for (const s of seeds) expect(s.nextDueAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('skips obligations already seeded', () => {
    const existing = new Set(['osha-300a-post'])
    const seeds = planSystemSeeds(existing, allEnabled, NOW)
    expect(seeds.find(s => s.systemKey === 'osha-300a-post')).toBeUndefined()
    expect(seeds.length).toBe(SYSTEM_OBLIGATIONS.length - 1)
  })

  it('gates obligations behind their required module', () => {
    const onlyChemicals = (id: string) => id === 'chemicals'
    const seeds = planSystemSeeds(new Set(), onlyChemicals, NOW)
    expect(seeds.every(s => s.systemKey === 'epcra-tier-ii')).toBe(true)
    expect(seeds.length).toBe(1)
  })
})
