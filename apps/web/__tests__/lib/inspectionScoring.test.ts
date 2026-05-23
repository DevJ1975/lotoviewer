import { describe, it, expect } from 'vitest'
import {
  scoreInspection,
  evaluateNumeric,
  isScorableType,
  type ScoreItem,
} from '@soteria/core/inspectionScoring'

const items: ScoreItem[] = [
  { id: 'a', type: 'pass_fail_na', weight: 1, failCreatesAction: true },
  { id: 'b', type: 'pass_fail_na', weight: 3, failCreatesAction: false },
  { id: 'c', type: 'numeric',      weight: 1, failCreatesAction: true },
  { id: 'd', type: 'text',         weight: 5, failCreatesAction: false }, // not scorable
]

describe('isScorableType', () => {
  it('counts pass/fail, numeric, multiple-choice; not text/photo/signature', () => {
    expect(isScorableType('pass_fail_na')).toBe(true)
    expect(isScorableType('numeric')).toBe(true)
    expect(isScorableType('multiple_choice')).toBe(true)
    expect(isScorableType('text')).toBe(false)
    expect(isScorableType('photo')).toBe(false)
    expect(isScorableType('signature')).toBe(false)
  })
})

describe('scoreInspection', () => {
  it('all pass → 100% and pass', () => {
    const s = scoreInspection(items, [
      { itemId: 'a', result: 'pass' }, { itemId: 'b', result: 'pass' }, { itemId: 'c', result: 'pass' },
    ])
    expect(s.maxScore).toBe(5)   // 1 + 3 + 1, text excluded
    expect(s.score).toBe(5)
    expect(s.pct).toBe(100)
    expect(s.result).toBe('pass')
    expect(s.failedItemIds).toEqual([])
  })

  it('weights the score and fails on any failure', () => {
    const s = scoreInspection(items, [
      { itemId: 'a', result: 'pass' }, { itemId: 'b', result: 'fail' }, { itemId: 'c', result: 'pass' },
    ])
    expect(s.maxScore).toBe(5)
    expect(s.score).toBe(2)      // a(1) + c(1) pass; b(3) failed
    expect(s.pct).toBe(40)
    expect(s.result).toBe('fail')
    expect(s.failedItemIds).toEqual(['b'])
    expect(s.actionItemIds).toEqual([]) // b has failCreatesAction=false
  })

  it('collects only fail-creates-action items for auto-CAPA', () => {
    const s = scoreInspection(items, [
      { itemId: 'a', result: 'fail' }, { itemId: 'c', result: 'fail' },
    ])
    expect(s.failedItemIds.sort()).toEqual(['a', 'c'])
    expect(s.actionItemIds.sort()).toEqual(['a', 'c']) // both flagged
  })

  // ── edge cases ──
  it('excludes na and unanswered scorable items from the denominator', () => {
    const s = scoreInspection(items, [
      { itemId: 'a', result: 'pass' }, { itemId: 'b', result: 'na' }, // c unanswered
    ])
    expect(s.maxScore).toBe(1)   // only a counts
    expect(s.score).toBe(1)
    expect(s.pct).toBe(100)
    expect(s.result).toBe('pass')
  })

  it('returns 100% pass when nothing scorable was answered', () => {
    const s = scoreInspection(items, [{ itemId: 'd', result: null }])
    expect(s.maxScore).toBe(0)
    expect(s.pct).toBe(100)
    expect(s.result).toBe('pass')
  })

  it('ignores responses for unknown items', () => {
    const s = scoreInspection(items, [{ itemId: 'zzz', result: 'fail' }])
    expect(s.failedItemIds).toEqual([])
    expect(s.result).toBe('pass')
  })
})

describe('evaluateNumeric', () => {
  it('passes within tolerance, fails outside', () => {
    expect(evaluateNumeric(5, 0, 10)).toBe('pass')
    expect(evaluateNumeric(-1, 0, 10)).toBe('fail')
    expect(evaluateNumeric(11, 0, 10)).toBe('fail')
  })
  it('treats open bounds as unbounded and non-finite as na', () => {
    expect(evaluateNumeric(999, 0, null)).toBe('pass')
    expect(evaluateNumeric(-999, null, 0)).toBe('pass')
    expect(evaluateNumeric(Number.NaN, 0, 10)).toBe('na')
  })
})
