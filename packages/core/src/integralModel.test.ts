import { describe, it, expect } from 'vitest'
import {
  INTEGRAL_CLASS,
  INTEGRAL_MODEL_VERSION,
  QUADRANTS,
  bandForBalanceIndex,
  integralSignalsFromIncidentMetrics,
  integralSignalsFromRisk,
  isIntegralMetricId,
  summarizeIntegralScorecard,
  type IntegralSignal,
} from './integralModel'
import {
  summarizeIncidentRisk,
  type IncidentRiskFeatures,
} from './incidentRiskModel'

// Every risk feature bad enough that all 14 drivers emit non-zero pressure —
// the fixture that proves the classification catalog covers the whole model.
const ALL_BAD_FEATURES: IncidentRiskFeatures = {
  recordablesRecent: 4, recordablesPrior: 1,
  nearMissRecent: 0,
  bbsSafe: 1, bbsUnsafe: 6,
  capasOverdue: 5, riskReviewsOverdue: 4, highRisksUncontrolled: 3,
  trainingExpired: 6, atmFailed: 3, atmTotal: 5,
  inspectionsFailed: 4, inspectionsTotal: 8,
  bbsFollowupsOpen: 5, jhaReviewsOverdue: 3, permitExpiredOpen: 2,
  trainingGaps: 7, ecfaCausalFactors: 5, ecfaWeakControls: 4,
}

const signal = (id: IntegralSignal['id'], pressure: number | null): IntegralSignal =>
  ({ id, pressure })

describe('INTEGRAL_CLASS catalog', () => {
  it('classifies every risk-model driver key with a matching kind', () => {
    const { drivers } = summarizeIncidentRisk(ALL_BAD_FEATURES)
    expect(drivers.length).toBeGreaterThanOrEqual(14)
    for (const d of drivers) {
      expect(isIntegralMetricId(d.key), `unclassified driver: ${d.key}`).toBe(true)
      if (isIntegralMetricId(d.key)) {
        expect(INTEGRAL_CLASS[d.key].kind, `kind drift on ${d.key}`).toBe(d.kind)
      }
    }
  })

  it('keeps harm outcomes off the process plane and interior quadrants honest', () => {
    expect(INTEGRAL_CLASS.recordable_trend.scope).toBe('outcome')
    // Phase 1 has no intentional-quadrant instrumentation — the blind spot
    // the Balance Index exists to surface. If this fails, celebrate and
    // update the Phase-1 assumptions in the plan doc.
    const intentionalMembers = Object.values(INTEGRAL_CLASS)
      .filter(c => c.quadrant === 'intentional')
    expect(intentionalMembers).toHaveLength(0)
  })
})

