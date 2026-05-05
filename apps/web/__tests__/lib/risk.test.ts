import { describe, it, expect } from 'vitest'
import {
  scoreRisk,
  bandFor,
  colorFor,
  authorityFor,
  reviewCadenceDays,
  isResidualAcceptable,
  evaluatePpeAloneRule,
  highestAppliedControl,
  readRiskConfig,
  HIERARCHY_ORDER,
  DEFAULT_ACCEPTANCE_THRESHOLD,
  SEVERITY_LABELS,
  LIKELIHOOD_LABELS,
  type Band,
  type Severity,
  type Likelihood,
} from '@soteria/core/risk'

// Risk scoring engine — full coverage of the 5x5 matrix + every
// PDD §4.5 / §4.6 / §6.3 rule. The DB has parallel generated
// columns; if these tests pass and migration 037 is applied, the
// two layers stay in sync.

// ──────────────────────────────────────────────────────────────────────────
// scoreRisk
// ──────────────────────────────────────────────────────────────────────────

describe('scoreRisk', () => {
  it('multiplies severity × likelihood', () => {
    expect(scoreRisk(1, 1)).toBe(1)
    expect(scoreRisk(3, 4)).toBe(12)
    expect(scoreRisk(5, 5)).toBe(25)
  })

  it('returns NaN for out-of-range inputs (caller bug should fail loudly)', () => {
    expect(scoreRisk(0, 3)).toBeNaN()
    expect(scoreRisk(6, 3)).toBeNaN()
    expect(scoreRisk(3, 0)).toBeNaN()
    expect(scoreRisk(3, 6)).toBeNaN()
    expect(scoreRisk(2.5, 3)).toBeNaN()
    expect(scoreRisk(NaN, 3)).toBeNaN()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// bandFor — PDD §4.5 thresholds
// ──────────────────────────────────────────────────────────────────────────
//
// Manual matrix derived from PDD §4.5 thresholds (1–3 low,
// 4–6 moderate, 8–12 high, 15–25 extreme). Each entry below is the
// EXPECTED 4-band result for matrix coord (severity, likelihood).
// The test below cross-checks bandFor against it for every cell.
// Drift means either (a) bandFor is wrong, or (b) the threshold
// assumption has shifted.
//
// PDD INCONSISTENCY FLAGGED: §4.4's color-coded matrix has
// transcription errors — score=4 cells render as green and
// score=9 (L=3,S=3) renders as yellow. §4.5's explicit threshold
// table drives band assignment per the PDD's own structure
// (acceptance criteria + authority + cadence are all defined off
// the §4.5 bands), so we trust §4.5. The engine + this grid both
// follow §4.5; the §4.4 visual matrix should be regenerated from
// these thresholds in a future PDD revision.

const EXPECTED_4_BAND_MATRIX: Record<string, Band> = {
  // L=1 (Rare)
  '1,1': 'low',      '2,1': 'low',      '3,1': 'low',      '4,1': 'moderate', '5,1': 'moderate',
  // L=2 (Unlikely)
  '1,2': 'low',      '2,2': 'moderate', '3,2': 'moderate', '4,2': 'high',     '5,2': 'high',
  // L=3 (Possible)
  '1,3': 'low',      '2,3': 'moderate', '3,3': 'high',     '4,3': 'high',     '5,3': 'extreme',
  // L=4 (Likely)
  '1,4': 'moderate', '2,4': 'high',     '3,4': 'high',     '4,4': 'extreme',  '5,4': 'extreme',
  // L=5 (Almost Certain)
  '1,5': 'moderate', '2,5': 'high',     '3,5': 'extreme',  '4,5': 'extreme',  '5,5': 'extreme',
}

describe('bandFor — 4-band scheme covers every cell of the 5x5 matrix per PDD §4.5', () => {
  for (let s = 1 as number; s <= 5; s++) {
    for (let l = 1 as number; l <= 5; l++) {
      const score = s * l
      const expected = EXPECTED_4_BAND_MATRIX[`${s},${l}`]!
      it(`(severity=${s}, likelihood=${l}) → score=${score} → ${expected}`, () => {
        expect(bandFor(score)).toBe(expected)
      })
    }
  }
})

describe('bandFor — boundary scores', () => {
  it('score=3 is the upper bound of low', () => {
    expect(bandFor(3)).toBe('low')
  })
  it('score=4 is the lower bound of moderate', () => {
    expect(bandFor(4)).toBe('moderate')
  })
  it('score=6 is the upper bound of moderate', () => {
    expect(bandFor(6)).toBe('moderate')
  })
  it('score=8 is the lower bound of high (PDD §4.5 — also the PPE-alone threshold)', () => {
    expect(bandFor(8)).toBe('high')
  })
  it('score=12 is the upper bound of high', () => {
    expect(bandFor(12)).toBe('high')
  })
  it('score=15 is the lower bound of extreme', () => {
    expect(bandFor(15)).toBe('extreme')
  })
  it('score=25 is the maximum value, in extreme', () => {
    expect(bandFor(25)).toBe('extreme')
  })
  // Score=7 isn't reachable from the 5x5 grid but the function should still
  // be deterministic for callers passing freeform values.
  it('score=7 (not reachable from 5x5 grid) classifies as high (defensive)', () => {
    expect(bandFor(7)).toBe('high')
  })
})

describe('bandFor — 3-band scheme collapses extreme into high (PDD §4.5 alternative)', () => {
  it('extreme scores collapse to high', () => {
    expect(bandFor(15, '3-band')).toBe('high')
    expect(bandFor(20, '3-band')).toBe('high')
    expect(bandFor(25, '3-band')).toBe('high')
  })
  it('low / moderate / high pass through unchanged', () => {
    expect(bandFor(1,  '3-band')).toBe('low')
    expect(bandFor(3,  '3-band')).toBe('low')
    expect(bandFor(4,  '3-band')).toBe('moderate')
    expect(bandFor(6,  '3-band')).toBe('moderate')
    expect(bandFor(8,  '3-band')).toBe('high')
    expect(bandFor(12, '3-band')).toBe('high')
  })
})

describe('bandFor — defensive errors', () => {
  it('throws on score=0 or negative', () => {
    expect(() => bandFor(0)).toThrow()
    expect(() => bandFor(-1)).toThrow()
  })
  it('throws on NaN', () => {
    expect(() => bandFor(NaN)).toThrow()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// colorFor — every band ships color + label + pattern + contrast class
// ──────────────────────────────────────────────────────────────────────────

describe('colorFor', () => {
  const BANDS: Band[] = ['low', 'moderate', 'high', 'extreme']

  for (const band of BANDS) {
    it(`returns hex + tailwind + pattern + label + textClass for ${band}`, () => {
      const d = colorFor(band)
      expect(d.hex).toMatch(/^#[0-9A-F]{6}$/)
      expect(d.tailwind).toMatch(/^bg-\w+/)
      expect(d.pattern).toMatch(/^pattern-band-/)
      expect(d.label.length).toBeGreaterThan(0)
      expect(d.textClass).toMatch(/^text-/)
    })
  }

  it('matches PDD §4.5 hex values exactly', () => {
    expect(colorFor('low').hex).toBe('#16A34A')
    expect(colorFor('moderate').hex).toBe('#EAB308')
    expect(colorFor('high').hex).toBe('#EA580C')
    expect(colorFor('extreme').hex).toBe('#DC2626')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// authorityFor — PDD §4.5 acceptance authority
// ──────────────────────────────────────────────────────────────────────────

describe('authorityFor', () => {
  it('low risks can be accepted by a supervisor', () => {
    expect(authorityFor('low')).toBe('supervisor')
  })
  it('moderate risks require department manager', () => {
    expect(authorityFor('moderate')).toBe('manager')
  })
  it('high risks require site/plant manager', () => {
    expect(authorityFor('high')).toBe('site_manager')
  })
  it('extreme risks require executive / safety director', () => {
    expect(authorityFor('extreme')).toBe('executive')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// reviewCadenceDays — PDD §6.3
// ──────────────────────────────────────────────────────────────────────────

describe('reviewCadenceDays', () => {
  it('extreme: 90 days', () => {
    expect(reviewCadenceDays('extreme')).toBe(90)
  })
  it('high: 180 days', () => {
    expect(reviewCadenceDays('high')).toBe(180)
  })
  it('moderate: 365 days (annually)', () => {
    expect(reviewCadenceDays('moderate')).toBe(365)
  })
  it('low: 730 days (every 2 years)', () => {
    expect(reviewCadenceDays('low')).toBe(730)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// isResidualAcceptable — PDD §4.6 close criterion
// ──────────────────────────────────────────────────────────────────────────

describe('isResidualAcceptable', () => {
  it('default threshold is 6 (Moderate)', () => {
    expect(DEFAULT_ACCEPTANCE_THRESHOLD).toBe(6)
  })

  it('residual ≤ threshold passes', () => {
    expect(isResidualAcceptable(1)).toBe(true)
    expect(isResidualAcceptable(6)).toBe(true)
  })

  it('residual > threshold fails', () => {
    expect(isResidualAcceptable(8)).toBe(false)
    expect(isResidualAcceptable(25)).toBe(false)
  })

  it('null / undefined residual fails (risk has no residual yet)', () => {
    expect(isResidualAcceptable(null)).toBe(false)
    expect(isResidualAcceptable(undefined)).toBe(false)
  })

  it('honors a custom threshold (e.g. ≤4 for stricter sectors per PDD §20)', () => {
    expect(isResidualAcceptable(4, 4)).toBe(true)
    expect(isResidualAcceptable(5, 4)).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// evaluatePpeAloneRule — ISO 45001 8.1.2 + OSHA 1910.132(a)
// ──────────────────────────────────────────────────────────────────────────

describe('evaluatePpeAloneRule', () => {
  it('does not apply when inherent_score < 8', () => {
    const r = evaluatePpeAloneRule({
      inherentScore:           6,
      controlLevels:           ['ppe'],
      hasPpeOnlyJustification: false,
    })
    expect(r.applies).toBe(false)
    expect(r.allowed).toBe(true)
  })

  it('does not apply when there are zero controls (mid-edit state)', () => {
    const r = evaluatePpeAloneRule({
      inherentScore:           20,
      controlLevels:           [],
      hasPpeOnlyJustification: false,
    })
    expect(r.applies).toBe(false)
    expect(r.allowed).toBe(true)
  })

  it('does not apply when at least one control is non-PPE', () => {
    const r = evaluatePpeAloneRule({
      inherentScore:           20,
      controlLevels:           ['engineering', 'ppe'],
      hasPpeOnlyJustification: false,
    })
    expect(r.applies).toBe(false)
    expect(r.allowed).toBe(true)
  })

  it('applies + blocks when high-inherent risk has only PPE controls and no justification', () => {
    const r = evaluatePpeAloneRule({
      inherentScore:           12,
      controlLevels:           ['ppe', 'ppe'],
      hasPpeOnlyJustification: false,
    })
    expect(r.applies).toBe(true)
    expect(r.allowed).toBe(false)
    expect(r.justificationRequired).toBe(true)
  })

  it('applies + allows when justification is present', () => {
    const r = evaluatePpeAloneRule({
      inherentScore:           12,
      controlLevels:           ['ppe'],
      hasPpeOnlyJustification: true,
    })
    expect(r.applies).toBe(true)
    expect(r.allowed).toBe(true)
  })

  it('applies at the boundary score=8 (PPE-alone threshold per PDD §4.5)', () => {
    const r = evaluatePpeAloneRule({
      inherentScore:           8,
      controlLevels:           ['ppe'],
      hasPpeOnlyJustification: false,
    })
    expect(r.applies).toBe(true)
    expect(r.allowed).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// highestAppliedControl
// ──────────────────────────────────────────────────────────────────────────

describe('highestAppliedControl', () => {
  it('returns null for an empty list', () => {
    expect(highestAppliedControl([])).toBeNull()
  })

  it('picks the most-effective level present (elimination beats engineering beats ppe)', () => {
    expect(highestAppliedControl(['ppe', 'engineering', 'elimination'])).toBe('elimination')
    expect(highestAppliedControl(['ppe', 'engineering', 'administrative'])).toBe('engineering')
    expect(highestAppliedControl(['ppe', 'administrative'])).toBe('administrative')
    expect(highestAppliedControl(['ppe'])).toBe('ppe')
  })

  it('reflects HIERARCHY_ORDER (elimination → ppe)', () => {
    expect(HIERARCHY_ORDER[0]).toBe('elimination')
    expect(HIERARCHY_ORDER[HIERARCHY_ORDER.length - 1]).toBe('ppe')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// readRiskConfig — tenant settings parser
// ──────────────────────────────────────────────────────────────────────────

describe('readRiskConfig', () => {
  it('returns defaults for null / empty settings', () => {
    expect(readRiskConfig(null)).toEqual({ bandScheme: '4-band', acceptanceThreshold: 6 })
    expect(readRiskConfig({})).toEqual({ bandScheme: '4-band', acceptanceThreshold: 6 })
  })

  it('honors a 3-band override', () => {
    expect(readRiskConfig({ risk_band_scheme: '3-band' }).bandScheme).toBe('3-band')
  })

  it('rejects garbage scheme values and falls back to 4-band', () => {
    expect(readRiskConfig({ risk_band_scheme: 'rainbow' }).bandScheme).toBe('4-band')
    expect(readRiskConfig({ risk_band_scheme: 7 }).bandScheme).toBe('4-band')
  })

  it('honors a numeric acceptance threshold in range', () => {
    expect(readRiskConfig({ risk_acceptance_threshold: 4 }).acceptanceThreshold).toBe(4)
    expect(readRiskConfig({ risk_acceptance_threshold: 12 }).acceptanceThreshold).toBe(12)
  })

  it('rejects out-of-range thresholds and falls back to 6', () => {
    expect(readRiskConfig({ risk_acceptance_threshold: 0 }).acceptanceThreshold).toBe(6)
    expect(readRiskConfig({ risk_acceptance_threshold: 26 }).acceptanceThreshold).toBe(6)
    expect(readRiskConfig({ risk_acceptance_threshold: 'six' }).acceptanceThreshold).toBe(6)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Label arrays — defensive checks (preserves PDD §4.1, §4.2 ordering)
// ──────────────────────────────────────────────────────────────────────────

describe('SEVERITY_LABELS / LIKELIHOOD_LABELS', () => {
  it('SEVERITY_LABELS has exactly 5 entries in PDD order', () => {
    expect(SEVERITY_LABELS).toHaveLength(5)
    expect(SEVERITY_LABELS[0]).toBe('Negligible')
    expect(SEVERITY_LABELS[4]).toBe('Catastrophic')
  })

  it('LIKELIHOOD_LABELS has exactly 5 entries in PDD order', () => {
    expect(LIKELIHOOD_LABELS).toHaveLength(5)
    expect(LIKELIHOOD_LABELS[0]).toBe('Rare')
    expect(LIKELIHOOD_LABELS[4]).toBe('Almost Certain')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Type-only sanity (compile-time only — these don't actually run anything)
// ──────────────────────────────────────────────────────────────────────────

describe('type guards (compile-time)', () => {
  it('Severity / Likelihood are constrained to 1..5', () => {
    const s: Severity   = 3
    const l: Likelihood = 5
    expect(scoreRisk(s, l)).toBe(15)
  })
})
