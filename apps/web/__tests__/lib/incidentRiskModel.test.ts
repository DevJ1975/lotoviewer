import { describe, it, expect } from 'vitest'
import {
  summarizeIncidentRisk,
  bandForRiskScore,
  type IncidentRiskFeatures,
} from '@soteria/core/incidentRiskModel'

// A clean program: no recordables, strong reporting + BBS, nothing overdue.
const CLEAN: IncidentRiskFeatures = {
  recordablesRecent: 0, recordablesPrior: 0,
  nearMissRecent: 20, bbsSafe: 40, bbsUnsafe: 5,
  capasOverdue: 0, riskReviewsOverdue: 0, highRisksUncontrolled: 0,
  trainingExpired: 0, atmFailed: 0, atmTotal: 30,
}

// A program in trouble on every axis.
const BAD: IncidentRiskFeatures = {
  recordablesRecent: 6, recordablesPrior: 2,
  nearMissRecent: 0, bbsSafe: 0, bbsUnsafe: 10,
  capasOverdue: 8, riskReviewsOverdue: 9, highRisksUncontrolled: 4,
  trainingExpired: 6, atmFailed: 10, atmTotal: 10,
}

describe('bandForRiskScore', () => {
  it('maps boundaries to bands', () => {
    expect(bandForRiskScore(0)).toBe('low')
    expect(bandForRiskScore(24.9)).toBe('low')
    expect(bandForRiskScore(25)).toBe('moderate')
    expect(bandForRiskScore(49.9)).toBe('moderate')
    expect(bandForRiskScore(50)).toBe('high')
    expect(bandForRiskScore(74.9)).toBe('high')
    expect(bandForRiskScore(75)).toBe('extreme')
    expect(bandForRiskScore(100)).toBe('extreme')
  })
})

describe('summarizeIncidentRisk', () => {
  it('scores a clean program low', () => {
    const r = summarizeIncidentRisk(CLEAN)
    expect(r.score).toBeLessThan(25)
    expect(r.band).toBe('low')
  })

  it('scores a troubled program high or extreme', () => {
    const r = summarizeIncidentRisk(BAD)
    expect(r.score).toBeGreaterThanOrEqual(50)
    expect(['high', 'extreme']).toContain(r.band)
  })

  it('keeps the score within 0–100', () => {
    for (const f of [CLEAN, BAD]) {
      const r = summarizeIncidentRisk(f)
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
    }
  })

  it('returns drivers sorted by contribution descending', () => {
    const { drivers } = summarizeIncidentRisk(BAD)
    for (let i = 1; i < drivers.length; i++) {
      expect(drivers[i - 1]!.contribution).toBeGreaterThanOrEqual(drivers[i]!.contribution)
    }
    // The top driver is the "where to work" answer and carries a link + action.
    expect(drivers[0]!.href).toBeTruthy()
    expect(drivers[0]!.suggestedAction).toBeTruthy()
  })

  it('contributions sum to the overall score', () => {
    const r = summarizeIncidentRisk(BAD)
    const sum = r.drivers.reduce((s, d) => s + d.contribution, 0)
    expect(Math.abs(sum - r.score)).toBeLessThan(0.5) // rounding tolerance
  })

  it('treats an empty program as low-but-nonzero (reporting blind spots)', () => {
    const EMPTY: IncidentRiskFeatures = {
      recordablesRecent: 0, recordablesPrior: 0, nearMissRecent: 0,
      bbsSafe: 0, bbsUnsafe: 0, capasOverdue: 0, riskReviewsOverdue: 0,
      highRisksUncontrolled: 0, trainingExpired: 0, atmFailed: 0, atmTotal: 0,
    }
    const r = summarizeIncidentRisk(EMPTY)
    // No incidents, but zero near-miss reporting + zero BBS are blind spots,
    // so the score is low yet not zero.
    expect(r.score).toBeGreaterThan(0)
    expect(r.band).toBe('low')
    const bbs = r.drivers.find(d => d.key === 'bbs_ratio')!
    expect(bbs.pressure).toBeGreaterThan(0)
  })

  it('tags every driver as leading or lagging, with recordables lagging', () => {
    const { drivers } = summarizeIncidentRisk(BAD)
    for (const d of drivers) {
      expect(['leading', 'lagging']).toContain(d.kind)
    }
    expect(drivers.find(d => d.key === 'recordable_trend')!.kind).toBe('lagging')
    expect(drivers.find(d => d.key === 'near_miss_reporting')!.kind).toBe('leading')
    // The model is predominantly leading indicators (that is the point of a
    // *predictive* risk model) — there is at least one of each.
    expect(drivers.some(d => d.kind === 'leading')).toBe(true)
    expect(drivers.some(d => d.kind === 'lagging')).toBe(true)
  })

  it('a rising recordable count raises the recordable driver', () => {
    const rising = summarizeIncidentRisk({ ...CLEAN, recordablesRecent: 3, recordablesPrior: 1 })
    const flat   = summarizeIncidentRisk({ ...CLEAN, recordablesRecent: 3, recordablesPrior: 3 })
    const dr = (x: ReturnType<typeof summarizeIncidentRisk>) => x.drivers.find(d => d.key === 'recordable_trend')!.pressure
    expect(dr(rising)).toBeGreaterThan(dr(flat))
  })

  // ── Cross-module leading indicators (v2.0.0) ────────────────────────────────
  const CROSS_KEYS = [
    'inspection_failing', 'bbs_followup_overdue', 'jha_reviews_overdue',
    'permit_noncompliance', 'training_gaps', 'ecfa_weak_controls',
  ]

  it('surfaces the new cross-module leading drivers when their inputs are present', () => {
    const r = summarizeIncidentRisk({
      ...CLEAN,
      inspectionsFailed: 4, inspectionsTotal: 10,   // 40% fail
      bbsFollowupsOpen: 3, jhaReviewsOverdue: 2, permitExpiredOpen: 1, trainingGaps: 5,
      ecfaCausalFactors: 4, ecfaWeakControls: 3,    // 75% weak-control
    })
    const byKey = new Map(r.drivers.map(d => [d.key, d]))
    for (const k of CROSS_KEYS) {
      expect(byKey.has(k)).toBe(true)
      expect(byKey.get(k)!.kind).toBe('leading')
      expect(byKey.get(k)!.href).toBeTruthy()
    }
    expect(byKey.get('inspection_failing')!.pressure).toBeCloseTo(40, 5)
    expect(byKey.get('ecfa_weak_controls')!.pressure).toBeCloseTo(75, 5)
    // Cross-module pressure raises the score above the clean baseline.
    expect(r.score).toBeGreaterThan(summarizeIncidentRisk(CLEAN).score)
    expect(r.modelVersion).toBe('2.0.0')
  })

  it('cross-module drivers stay at zero pressure when their module inputs are absent', () => {
    const { drivers } = summarizeIncidentRisk(CLEAN) // no v2 fields set
    for (const k of CROSS_KEYS) {
      expect(drivers.find(d => d.key === k)!.pressure).toBe(0)
    }
  })
})
