import { describe, it, expect } from 'vitest'
import {
  signInspectorPayload,
  verifyInspectorToken,
  buildInspectorUrl,
  type InspectorTokenPayload,
} from '@/lib/inspectorToken'

const SECRET = 'test-secret-do-not-use-in-prod'
const NOW    = 1_750_000_000   // an arbitrary "now" in unix seconds

function payload(overrides: Partial<InspectorTokenPayload> = {}): InspectorTokenPayload {
  return {
    start: '2026-04-01',
    end:   '2026-04-30',
    exp:   NOW + 30 * 24 * 60 * 60,   // 30 days out
    label: 'Cal/OSHA inspection 2026-05',
    ...overrides,
  }
}

describe('signInspectorPayload', () => {
  it('produces a stable signature for the same payload', () => {
    const a = signInspectorPayload(payload(), SECRET)
    const b = signInspectorPayload(payload(), SECRET)
    expect(a).toBe(b)
  })

  it('produces different signatures for different payloads', () => {
    const a = signInspectorPayload(payload({ start: '2026-04-01' }), SECRET)
    const b = signInspectorPayload(payload({ start: '2026-04-02' }), SECRET)
    expect(a).not.toBe(b)
  })

  it('produces different signatures for different secrets', () => {
    const a = signInspectorPayload(payload(), SECRET)
    const b = signInspectorPayload(payload(), SECRET + '-rotated')
    expect(a).not.toBe(b)
  })

  it('produces a base64url signature (no padding, no + or /)', () => {
    const sig = signInspectorPayload(payload(), SECRET)
    expect(sig).not.toMatch(/=/)
    expect(sig).not.toMatch(/\+/)
    expect(sig).not.toMatch(/\//)
    // SHA-256 → 32 bytes → ceil(32 * 4/3) = 43 chars w/o padding.
    expect(sig.length).toBe(43)
  })
})

describe('verifyInspectorToken', () => {
  it('accepts a freshly signed token', () => {
    const p = payload()
    const sig = signInspectorPayload(p, SECRET)
    expect(verifyInspectorToken({ payload: p, sig, secret: SECRET, nowSec: NOW }).ok).toBe(true)
  })

  it('rejects when the secret is wrong', () => {
    const p = payload()
    const sig = signInspectorPayload(p, SECRET)
    const result = verifyInspectorToken({ payload: p, sig, secret: 'rotated', nowSec: NOW })
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toMatch(/signature/i)
  })

  it('rejects when ANY field has been tampered with', () => {
    // Sign with one window, attack with another. The HMAC was computed
    // over the original payload; the verifier sees the tampered payload
    // and computes a different HMAC → mismatch.
    const original = payload({ start: '2026-04-01', end: '2026-04-07' })
    const sig = signInspectorPayload(original, SECRET)
    const tampered = { ...original, end: '2026-12-31' }   // attacker extends window
    expect(verifyInspectorToken({ payload: tampered, sig, secret: SECRET, nowSec: NOW }).ok).toBe(false)
  })

  it('rejects an expired token', () => {
    const p = payload({ exp: NOW - 1 })
    const sig = signInspectorPayload(p, SECRET)
    const result = verifyInspectorToken({ payload: p, sig, secret: SECRET, nowSec: NOW })
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toMatch(/expired/i)
  })

  it('rejects a malformed start date', () => {
    const p = payload({ start: 'not-a-date' })
    const sig = signInspectorPayload(p, SECRET)
    const result = verifyInspectorToken({ payload: p, sig, secret: SECRET, nowSec: NOW })
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toMatch(/start/i)
  })

  it('rejects when start is after end', () => {
    const p = payload({ start: '2026-04-30', end: '2026-04-01' })
    const sig = signInspectorPayload(p, SECRET)
    const result = verifyInspectorToken({ payload: p, sig, secret: SECRET, nowSec: NOW })
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toMatch(/start/i)
  })

  it('rejects a label longer than 200 chars', () => {
    const p = payload({ label: 'a'.repeat(201) })
    const sig = signInspectorPayload(p, SECRET)
    const result = verifyInspectorToken({ payload: p, sig, secret: SECRET, nowSec: NOW })
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toMatch(/label/i)
  })

  it('rejects a wrong-length signature without leaking timing info', () => {
    const p = payload()
    // Truncated signature → length check returns immediately, before
    // the timingSafeEqual comparison would have a chance to leak.
    const result = verifyInspectorToken({ payload: p, sig: 'abc', secret: SECRET, nowSec: NOW })
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toMatch(/length|encoding/i)
  })

  it('rejects garbage in the signature field', () => {
    const p = payload()
    const result = verifyInspectorToken({ payload: p, sig: 'not!!base64!!at!!all!!', secret: SECRET, nowSec: NOW })
    expect(result.ok).toBe(false)
  })
})

describe('buildInspectorUrl', () => {
  it('produces a URL with all payload fields plus signature', () => {
    const url = buildInspectorUrl({
      origin: 'https://field.example.com',
      payload: payload(),
      secret:  SECRET,
    })
    expect(url).toMatch(/^https:\/\/field\.example\.com\/inspector\?/)
    const u = new URL(url)
    expect(u.searchParams.get('start')).toBe('2026-04-01')
    expect(u.searchParams.get('end')).toBe('2026-04-30')
    expect(u.searchParams.get('exp')).toBe(String(payload().exp))
    expect(u.searchParams.get('label')).toBe('Cal/OSHA inspection 2026-05')
    expect(u.searchParams.get('sig')).toBeDefined()
  })

  it('strips a trailing slash on the origin so we do not double up', () => {
    const url = buildInspectorUrl({
      origin: 'https://field.example.com/',
      payload: payload(),
      secret:  SECRET,
    })
    expect(url).toMatch(/^https:\/\/field\.example\.com\/inspector\?/)
    expect(url).not.toMatch(/\/\/inspector/)
  })

  it('round-trips: building a URL and parsing+verifying it returns ok', () => {
    const p = payload()
    const url = buildInspectorUrl({ origin: 'https://x.test', payload: p, secret: SECRET })
    const u = new URL(url)
    const reconstructed: InspectorTokenPayload = {
      start: u.searchParams.get('start')!,
      end:   u.searchParams.get('end')!,
      exp:   Number(u.searchParams.get('exp')),
      label: u.searchParams.get('label')!,
    }
    const sig = u.searchParams.get('sig')!
    expect(verifyInspectorToken({ payload: reconstructed, sig, secret: SECRET, nowSec: NOW }).ok).toBe(true)
  })

  it('URL-encodes special chars in the label', () => {
    const p = payload({ label: 'Audit / 2026 — site #4' })
    const url = buildInspectorUrl({ origin: 'https://x.test', payload: p, secret: SECRET })
    const u = new URL(url)
    // URLSearchParams handles encoding; round-trip the value to confirm
    // the original came out the other side.
    expect(u.searchParams.get('label')).toBe('Audit / 2026 — site #4')
  })
})
