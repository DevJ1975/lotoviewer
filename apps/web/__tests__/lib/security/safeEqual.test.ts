import { describe, it, expect } from 'vitest'
import { safeEqual } from '@/lib/security/safeEqual'

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('hello', 'hello')).toBe(true)
  })

  it('returns false for different strings of the same length', () => {
    expect(safeEqual('abcdef', 'abcdeg')).toBe(false)
  })

  it('returns false for different lengths (length-leak fast path is acceptable)', () => {
    expect(safeEqual('short', 'much longer string')).toBe(false)
  })

  it('returns true for empty strings', () => {
    expect(safeEqual('', '')).toBe(true)
  })

  it('handles unicode-equivalent strings correctly', () => {
    expect(safeEqual('héllo', 'héllo')).toBe(true)
    expect(safeEqual('héllo', 'hello')).toBe(false)
  })

  // Note: a full timing-attack regression test would need
  // statistical sampling at the OS scheduler granularity, which is
  // flaky in unit tests. The function is small enough to read; the
  // contract is that we never short-circuit on the first byte
  // mismatch, which the implementation satisfies (XOR-accumulate
  // pattern).
})
