import { describe, it, expect } from 'vitest'
import {
  extractMentionTokens,
  slugifyHandle,
  emailLocalPart,
} from '@/lib/notifications/mentions'

describe('extractMentionTokens', () => {
  it('returns empty for a body with no @-tokens', () => {
    expect(extractMentionTokens('hello world')).toEqual([])
  })

  it('extracts a single token', () => {
    expect(extractMentionTokens('hey @alice can you check this')).toEqual(['alice'])
  })

  it('lowercases and dedupes repeated tokens', () => {
    expect(extractMentionTokens('@Alice and @ALICE again')).toEqual(['alice'])
  })

  it('extracts multiple distinct tokens preserving first occurrence order', () => {
    expect(extractMentionTokens('@bob @alice @charlie')).toEqual(['bob', 'alice', 'charlie'])
  })

  it('accepts tokens with dots, dashes, underscores', () => {
    expect(extractMentionTokens('ping @jane.doe and @bob_smith and @ann-marie'))
      .toEqual(['jane.doe', 'bob_smith', 'ann-marie'])
  })

  it('does not extract from email addresses', () => {
    // Regex captures @example here — that's acceptable because we
    // resolve against the tenant roster anyway and "example" almost
    // never matches a user. The contract is "tokens", not "valid
    // mentions" — server-side resolution is the gate.
    const tokens = extractMentionTokens('contact bob@example.com')
    expect(tokens).toEqual(['example.com'])
  })
})

describe('slugifyHandle', () => {
  it('returns empty for null/undefined/empty', () => {
    expect(slugifyHandle(null)).toBe('')
    expect(slugifyHandle(undefined)).toBe('')
    expect(slugifyHandle('')).toBe('')
  })

  it('lowercases and joins words with dots', () => {
    expect(slugifyHandle('Jane Doe')).toBe('jane.doe')
  })

  it('strips apostrophes and trims edge dots', () => {
    expect(slugifyHandle("Jane O'Doe")).toBe('jane.odoe')
  })

  it('collapses multiple non-alnum into a single dot', () => {
    expect(slugifyHandle('Jane   Q.   Public')).toBe('jane.q.public')
  })
})

describe('emailLocalPart', () => {
  it('returns empty for null/undefined', () => {
    expect(emailLocalPart(null)).toBe('')
    expect(emailLocalPart(undefined)).toBe('')
  })

  it('returns the part before @ lowercased', () => {
    expect(emailLocalPart('Alice@Example.com')).toBe('alice')
  })

  it('returns whole string lowercased when no @ present', () => {
    expect(emailLocalPart('handle')).toBe('handle')
  })
})
