import { createHmac, timingSafeEqual } from 'node:crypto'

// "Train now" links: a supervisor on a permit hands a worker their phone (or
// a QR) to complete one module without logging in. The token is the
// credential, so it is narrow — one tenant, one roster member, one module —
// short-lived, and HMAC-signed with a server-only secret. Stateless on
// purpose: nothing to clean up, and the issuing supervisor is carried inside
// it and recorded on the completion as evidence.

export const KIOSK_TOKEN_TTL_MS = 30 * 60 * 1000

export interface KioskClaims {
  tenantId: string
  memberId: string
  moduleId: string
  issuedBy: string
  expiresAt: number
}

interface WireClaims { t: string; m: string; mod: string; by: string; exp: number }

function secret(): string {
  const value = process.env.STRIKE_KIOSK_SECRET
  if (!value || value.length < 32) throw new Error('STRIKE_KIOSK_SECRET must be set to at least 32 characters')
  return value
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function issueKioskToken(claims: Omit<KioskClaims, 'expiresAt'>, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + KIOSK_TOKEN_TTL_MS
  const wire: WireClaims = { t: claims.tenantId, m: claims.memberId, mod: claims.moduleId, by: claims.issuedBy, exp: expiresAt }
  const payload = Buffer.from(JSON.stringify(wire)).toString('base64url')
  return { token: `${payload}.${sign(payload)}`, expiresAt }
}

export type KioskVerification = { ok: true; claims: KioskClaims } | { ok: false; reason: 'malformed' | 'signature' | 'expired' }

export function verifyKioskToken(token: string, now = Date.now()): KioskVerification {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return { ok: false, reason: 'malformed' }

  const expected = Buffer.from(sign(payload))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: 'signature' }

  let wire: WireClaims
  try {
    wire = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as WireClaims
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof wire.exp !== 'number' || ![wire.t, wire.m, wire.mod, wire.by].every(v => typeof v === 'string' && v.length > 0)) {
    return { ok: false, reason: 'malformed' }
  }
  if (wire.exp <= now) return { ok: false, reason: 'expired' }
  return { ok: true, claims: { tenantId: wire.t, memberId: wire.m, moduleId: wire.mod, issuedBy: wire.by, expiresAt: wire.exp } }
}
