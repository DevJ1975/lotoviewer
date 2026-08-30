import { describe, it, expect } from 'vitest'
import { parseReviewEquipmentParam } from '@/lib/reviewFocus'

describe('parseReviewEquipmentParam', () => {
  it('returns null when the param is absent', () => {
    expect(parseReviewEquipmentParam(undefined)).toBeNull()
  })

  it('returns null for an empty / whitespace-only value (falls back to the full list)', () => {
    expect(parseReviewEquipmentParam('')).toBeNull()
    expect(parseReviewEquipmentParam('   ')).toBeNull()
  })

  it('returns the trimmed equipment id for a normal value', () => {
    expect(parseReviewEquipmentParam('SKCC-850')).toBe('SKCC-850')
    expect(parseReviewEquipmentParam('  SKAP-112  ')).toBe('SKAP-112')
  })

  it('preserves free-form ids with spaces and symbols (no character whitelist)', () => {
    // equipment_id is user data — only ever used as a parameterized .eq() filter.
    expect(parseReviewEquipmentParam('VRC #4')).toBe('VRC #4')
    expect(parseReviewEquipmentParam('302-MX-1')).toBe('302-MX-1')
  })

  it('takes the first entry when the query param repeats', () => {
    expect(parseReviewEquipmentParam(['SKCC-850', 'SKAP-112'])).toBe('SKCC-850')
  })

  it('returns null for an absurdly long value (defensive cap)', () => {
    expect(parseReviewEquipmentParam('x'.repeat(129))).toBeNull()
    expect(parseReviewEquipmentParam('x'.repeat(128))).toBe('x'.repeat(128))
  })

  it('returns null for a non-string array head', () => {
    expect(parseReviewEquipmentParam([])).toBeNull()
  })
})
