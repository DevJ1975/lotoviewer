import { describe, it, expect } from 'vitest'
import { clampText, escapePostgrestFilterValue, isSafeEmailAddress } from '@/lib/security/inputGuards'

describe('clampText', () => {
  it('returns short input unchanged', () => {
    expect(clampText('hello', 100)).toBe('hello')
  })
  it('returns empty string for null/undefined/empty', () => {
    expect(clampText(null)).toBe('')
    expect(clampText(undefined)).toBe('')
    expect(clampText('')).toBe('')
  })
  it('truncates with a marker when over the cap', () => {
    const out = clampText('a'.repeat(20), 5)
    expect(out.startsWith('aaaaa')).toBe(true)
    expect(out).toContain('[truncated 15 chars]')
  })
  it('does not split a surrogate pair', () => {
    // '😀' is one code point but two UTF-16 units.
    const out = clampText('😀😀😀😀', 2)
    expect(out.startsWith('😀😀')).toBe(true)
    // No lone surrogate (replacement char) leaked into the head.
    expect(out).not.toContain('�')
  })
})

describe('escapePostgrestFilterValue', () => {
  it('replaces commas and parens with single spaces', () => {
    expect(escapePostgrestFilterValue('x,id.eq.y')).toBe('x id.eq.y')
    expect(escapePostgrestFilterValue('a)(b')).toBe('a b')
  })
  it('collapses whitespace and trims', () => {
    expect(escapePostgrestFilterValue('  a , , b  ')).toBe('a b')
  })
  it('leaves a clean value alone', () => {
    expect(escapePostgrestFilterValue('forklift')).toBe('forklift')
  })
})

describe('isSafeEmailAddress', () => {
  it('accepts a plain address', () => {
    expect(isSafeEmailAddress('jamil@trainovations.com')).toBe(true)
  })
  it('rejects newline (header-injection vector)', () => {
    expect(isSafeEmailAddress('a@b.com\nBcc:evil@x.com')).toBe(false)
    expect(isSafeEmailAddress('a@b.com\r\nBcc:evil@x.com')).toBe(false)
  })
  it('rejects empty / null', () => {
    expect(isSafeEmailAddress('')).toBe(false)
    expect(isSafeEmailAddress(null)).toBe(false)
  })
  it('rejects malformed shapes', () => {
    expect(isSafeEmailAddress('not-an-email')).toBe(false)
    expect(isSafeEmailAddress('a@b')).toBe(false)
    expect(isSafeEmailAddress('a b@c.com')).toBe(false)
  })
  it('rejects over-long addresses', () => {
    expect(isSafeEmailAddress('x'.repeat(250) + '@b.com')).toBe(false)
  })
})
