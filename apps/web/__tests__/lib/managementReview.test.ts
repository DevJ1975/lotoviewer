import { describe, it, expect } from 'vitest'
import {
  isValidReviewPeriod,
  reviewHasOutputs,
  MANAGEMENT_REVIEW_INPUTS,
  MANAGEMENT_REVIEW_OUTPUTS,
  REVIEW_STATUSES,
} from '@soteria/core/managementReview'

describe('isValidReviewPeriod', () => {
  it('accepts end on or after start', () => {
    expect(isValidReviewPeriod('2026-01-01', '2026-12-31')).toBe(true)
    expect(isValidReviewPeriod('2026-06-01', '2026-06-01')).toBe(true)
  })
  it('rejects end before start', () => {
    expect(isValidReviewPeriod('2026-12-31', '2026-01-01')).toBe(false)
  })
  it('treats a missing bound as valid', () => {
    expect(isValidReviewPeriod(null, '2026-12-31')).toBe(true)
    expect(isValidReviewPeriod('2026-01-01', null)).toBe(true)
    expect(isValidReviewPeriod(null, null)).toBe(true)
  })
})

describe('reviewHasOutputs', () => {
  it('is true when conclusions or decisions are present', () => {
    expect(reviewHasOutputs({ conclusions: 'EMS effective', decisions: null })).toBe(true)
    expect(reviewHasOutputs({ conclusions: null, decisions: 'Add a spill drill' })).toBe(true)
  })
  it('is false when both are empty or whitespace', () => {
    expect(reviewHasOutputs({ conclusions: null, decisions: null })).toBe(false)
    expect(reviewHasOutputs({ conclusions: '   ', decisions: '' })).toBe(false)
  })
})

describe('agenda constants', () => {
  it('cover the standard ISO 9.3.2 inputs and 9.3.3 outputs', () => {
    expect(MANAGEMENT_REVIEW_INPUTS.length).toBeGreaterThanOrEqual(8)
    expect(MANAGEMENT_REVIEW_OUTPUTS.length).toBeGreaterThanOrEqual(4)
  })
  it('has unique, well-formed status values', () => {
    const values = REVIEW_STATUSES.map(s => s.value)
    expect(new Set(values).size).toBe(values.length)
  })
})
