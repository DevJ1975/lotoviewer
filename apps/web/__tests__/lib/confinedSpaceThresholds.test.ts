import { describe, it, expect } from 'vitest'
import {
  effectiveThresholds,
  evaluateChannel,
  evaluateTest,
  permitState,
  validateAcceptableConditions,
  SITE_DEFAULTS,
  type ThresholdSet,
} from '@soteria/core/confinedSpaceThresholds'
import type { AcceptableConditions, AtmosphericTest, ConfinedSpace, ConfinedSpacePermit } from '@soteria/core/types'

// Convenience builders for objects with optional fallback shapes.
function mkSpace(overrides?: AcceptableConditions | null): Pick<ConfinedSpace, 'acceptable_conditions'> {
  return { acceptable_conditions: overrides ?? null }
}
function mkPermit(overrides?: AcceptableConditions | null): Pick<ConfinedSpacePermit, 'acceptable_conditions_override'> {
  return { acceptable_conditions_override: overrides ?? null }
}
function mkTest(partial: Partial<Pick<AtmosphericTest, 'o2_pct' | 'lel_pct' | 'h2s_ppm' | 'co_ppm'>>): Pick<AtmosphericTest, 'o2_pct' | 'lel_pct' | 'h2s_ppm' | 'co_ppm'> {
  return {
    o2_pct:  partial.o2_pct  ?? null,
    lel_pct: partial.lel_pct ?? null,
    h2s_ppm: partial.h2s_ppm ?? null,
    co_ppm:  partial.co_ppm  ?? null,
  }
}

const DEFAULTS: ThresholdSet = SITE_DEFAULTS

// ── SITE_DEFAULTS — verify the OSHA-baseline values ────────────────────────

describe('SITE_DEFAULTS', () => {
  it('matches the universally-cited industry baselines', () => {
    expect(SITE_DEFAULTS.o2_min).toBe(19.5)
    expect(SITE_DEFAULTS.o2_max).toBe(23.5)
    expect(SITE_DEFAULTS.lel_max).toBe(10)
    expect(SITE_DEFAULTS.h2s_max).toBe(10)
    expect(SITE_DEFAULTS.co_max).toBe(35)
  })
})

// ── effectiveThresholds — fallback chain (permit → space → site) ───────────

describe('effectiveThresholds', () => {
  it('returns site defaults when both permit and space are null', () => {
    expect(effectiveThresholds(null, null)).toEqual(DEFAULTS)
  })

  it('returns site defaults when both have null acceptable_conditions', () => {
    expect(effectiveThresholds(mkPermit(null), mkSpace(null))).toEqual(DEFAULTS)
  })

  it('returns site defaults when both have empty override objects', () => {
    expect(effectiveThresholds(mkPermit({}), mkSpace({}))).toEqual(DEFAULTS)
  })

  it('uses space overrides when permit has none', () => {
    const space = mkSpace({ o2_min: 20, lel_max: 5 })
    const t = effectiveThresholds(null, space)
    expect(t.o2_min).toBe(20)
    expect(t.lel_max).toBe(5)
    // Untouched fields fall through to defaults
    expect(t.o2_max).toBe(DEFAULTS.o2_max)
    expect(t.h2s_max).toBe(DEFAULTS.h2s_max)
    expect(t.co_max).toBe(DEFAULTS.co_max)
  })

  it('permit overrides win over space overrides on a per-field basis', () => {
    const space  = mkSpace({ o2_min: 20.0, lel_max: 8 })
    const permit = mkPermit({ o2_min: 21.0 })
    const t = effectiveThresholds(permit, space)
    // permit wins for o2_min
    expect(t.o2_min).toBe(21.0)
    // permit silent on lel_max → space wins
    expect(t.lel_max).toBe(8)
  })

  it('treats explicit 0 as a real override (not a fallback)', () => {
    // Inert atmospheres — supervisor with SCBA may set O2 floor to 0.
    // Nullish coalescing must NOT short-circuit on 0.
    const t = effectiveThresholds(mkPermit({ o2_min: 0 }), null)
    expect(t.o2_min).toBe(0)
    expect(t.o2_max).toBe(DEFAULTS.o2_max)
  })

  it('applies fallback chain independently per field', () => {
    // Three different fields, three different sources — make sure no field
    // accidentally pulls from a wrong layer.
    const space  = mkSpace({ o2_min: 20, lel_max: 5 })
    const permit = mkPermit({ h2s_max: 5 })
    const t = effectiveThresholds(permit, space)
    expect(t.o2_min).toBe(20)                  // from space
    expect(t.lel_max).toBe(5)                  // from space
    expect(t.h2s_max).toBe(5)                  // from permit
    expect(t.co_max).toBe(DEFAULTS.co_max)     // from defaults
    expect(t.o2_max).toBe(DEFAULTS.o2_max)     // from defaults
  })
})

