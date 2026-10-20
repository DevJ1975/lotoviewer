import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isAllowlistedSuperadminEmail, superadminAllowlist } from '@/lib/auth/superadminAllowlist'

// Four gates used to parse SUPERADMIN_EMAILS by hand. This is the single
// parser they share now, so its edge cases are pinned here once.

const ORIG_ENV = process.env

describe('superadminAllowlist', () => {
  beforeEach(() => { process.env = { ...ORIG_ENV } })
  afterEach(() => { process.env = ORIG_ENV })

  it('is empty when the variable is unset or blank', () => {
    delete process.env.SUPERADMIN_EMAILS
    expect(superadminAllowlist()).toEqual([])
    process.env.SUPERADMIN_EMAILS = '  ,  , '
    expect(superadminAllowlist()).toEqual([])
  })

  it('splits on commas, trims whitespace, and keeps the original case for mailing', () => {
    process.env.SUPERADMIN_EMAILS = ' One@x.com, two@x.com ,three@x.com,'
    expect(superadminAllowlist()).toEqual(['One@x.com', 'two@x.com', 'three@x.com'])
  })
})

describe('isAllowlistedSuperadminEmail', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    process.env.SUPERADMIN_EMAILS = 'Root@Example.com, ops@example.com'
  })
  afterEach(() => { process.env = ORIG_ENV })

  it('matches case-insensitively', () => {
    expect(isAllowlistedSuperadminEmail('root@example.com')).toBe(true)
    expect(isAllowlistedSuperadminEmail('OPS@EXAMPLE.COM')).toBe(true)
  })

  it('rejects an unlisted, empty, or missing email', () => {
    expect(isAllowlistedSuperadminEmail('attacker@evil.com')).toBe(false)
    expect(isAllowlistedSuperadminEmail('')).toBe(false)
    expect(isAllowlistedSuperadminEmail(null)).toBe(false)
    expect(isAllowlistedSuperadminEmail(undefined)).toBe(false)
  })

  it('never matches a substring or prefix of a listed address', () => {
    expect(isAllowlistedSuperadminEmail('root@example.com.evil.net')).toBe(false)
    expect(isAllowlistedSuperadminEmail('ops')).toBe(false)
  })

  it('fails closed when the allowlist is empty', () => {
    delete process.env.SUPERADMIN_EMAILS
    expect(isAllowlistedSuperadminEmail('root@example.com')).toBe(false)
  })
})
