import { describe, it, expect } from 'vitest'
import { isRealDate, UUID_PATTERN } from '../../environmental/validation'
import { validateDeadline } from '../../environmental/deadlines'

describe('isRealDate', () => {
  it('accepts real days, including a leap day', () => {
    for (const d of ['2026-12-31', '2028-02-29', '2026-01-01']) expect(isRealDate(d), d).toBe(true)
  })

  it('refuses a date that has the shape but is not a day, without throwing', () => {
    for (const d of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-01-32', '0000-00-00']) {
      expect(() => isRealDate(d), d).not.toThrow()
      expect(isRealDate(d), d).toBe(false)
    }
  })

  it('refuses anything not in YYYY-MM-DD form', () => {
    for (const d of ['', 'soon', '2026-1-1', '12/31/2026', '2026-12-31T00:00:00Z', ' 2026-12-31']) expect(isRealDate(d), d).toBe(false)
  })

  it('is what the validators use: an impossible month is a validation error, not a crash', () => {
    const r = validateDeadline({ title: 'X', next_due_at: '2026-13-01' })
    expect(r.ok).toBe(false)
  })
})

describe('UUID_PATTERN', () => {
  it('matches ids in either case and nothing else', () => {
    expect(UUID_PATTERN.test('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toBe(true)
    expect(UUID_PATTERN.test('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA')).toBe(true)
    for (const bad of ['', 'nope', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaag']) expect(UUID_PATTERN.test(bad), bad).toBe(false)
  })
})