// ── evaluateChannel — boundary conditions on each channel ──────────────────

describe('evaluateChannel', () => {
  describe('null/undefined/NaN handling', () => {
    it('returns "unknown" for null', () => {
      expect(evaluateChannel('o2', null, DEFAULTS)).toBe('unknown')
    })
    it('returns "unknown" for undefined', () => {
      expect(evaluateChannel('o2', undefined, DEFAULTS)).toBe('unknown')
    })
    it('returns "unknown" for NaN', () => {
      expect(evaluateChannel('o2', NaN, DEFAULTS)).toBe('unknown')
    })
  })

  describe('O₂ — bounded on both sides (deficient AND enriched are unsafe)', () => {
    // §1910.146 doesn't fix exact numbers but the OSHA-cited range is
    // 19.5-23.5%. Both ends are real failure modes: deficiency causes
    // suffocation, enrichment is a fire/explosion accelerant.
    it('passes at exact lower bound (19.5)', () => {
      expect(evaluateChannel('o2', 19.5, DEFAULTS)).toBe('pass')
    })
    it('passes at exact upper bound (23.5)', () => {
      expect(evaluateChannel('o2', 23.5, DEFAULTS)).toBe('pass')
    })
    it('passes mid-range (20.9 — atmospheric normal)', () => {
      expect(evaluateChannel('o2', 20.9, DEFAULTS)).toBe('pass')
    })
    it('fails just below lower bound', () => {
      expect(evaluateChannel('o2', 19.49, DEFAULTS)).toBe('fail')
    })
    it('fails just above upper bound', () => {
      expect(evaluateChannel('o2', 23.51, DEFAULTS)).toBe('fail')
    })
    it('fails at deficient atmosphere (18.0)', () => {
      expect(evaluateChannel('o2', 18.0, DEFAULTS)).toBe('fail')
    })
    it('fails at enriched atmosphere (24.0)', () => {
      expect(evaluateChannel('o2', 24.0, DEFAULTS)).toBe('fail')
    })
  })

  describe('LEL — only an upper bound', () => {
    it('passes at zero (no flammables)', () => {
      expect(evaluateChannel('lel', 0, DEFAULTS)).toBe('pass')
    })
    it('passes at exact upper bound (10%)', () => {
      expect(evaluateChannel('lel', 10, DEFAULTS)).toBe('pass')
    })
    it('fails just above upper bound (10.01)', () => {
      expect(evaluateChannel('lel', 10.01, DEFAULTS)).toBe('fail')
    })
  })

  describe('H₂S — only an upper bound', () => {
    it('passes at zero', () => {
      expect(evaluateChannel('h2s', 0, DEFAULTS)).toBe('pass')
    })
    it('passes at exact upper bound (10 ppm)', () => {
      expect(evaluateChannel('h2s', 10, DEFAULTS)).toBe('pass')
    })
    it('fails just above (10.1 ppm)', () => {
      expect(evaluateChannel('h2s', 10.1, DEFAULTS)).toBe('fail')
    })
  })

  describe('CO — only an upper bound', () => {
    it('passes at exact upper bound (35 ppm)', () => {
      expect(evaluateChannel('co', 35, DEFAULTS)).toBe('pass')
    })
    it('fails just above (35.1 ppm)', () => {
      expect(evaluateChannel('co', 35.1, DEFAULTS)).toBe('fail')
    })
  })

  describe('respects the threshold set actually passed in', () => {
    // Make sure stricter overrides take effect (not always SITE_DEFAULTS).
    const strict: ThresholdSet = { o2_min: 20.5, o2_max: 22, lel_max: 1, h2s_max: 1, co_max: 5 }
    it('O₂ 19.8 fails the strict 20.5-22 range', () => {
      expect(evaluateChannel('o2', 19.8, strict)).toBe('fail')
    })
    it('LEL 5 fails strict 1% cap', () => {
      expect(evaluateChannel('lel', 5, strict)).toBe('fail')
    })
  })
})

