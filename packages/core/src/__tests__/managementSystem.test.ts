import { describe, it, expect } from 'vitest'
import { DISCIPLINES, registerHealth, type RegisterRow } from '../managementSystem'

const TODAY = '2026-10-01'

function row(nextReviewDue: string, active = true): RegisterRow {
  return { active, nextReviewDue }
}

describe('DISCIPLINES', () => {
  it('lists the environmental, OH&S, and combined management systems', () => {
    expect(DISCIPLINES).toEqual(['ems', 'ohs', 'integrated'])
  })
})

describe('registerHealth', () => {
  it('is red for an empty register: an auditor has nothing to sample', () => {
    expect(registerHealth([], TODAY)).toBe('red')
  })

  it('is red when every row is retired', () => {
    expect(registerHealth([row('2027-01-01', false), row('2027-06-01', false)], TODAY)).toBe('red')
  })

  it('is green when every active row is reviewed ahead of its due date', () => {
    expect(registerHealth([row('2026-10-02'), row('2027-03-15')], TODAY)).toBe('green')
  })

  it('is green for a row due today (due is not overdue)', () => {
    expect(registerHealth([row(TODAY)], TODAY)).toBe('green')
  })

  it('is amber for a row due yesterday', () => {
    expect(registerHealth([row('2026-09-30')], TODAY)).toBe('amber')
  })

  it('is amber when one overdue active row hides among current ones', () => {
    expect(registerHealth([row('2027-01-01'), row('2025-12-31'), row('2026-11-01')], TODAY)).toBe('amber')
  })

  it('ignores an overdue retired row: obsolete history never turns a register amber', () => {
    expect(registerHealth([row('2027-01-01'), row('2020-01-01', false)], TODAY)).toBe('green')
  })

  it('compares across a year boundary', () => {
    expect(registerHealth([row('2025-12-31')], '2026-01-01')).toBe('amber')
    expect(registerHealth([row('2026-01-01')], '2025-12-31')).toBe('green')
  })
})
