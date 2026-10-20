import { beforeEach, describe, expect, it } from 'vitest'
import { issueKioskToken, KIOSK_TOKEN_TTL_MS, verifyKioskToken } from '@/lib/strike/kioskToken'

const CLAIMS = { tenantId: 'tenant-1', memberId: 'member-1', moduleId: 'module-1', issuedBy: 'supervisor-1' }

beforeEach(() => {
  process.env.STRIKE_KIOSK_SECRET = 'x'.repeat(48)
})

describe('kiosk tokens', () => {
  it('round-trips the claims while unexpired', () => {
    const { token, expiresAt } = issueKioskToken(CLAIMS, 1_000)
    expect(expiresAt).toBe(1_000 + KIOSK_TOKEN_TTL_MS)
    expect(verifyKioskToken(token, 2_000)).toEqual({ ok: true, claims: { ...CLAIMS, expiresAt } })
  })

  it('expires after 30 minutes', () => {
    const { token } = issueKioskToken(CLAIMS, 0)
    expect(verifyKioskToken(token, KIOSK_TOKEN_TTL_MS)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a payload edited to point at another worker', () => {
    const { token } = issueKioskToken(CLAIMS, 0)
    const [payload, signature] = token.split('.')
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString())
    forged.m = 'member-2'
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`
    expect(verifyKioskToken(tampered, 1)).toEqual({ ok: false, reason: 'signature' })
  })

  it('rejects tokens signed with a different secret, and malformed input', () => {
    const { token } = issueKioskToken(CLAIMS, 0)
    process.env.STRIKE_KIOSK_SECRET = 'y'.repeat(48)
    expect(verifyKioskToken(token, 1).ok).toBe(false)
    expect(verifyKioskToken('not-a-token', 1)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyKioskToken('a.b.c', 1)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses to operate with a weak or missing secret', () => {
    process.env.STRIKE_KIOSK_SECRET = 'short'
    expect(() => issueKioskToken(CLAIMS)).toThrow(/STRIKE_KIOSK_SECRET/)
  })
})