// ── evaluateTest — cross-channel rollup ────────────────────────────────────

describe('evaluateTest', () => {
  it('returns "unknown" when no channels are recorded (all null)', () => {
    const r = evaluateTest(mkTest({}), DEFAULTS)
    expect(r.status).toBe('unknown')
    expect(r.channels).toEqual({ o2: 'unknown', lel: 'unknown', h2s: 'unknown', co: 'unknown' })
  })

  it('returns "unknown" when only O₂ is recorded — LEL is mandatory too per §(d)(5)', () => {
    expect(evaluateTest(mkTest({ o2_pct: 20.9 }), DEFAULTS).status).toBe('unknown')
  })

  it('returns "unknown" when only LEL is recorded — O₂ is mandatory too', () => {
    expect(evaluateTest(mkTest({ lel_pct: 0 }), DEFAULTS).status).toBe('unknown')
  })

  it('returns "pass" when O₂ + LEL are passing and toxics are missing (toxics are conditional)', () => {
    const r = evaluateTest(mkTest({ o2_pct: 20.9, lel_pct: 0 }), DEFAULTS)
    expect(r.status).toBe('pass')
    expect(r.channels.o2).toBe('pass')
    expect(r.channels.lel).toBe('pass')
    expect(r.channels.h2s).toBe('unknown')
    expect(r.channels.co).toBe('unknown')
  })

  it('returns "pass" when all four channels are within bounds', () => {
    const r = evaluateTest(mkTest({ o2_pct: 20.9, lel_pct: 0, h2s_ppm: 0, co_ppm: 0 }), DEFAULTS)
    expect(r.status).toBe('pass')
  })

  it('returns "fail" when any channel fails — even if others are missing', () => {
    // O₂ recorded as deficient; LEL/H₂S/CO not measured. Should still fail —
    // a known fail beats incomplete-but-otherwise-fine.
    const r = evaluateTest(mkTest({ o2_pct: 18.0 }), DEFAULTS)
    expect(r.status).toBe('fail')
    expect(r.channels.o2).toBe('fail')
  })

  it('returns "fail" when LEL fails despite O₂/H₂S/CO passing', () => {
    expect(evaluateTest(mkTest({ o2_pct: 20.9, lel_pct: 12, h2s_ppm: 0, co_ppm: 0 }), DEFAULTS).status).toBe('fail')
  })

  it('returns "fail" when H₂S exceeds threshold (toxic-only fail)', () => {
    expect(evaluateTest(mkTest({ o2_pct: 20.9, lel_pct: 0, h2s_ppm: 50 }), DEFAULTS).status).toBe('fail')
  })

  it('returns "fail" if any single channel fails — fail beats unknown elsewhere', () => {
    const r = evaluateTest(mkTest({ o2_pct: NaN, lel_pct: 25 }), DEFAULTS)
    // O₂ is unknown, LEL is fail. Status must be fail (the loud-failure rule).
    expect(r.channels.o2).toBe('unknown')
    expect(r.channels.lel).toBe('fail')
    expect(r.status).toBe('fail')
  })
})

