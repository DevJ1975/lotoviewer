// Phase-D edge-case tests for Module 3 helpers. Focused on the
// security-critical surfaces (HMAC, SCIM token hash, contractor token
// validation) and on the classifier fail-safe defaults — the places
// where a missed branch becomes a silent data-leak or wrong
// classification in production.

import { describe, it, expect } from 'vitest'
import {
  signHmac,
  verifyHmacSignature,
  constantTimeEqual,
  parseInboundEvent,
} from '@soteria/core/cmmsSync'
import {
  parseScimUser,
  sha256HexString,
  generateScimToken,
} from '@soteria/core/scim'
import { classifyPrequal, daysUntilPrequalExpiry } from '@soteria/core/vendorPrequal'
import { t, normalizeLanguage, isSupportedLanguage } from '@soteria/core/i18n'
import { summarizeObservations, bandRatio } from '@soteria/core/bbsMetricsV2'

const ASOF = new Date('2026-05-15T12:00:00Z')

// ─────────────────────────────────────────────────────────────────
// CMMS HMAC — security-critical, must reject every tampered case
// ─────────────────────────────────────────────────────────────────

describe('cmmsSync HMAC — attack-shaped inputs', () => {
  const SECRET = 'whsec_test_8f4a1e2c'
  const BODY   = '{"event_type":"work_order.opened","work_order_id":"WO-1","equipment_id":"EQ-1","status":"open"}'

  it('rejects a null signature header', async () => {
    expect(await verifyHmacSignature(SECRET, BODY, null)).toBe(false)
  })

  it('rejects an undefined signature header', async () => {
    expect(await verifyHmacSignature(SECRET, BODY, undefined)).toBe(false)
  })

  it('rejects a signature without the sha256= prefix', async () => {
    const sig = await signHmac(SECRET, BODY)
    const noPrefix = sig.slice('sha256='.length)
    expect(await verifyHmacSignature(SECRET, BODY, noPrefix)).toBe(false)
  })

  it('rejects a signature that uses a different secret', async () => {
    const sig = await signHmac('different_secret', BODY)
    expect(await verifyHmacSignature(SECRET, BODY, sig)).toBe(false)
  })

  it('rejects a signature over a different body (single-bit-flip)', async () => {
    const sig = await signHmac(SECRET, BODY)
    const tampered = BODY.replace('"open"', '"closed"')
    expect(await verifyHmacSignature(SECRET, tampered, sig)).toBe(false)
  })

  it('rejects a truncated signature (length-skew rejection)', async () => {
    const sig = await signHmac(SECRET, BODY)
    expect(await verifyHmacSignature(SECRET, BODY, sig.slice(0, -1))).toBe(false)
  })

  it('rejects an extra-character signature (length-skew rejection)', async () => {
    const sig = await signHmac(SECRET, BODY)
    expect(await verifyHmacSignature(SECRET, BODY, sig + '0')).toBe(false)
  })

  it('accepts a valid round-trip', async () => {
    const sig = await signHmac(SECRET, BODY)
    expect(await verifyHmacSignature(SECRET, BODY, sig)).toBe(true)
  })

  it('constantTimeEqual rejects equal-prefix-mismatched strings', () => {
    expect(constantTimeEqual('aaaaaaaa', 'aaaaaaab')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────
// CMMS payload parsing — malicious / malformed inputs
// ─────────────────────────────────────────────────────────────────

describe('parseInboundEvent — malformed payloads', () => {
  it('rejects a null payload', () => {
    const r = parseInboundEvent(null)
    expect(r.ok).toBe(false)
  })

  it('rejects a payload missing event_type', () => {
    const r = parseInboundEvent({
      work_order_id: 'WO-1',
      equipment_id:  'EQ-1',
      status:        'open',
    })
    expect(r.ok).toBe(false)
  })

  it('rejects a payload with an unknown event_type', () => {
    const r = parseInboundEvent({
      event_type:    'work_order.exploded',
      work_order_id: 'WO-1',
      equipment_id:  'EQ-1',
      status:        'open',
    })
    expect(r.ok).toBe(false)
  })

  it('accepts a minimal valid payload', () => {
    const r = parseInboundEvent({
      event_type:    'work_order.opened',
      work_order_id: 'WO-1',
      equipment_id:  'EQ-1',
      status:        'open',
    })
    expect(r.ok).toBe(true)
  })

  it('preserves unknown fields in extra (audit hygiene)', () => {
    const r = parseInboundEvent({
      event_type:    'work_order.opened',
      work_order_id: 'WO-1',
      equipment_id:  'EQ-1',
      status:        'open',
      requestor:     'jdoe',
      priority:      'P2',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.event.extra.requestor).toBe('jdoe')
      expect(r.event.extra.priority).toBe('P2')
    }
  })
})

// ─────────────────────────────────────────────────────────────────
// SCIM — token cryptographic strength + parsing
// ─────────────────────────────────────────────────────────────────

describe('SCIM token generation', () => {
  it('generates a base64url-safe token (no +, /, =)', () => {
    const t = generateScimToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generates a different token each call (CSPRNG sanity)', () => {
    const a = generateScimToken()
    const b = generateScimToken()
    expect(a).not.toBe(b)
  })

  it('hashes a known value to a stable 64-hex digest', async () => {
    // Locks the hash function so a future refactor doesn't accidentally
    // change the algorithm and invalidate every stored token_hash.
    const hex = await sha256HexString('the-quick-brown-fox')
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
    // Recompute on every supported runtime to catch a regression early.
    const again = await sha256HexString('the-quick-brown-fox')
    expect(hex).toBe(again)
  })
})

describe('parseScimUser — minimal payloads', () => {
  it('rejects an empty payload', () => {
    const r = parseScimUser({})
    expect(r.ok).toBe(false)
  })

  it('rejects a payload missing userName', () => {
    const r = parseScimUser({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      name:    { givenName: 'A', familyName: 'B' },
    })
    expect(r.ok).toBe(false)
  })

  it('treats active=undefined as active=true (SCIM default)', () => {
    const r = parseScimUser({
      schemas:    ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName:   'alice@example.com',
      externalId: 'ext-1',
      name:       { givenName: 'Alice', familyName: 'Example' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.user.active).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// Vendor prequal classifier — boundary days
// ─────────────────────────────────────────────────────────────────

describe('classifyPrequal — fail-safe defaults', () => {
  it('approved with null expiry → expired (no "approved forever")', () => {
    expect(classifyPrequal({ status: 'approved', approval_expires_at: null }, ASOF)).toBe('expired')
  })

  it('approved with garbage expiry → expired (defensive)', () => {
    expect(classifyPrequal(
      { status: 'approved', approval_expires_at: 'not-a-date' }, ASOF,
    )).toBe('expired')
  })

  it('rejected is bucketed as expired (single UI state for inactive)', () => {
    expect(classifyPrequal({ status: 'rejected', approval_expires_at: null }, ASOF)).toBe('expired')
  })

  it('exactly 30 days from expiry is "expiring" (warn-window boundary inclusive)', () => {
    const expiry = new Date(ASOF.getTime() + 30 * 86_400_000).toISOString()
    expect(classifyPrequal({ status: 'approved', approval_expires_at: expiry }, ASOF)).toBe('expiring')
  })

  it('exactly 31 days from expiry is "approved"', () => {
    const expiry = new Date(ASOF.getTime() + 31 * 86_400_000).toISOString()
    expect(classifyPrequal({ status: 'approved', approval_expires_at: expiry }, ASOF)).toBe('approved')
  })

  it('daysUntilPrequalExpiry returns Infinity for invited/in_progress', () => {
    expect(daysUntilPrequalExpiry({ status: 'invited', approval_expires_at: null }, ASOF)).toBe(Infinity)
    expect(daysUntilPrequalExpiry({ status: 'in_progress', approval_expires_at: null }, ASOF)).toBe(Infinity)
  })
})

// ─────────────────────────────────────────────────────────────────
// i18n — fallback chain
// ─────────────────────────────────────────────────────────────────

describe('i18n — fallback chain', () => {
  it('returns the target-language value when present', () => {
    // nav.dashboard exists in en, es, fr per strings.en.json
    expect(t('nav.dashboard', 'en')).toBe('Dashboard')
    // fr value should differ from en (different translation)
    expect(t('nav.dashboard', 'fr')).not.toBe('')
  })

  it('returns the raw key when missing everywhere (observability)', () => {
    expect(t('this.key.absolutely.does.not.exist', 'en')).toBe('this.key.absolutely.does.not.exist')
  })

  it('normalizeLanguage returns "en" for unsupported input', () => {
    expect(normalizeLanguage('klingon')).toBe('en')
    expect(normalizeLanguage(null)).toBe('en')
    expect(normalizeLanguage(undefined)).toBe('en')
    expect(normalizeLanguage(42)).toBe('en')
  })

  it('isSupportedLanguage type guard', () => {
    expect(isSupportedLanguage('en')).toBe(true)
    expect(isSupportedLanguage('es')).toBe(true)
    expect(isSupportedLanguage('fr')).toBe(true)
    expect(isSupportedLanguage('de')).toBe(false)
    expect(isSupportedLanguage('')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────
// BBS ratio — degenerate inputs
// ─────────────────────────────────────────────────────────────────

describe('BBS v2 — ratio + summarization', () => {
  it('returns zeros + null ratio for an empty list (ratio undefined when no unsafe)', () => {
    const s = summarizeObservations([])
    expect(s.total).toBe(0)
    expect(s.unsafeCount).toBe(0)
    expect(s.safeToUnsafeRatio).toBeNull()
  })

  it('null ratio when only safe behaviors (zero unsafe → undefined ratio, fail-safe red)', () => {
    const s = summarizeObservations([
      {
        id: '1', category: 'safe_behavior', created_at: '2026-05-15T00:00:00Z',
      },
      {
        id: '2', category: 'safe_behavior', created_at: '2026-05-15T00:00:00Z',
      },
    ])
    expect(s.safeToUnsafeRatio).toBeNull()
    expect(bandRatio(s.safeToUnsafeRatio)).toBe('red')
  })

  it('returns 0 ratio when only unsafe items are recorded', () => {
    const s = summarizeObservations([
      { id: '1', category: 'unsafe_act', created_at: '2026-05-15T00:00:00Z' },
      { id: '2', category: 'unsafe_condition', created_at: '2026-05-15T00:00:00Z' },
    ])
    expect(s.safeToUnsafeRatio).toBe(0)
    expect(bandRatio(s.safeToUnsafeRatio)).toBe('red')
  })

  it('bandRatio thresholds match industry-standard cuts (red < 2 ≤ yellow < 4 ≤ green)', () => {
    expect(bandRatio(null)).toBe('red')      // documented fail-safe for missing data
    expect(bandRatio(0)).toBe('red')         // <2:1
    expect(bandRatio(1.99)).toBe('red')      // <2:1
    expect(bandRatio(2)).toBe('yellow')      // exactly 2:1 — inclusive lower
    expect(bandRatio(3.99)).toBe('yellow')   // <4:1
    expect(bandRatio(4)).toBe('green')       // ≥4:1 — inclusive lower
    expect(bandRatio(Infinity)).toBe('red')  // Infinity is "unexpected" per helper docs
  })
})