describe('summarizeIntegralScorecard', () => {
  it('scores quadrant health as 100 minus mean measured pressure', () => {
    const r = summarizeIntegralScorecard([
      signal('capa_overdue', 20),
      signal('jha_reviews_overdue', 40),
    ])
    expect(r.quadrants.systems.health).toBe(70)
    expect(r.quadrants.systems.measuredCount).toBe(2)
    expect(r.quadrants.systems.totalCount).toBe(2)
    expect(r.quadrants.systems.coverage).toBe(1)
  })

  it('excludes outcome-scope signals from quadrant health but not maturity', () => {
    const r = summarizeIntegralScorecard([
      signal('recordable_trend', 100),   // outcome — must not touch behavioral health
      signal('bbs_ratio', 20),
    ])
    expect(r.quadrants.behavioral.health).toBe(80)
    expect(r.quadrants.behavioral.totalCount).toBe(1)
    // Maturity still sees the outcome signal: reactive w=1 health 0,
    // predictive w=3 health 80 → (0 + 240) / 4 = 60.
    expect(r.maturityIndex).toBe(60)
  })

  it('treats an all-null quadrant as unmeasured, never zero', () => {
    const r = summarizeIntegralScorecard([
      signal('near_miss_reporting', null),
    ])
    expect(r.quadrants.cultural.health).toBeNull()
    expect(r.quadrants.cultural.coverage).toBe(0)
    expect(r.quadrants.cultural.totalCount).toBe(1)
  })

  it('reports a structurally-absent quadrant as coverage 0 with null health', () => {
    const r = summarizeIntegralScorecard([signal('capa_overdue', 10)])
    expect(r.quadrants.intentional.health).toBeNull()
    expect(r.quadrants.intentional.totalCount).toBe(0)
    expect(r.quadrants.intentional.coverage).toBe(0)
  })

  it('penalizes unmeasured quadrants in the balance index via the coverage factor', () => {
    // Three quadrants measured at 60/70/80 → geo ≈ 69.52, × 3/4 ≈ 52.1.
    const r = summarizeIntegralScorecard([
      signal('bbs_ratio', 40),            // behavioral 60
      signal('near_miss_reporting', 30),  // cultural   70
      signal('capa_overdue', 20),         // systems    80
    ])
    const geo = Math.pow(60 * 70 * 80, 1 / 3)
    expect(r.balanceIndex).toBeCloseTo(geo * 0.75, 0)
    expect(r.balanceIndex).toBe(52.1)
  })

  it('rewards evenness: a level program outscores a lopsided one', () => {
    const even = summarizeIntegralScorecard([
      signal('bbs_ratio', 30),
      signal('near_miss_reporting', 30),
      signal('capa_overdue', 30),
    ])
    const lopsided = summarizeIntegralScorecard([
      signal('bbs_ratio', 0),
      signal('near_miss_reporting', 50),
      signal('capa_overdue', 40),
    ])
    expect(even.balanceIndex).toBeGreaterThan(lopsided.balanceIndex)
  })

  it('names the limiting quadrant', () => {
    const r = summarizeIntegralScorecard([
      signal('bbs_ratio', 10),
      signal('near_miss_reporting', 80),  // cultural 20 — the weakest corner
      signal('capa_overdue', 30),
    ])
    expect(r.limitingQuadrant).toBe('cultural')
  })

  it('weights predictive evidence triple in the maturity index', () => {
    // Same raw health (50) everywhere; predictive-heavy vs transitional-only
    // must not differ in maturityIndex value (both 50) but DOES differ in
    // predictiveEvidenceShare — then confirm weighting moves the index when
    // healths differ by band.
    const predictiveStrong = summarizeIntegralScorecard([
      signal('bbs_ratio', 10),        // predictive, health 90
      signal('capa_overdue', 90),     // transitional, health 10
    ])
    const predictiveWeak = summarizeIntegralScorecard([
      signal('bbs_ratio', 90),        // predictive, health 10
      signal('capa_overdue', 10),     // transitional, health 90
    ])
    // (3·90 + 2·10) / 5 = 58 vs (3·10 + 2·90) / 5 = 42.
    expect(predictiveStrong.maturityIndex).toBe(58)
    expect(predictiveWeak.maturityIndex).toBe(42)
    expect(predictiveStrong.predictiveEvidenceShare).toBe(0.6)
  })

  it('returns the degenerate shape for an empty signal set — no NaN anywhere', () => {
    const r = summarizeIntegralScorecard([])
    for (const q of QUADRANTS) {
      expect(r.quadrants[q].health).toBeNull()
      expect(r.quadrants[q].coverage).toBe(0)
    }
    expect(r.balanceIndex).toBe(0)
    expect(r.limitingQuadrant).toBeNull()
    expect(r.maturityIndex).toBe(0)
    expect(r.predictiveEvidenceShare).toBe(0)
    expect(r.overallHealth).toBeNull()
    expect(Number.isFinite(r.balanceIndex)).toBe(true)
    expect(Number.isFinite(r.maturityIndex)).toBe(true)
  })

  it('clamps out-of-range pressure defensively', () => {
    const r = summarizeIntegralScorecard([signal('capa_overdue', 150)])
    expect(r.quadrants.systems.health).toBe(0)
    expect(r.balanceIndex).toBeGreaterThanOrEqual(0)
  })

  it('is deterministic and stamps the model version', () => {
    const signals = [signal('bbs_ratio', 25), signal('capa_overdue', 35)]
    const a = summarizeIntegralScorecard(signals)
    const b = summarizeIntegralScorecard(signals)
    expect(a).toEqual(b)
    expect(a.modelVersion).toBe(INTEGRAL_MODEL_VERSION)
  })
})

