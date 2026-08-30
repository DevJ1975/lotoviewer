import { describe, it, expect } from 'vitest'
import {
  validateCreateProjectInput,
  validateCreateRegisterItemInput,
  requiresJustification,
  isOverdue,
  isExpiringSoon,
  computeRetainUntil,
} from '../em385'

const NOW = new Date('2026-06-14T12:00:00Z')

describe('validateCreateProjectInput', () => {
  it('accepts a complete contract', () => {
    expect(validateCreateProjectInput({
      contract_number: 'W912-25-C-0001', title: 'Levee Rehab', edition: '2024',
    })).toBeNull()
  })

  it('requires contract number, title, and a valid edition', () => {
    expect(validateCreateProjectInput({ title: 'x', edition: '2024' })).toMatch(/contract number/i)
    expect(validateCreateProjectInput({ contract_number: 'x', edition: '2024' })).toMatch(/title/i)
    expect(validateCreateProjectInput({ contract_number: 'x', title: 'y' })).toMatch(/edition/i)
    // @ts-expect-error — exercising the runtime guard with a bad edition
    expect(validateCreateProjectInput({ contract_number: 'x', title: 'y', edition: '1999' })).toMatch(/invalid edition/i)
  })

  it('rejects an end date before the start date', () => {
    expect(validateCreateProjectInput({
      contract_number: 'x', title: 'y', edition: '2014',
      start_date: '2026-06-01', end_date: '2026-05-01',
    })).toMatch(/end date/i)
  })

  it('rejects whitespace-only required strings', () => {
    expect(validateCreateProjectInput({ contract_number: '   ', title: 'y', edition: '2024' })).toMatch(/contract number/i)
    expect(validateCreateProjectInput({ contract_number: 'x', title: '   ', edition: '2024' })).toMatch(/title/i)
  })
})

describe('validateCreateRegisterItemInput', () => {
  it('requires a title and a valid category', () => {
    expect(validateCreateRegisterItemInput({ title: 'AHA', category: 'app_plan' })).toBeNull()
    expect(validateCreateRegisterItemInput({ category: 'app_plan' })).toMatch(/title/i)
    // @ts-expect-error — bad category at runtime
    expect(validateCreateRegisterItemInput({ title: 'x', category: 'nope' })).toMatch(/invalid category/i)
  })

  it('rejects a whitespace-only title', () => {
    expect(validateCreateRegisterItemInput({ title: '   ', category: 'app_plan' })).toMatch(/title/i)
  })

  it('accepts unicode and punctuation in the title (O₂, H₂S, em-dash, quotes)', () => {
    expect(validateCreateRegisterItemInput({ title: 'Atmospheric O₂ / H₂S Plan — "rev"', category: 'app_plan' })).toBeNull()
  })
})

describe('requiresJustification', () => {
  it('is true only for not_applicable across every status', () => {
    expect(requiresJustification('not_applicable')).toBe(true)
    for (const s of ['not_started', 'in_progress', 'submitted', 'accepted', 'expired'] as const) {
      expect(requiresJustification(s)).toBe(false)
    }
  })
})

describe('isOverdue', () => {
  it('flags a past due date that is not yet accepted/excused', () => {
    expect(isOverdue({ due_date: '2026-06-13', status: 'in_progress' }, NOW)).toBe(true)
    expect(isOverdue({ due_date: '2026-06-13', status: 'not_started' }, NOW)).toBe(true)
    expect(isOverdue({ due_date: '2026-06-13', status: 'submitted' }, NOW)).toBe(true)
  })
  it('today is not overdue (boundary)', () => {
    expect(isOverdue({ due_date: '2026-06-14', status: 'in_progress' }, NOW)).toBe(false)
  })
  it('accepted and not_applicable are never overdue', () => {
    expect(isOverdue({ due_date: '2020-01-01', status: 'accepted' }, NOW)).toBe(false)
    expect(isOverdue({ due_date: '2020-01-01', status: 'not_applicable' }, NOW)).toBe(false)
  })
  it('no due date is never overdue', () => {
    expect(isOverdue({ due_date: null, status: 'in_progress' }, NOW)).toBe(false)
  })
})

describe('isExpiringSoon', () => {
  it('flags an accepted item expiring within the window', () => {
    expect(isExpiringSoon({ expires_at: '2026-07-01', status: 'accepted' }, NOW)).toBe(true)
  })
  it('is true on the far edge of the window (30 days)', () => {
    expect(isExpiringSoon({ expires_at: '2026-07-14', status: 'accepted' }, NOW)).toBe(true)
  })
  it('is false one day past the window edge', () => {
    expect(isExpiringSoon({ expires_at: '2026-07-15', status: 'accepted' }, NOW)).toBe(false)
  })
  it('already-expired (negative) is not "expiring soon"', () => {
    expect(isExpiringSoon({ expires_at: '2026-06-01', status: 'accepted' }, NOW)).toBe(false)
  })
  it('only applies to accepted items', () => {
    expect(isExpiringSoon({ expires_at: '2026-07-01', status: 'submitted' }, NOW)).toBe(false)
    expect(isExpiringSoon({ expires_at: '2026-07-01', status: 'expired' }, NOW)).toBe(false)
    expect(isExpiringSoon({ expires_at: '2026-07-01', status: 'not_applicable' }, NOW)).toBe(false)
  })
})

describe('computeRetainUntil', () => {
  it('adds the retention window in whole years', () => {
    expect(computeRetainUntil('2026-06-14', 30)).toBe('2056-06-14')
    expect(computeRetainUntil('2026-06-14', 5)).toBe('2031-06-14')
  })
  it('returns null when either input is missing', () => {
    expect(computeRetainUntil(null, 30)).toBeNull()
    expect(computeRetainUntil('2026-06-14', null)).toBeNull()
  })

  it('keeps Feb 29 on a leap-year target and rolls to Mar 1 otherwise', () => {
    expect(computeRetainUntil('2024-02-29', 4)).toBe('2028-02-29') // 2028 is a leap year
    expect(computeRetainUntil('2020-02-29', 1)).toBe('2021-03-01') // 2021 is not — JS normalizes
  })

  it('handles zero and negative retention windows', () => {
    expect(computeRetainUntil('2026-06-14', 0)).toBe('2026-06-14')
    expect(computeRetainUntil('2026-06-14', -5)).toBe('2021-06-14')
  })
})
