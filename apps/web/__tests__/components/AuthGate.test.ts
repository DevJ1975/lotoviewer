import { describe, it, expect } from 'vitest'
import { isPublicPath } from '@/components/AuthGate'

// AuthGate redirects any signed-out visit to a non-public path back to
// /login. The login screen's footer links to /privacy and /terms, so
// those legal pages MUST be public — otherwise clicking them while
// signed-out bounces the visitor straight back to login.
describe('isPublicPath', () => {
  it('treats the legal pages linked from the signed-out login footer as public', () => {
    expect(isPublicPath('/privacy')).toBe(true)
    expect(isPublicPath('/terms')).toBe(true)
  })

  it('keeps the sign-in and account-recovery flows public', () => {
    expect(isPublicPath('/login')).toBe(true)
    expect(isPublicPath('/welcome')).toBe(true)
    expect(isPublicPath('/forgot-password')).toBe(true)
    expect(isPublicPath('/reset-password')).toBe(true)
  })

  it('matches token-gated public prefixes on exact and nested paths', () => {
    expect(isPublicPath('/qr')).toBe(true)
    expect(isPublicPath('/qr/abc123')).toBe(true)
    expect(isPublicPath('/review/some-token')).toBe(true)
    expect(isPublicPath('/r/bbs/anon-token')).toBe(true)
  })

  it('does not leak the prefix match to sibling paths that merely share a stem', () => {
    expect(isPublicPath('/qrcode')).toBe(false)
    expect(isPublicPath('/reviews')).toBe(false)
  })

  it('gates authenticated app routes', () => {
    expect(isPublicPath('/')).toBe(false)
    expect(isPublicPath('/loto')).toBe(false)
    expect(isPublicPath('/admin')).toBe(false)
    expect(isPublicPath('/privacy/export')).toBe(false)
  })
})