describe('bandForBalanceIndex', () => {
  it('maps the documented cutoffs', () => {
    expect(bandForBalanceIndex(0)).toBe('blind')
    expect(bandForBalanceIndex(29.9)).toBe('blind')
    expect(bandForBalanceIndex(30)).toBe('emerging')
    expect(bandForBalanceIndex(54.9)).toBe('emerging')
    expect(bandForBalanceIndex(55)).toBe('balanced')
    expect(bandForBalanceIndex(79.9)).toBe('balanced')
    expect(bandForBalanceIndex(80)).toBe('integrated')
  })

  it('keeps integrated unreachable while a quadrant is unmeasured', () => {
    // Best possible three-quadrant program: every measured signal perfect.
    const r = summarizeIntegralScorecard([
      signal('bbs_ratio', 0),
      signal('near_miss_reporting', 0),
      signal('capa_overdue', 0),
    ])
    expect(r.balanceIndex).toBe(75)
    expect(bandForBalanceIndex(r.balanceIndex)).toBe('balanced')
  })
})

describe('integralSignalsFromRisk', () => {
  it('maps every classified driver with its pressure intact', () => {
    const risk = summarizeIncidentRisk(ALL_BAD_FEATURES)
    const signals = integralSignalsFromRisk(risk)
    expect(signals.length).toBe(risk.drivers.length)
    const byId = new Map(signals.map(s => [s.id, s.pressure]))
    for (const d of risk.drivers) {
      expect(byId.get(d.key as IntegralSignal['id'])).toBe(d.pressure)
    }
  })
})

describe('integralSignalsFromIncidentMetrics', () => {
  it('emits only the two non-double-counted investigation KPIs', () => {
    const signals = integralSignalsFromIncidentMetrics({
      rcaCompletionPct: 75, meanTimeToCloseDays: 60,
    })
    expect(signals.map(s => s.id).sort()).toEqual(['rca_completion', 'time_to_close'])
  })

  it('converts values to pressure against the documented anchors', () => {
    const signals = integralSignalsFromIncidentMetrics({
      rcaCompletionPct: 75, meanTimeToCloseDays: 60,
    })
    const byId = new Map(signals.map(s => [s.id, s.pressure]))
    expect(byId.get('rca_completion')).toBe(25)   // 100 − 75
    expect(byId.get('time_to_close')).toBe(50)    // halfway from 30d target to 90d floor
  })

  it('propagates null denominators as unmeasured, and clamps extremes', () => {
    const nulls = integralSignalsFromIncidentMetrics({
      rcaCompletionPct: null, meanTimeToCloseDays: null,
    })
    expect(nulls.every(s => s.pressure === null)).toBe(true)

    const fast = integralSignalsFromIncidentMetrics({
      rcaCompletionPct: 100, meanTimeToCloseDays: 5,
    })
    const byId = new Map(fast.map(s => [s.id, s.pressure]))
    expect(byId.get('rca_completion')).toBe(0)
    expect(byId.get('time_to_close')).toBe(0)     // under target clamps to zero pressure

    const slow = integralSignalsFromIncidentMetrics({
      rcaCompletionPct: 0, meanTimeToCloseDays: 400,
    })
    const slowById = new Map(slow.map(s => [s.id, s.pressure]))
    expect(slowById.get('rca_completion')).toBe(100)
    expect(slowById.get('time_to_close')).toBe(100)
  })
})