// ── permitState — four-state transitions ───────────────────────────────────

describe('permitState', () => {
  const future = new Date(Date.now() + 60_000).toISOString()
  const past   = new Date(Date.now() - 60_000).toISOString()

  it('returns "canceled" when canceled_at is set, regardless of signature/expiry', () => {
    expect(permitState({
      canceled_at:                   '2026-04-23T12:00:00Z',
      entry_supervisor_signature_at: '2026-04-23T11:00:00Z',
      expires_at:                    future,
    })).toBe('canceled')
  })

  it('returns "pending_signature" when not signed and not canceled', () => {
    expect(permitState({
      canceled_at:                   null,
      entry_supervisor_signature_at: null,
      expires_at:                    future,
    })).toBe('pending_signature')
  })

  it('returns "active" when signed, not canceled, and not yet expired', () => {
    expect(permitState({
      canceled_at:                   null,
      entry_supervisor_signature_at: '2026-04-23T11:00:00Z',
      expires_at:                    future,
    })).toBe('active')
  })

  it('returns "expired" when signed, not canceled, and past expires_at', () => {
    expect(permitState({
      canceled_at:                   null,
      entry_supervisor_signature_at: '2026-04-23T11:00:00Z',
      expires_at:                    past,
    })).toBe('expired')
  })

  it('treats unparseable expires_at as "expired" (fail-closed)', () => {
    // A corrupted timestamp would compare false against now() and silently
    // classify the permit as 'active' under the old code path. Fail-closed:
    // unparseable means expired so the supervisor re-issues.
    expect(permitState({
      canceled_at:                   null,
      entry_supervisor_signature_at: '2026-04-23T11:00:00Z',
      expires_at:                    'not-a-date',
    })).toBe('expired')
  })

  it('canceled state takes precedence over an unparseable expiry', () => {
    expect(permitState({
      canceled_at:                   '2026-04-23T12:00:00Z',
      entry_supervisor_signature_at: '2026-04-23T11:00:00Z',
      expires_at:                    'not-a-date',
    })).toBe('canceled')
  })
})

// ── validateAcceptableConditions — input sanity for permit overrides ───────

describe('validateAcceptableConditions', () => {
  it('returns null for an empty object', () => {
    expect(validateAcceptableConditions({})).toBeNull()
  })

  it('returns null for a fully-specified valid override', () => {
    expect(validateAcceptableConditions({
      o2_min: 19.5, o2_max: 23.5, lel_max: 5, h2s_max: 5, co_max: 25,
    })).toBeNull()
  })

  it('returns an error when o2_min equals o2_max', () => {
    const err = validateAcceptableConditions({ o2_min: 21, o2_max: 21 })
    expect(err).toMatch(/Oxygen minimum must be less than maximum/)
  })

  it('returns an error when o2_min > o2_max', () => {
    const err = validateAcceptableConditions({ o2_min: 22, o2_max: 21 })
    expect(err).toMatch(/Oxygen minimum must be less than maximum/)
  })

  it('does not error when only one of o2_min / o2_max is set', () => {
    expect(validateAcceptableConditions({ o2_min: 20 })).toBeNull()
    expect(validateAcceptableConditions({ o2_max: 22 })).toBeNull()
  })

  it('returns an error for any negative numeric field', () => {
    expect(validateAcceptableConditions({ lel_max: -1 })).toMatch(/cannot be negative/)
    expect(validateAcceptableConditions({ h2s_max: -5 })).toMatch(/cannot be negative/)
  })

  it('does not flag the `other` array (typeof check skips arrays)', () => {
    // The validator iterates entries and only checks numeric ones; the
    // optional `other` array shouldn't trip the negative-number check.
    expect(validateAcceptableConditions({
      other: [{ name: 'NH3', unit: 'ppm', max: 25 }],
    })).toBeNull()
  })
})
