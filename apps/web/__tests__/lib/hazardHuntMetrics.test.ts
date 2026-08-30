import { describe, it, expect } from 'vitest'
import {
  summarizeHazardHuntMetrics,
  type HazardHuntFindingInput,
  type HazardHuntMetricsInput,
} from '@soteria/core/hazardHuntMetrics'

// summarizeHazardHuntMetrics is the single source of truth for the Hazard Hunt
// KPIs the dashboard and the DS agent both read. It is pure, so a fixed `asOf`
// makes the recent-vs-prior trend split fully deterministic to assert against.

const AS_OF = '2026-06-19T00:00:00Z'

function finding(over: Partial<HazardHuntFindingInput> = {}): HazardHuntFindingInput {
  return {
    hazardCategory: 'physical',
    status:         'open',
    createdAt:      '2026-06-01T00:00:00Z',
    ...over,
  }
}

function input(over: Partial<HazardHuntMetricsInput> = {}): HazardHuntMetricsInput {
  return {
    findings:       [],
    huntsGenerated: 0,
    huntsCompleted: 0,
    asOf:           AS_OF,
    ...over,
  }
}

describe('summarizeHazardHuntMetrics — empty input', () => {
  it('returns all-zeros with no NaN and a vacuously perfect cadence', () => {
    const m = summarizeHazardHuntMetrics(input())

    expect(m.totalFindings).toBe(0)
    expect(m.openFindings).toBe(0)
    expect(m.resolvedFindings).toBe(0)
    expect(m.cadenceAdherence).toBe(1) // nothing scheduled ⇒ nothing missed
    expect(m.topCategories).toEqual([])
    expect(m.trend).toEqual({ recentOpened: 0, priorOpened: 0, delta: 0 })

    // Every numeric output is a real number, never NaN.
    expect(Number.isNaN(m.cadenceAdherence)).toBe(false)
    expect(m.byCategory.every(c => Number.isFinite(c.count))).toBe(true)
  })

  it('still emits all 9 categories, zero-filled', () => {
    const m = summarizeHazardHuntMetrics(input())
    expect(m.byCategory).toHaveLength(9)
    expect(m.byCategory.every(c => c.count === 0)).toBe(true)
  })
})

describe('summarizeHazardHuntMetrics — category aggregation', () => {
  it('counts per category and zero-fills the rest', () => {
    const m = summarizeHazardHuntMetrics(input({
      findings: [
        finding({ hazardCategory: 'mechanical' }),
        finding({ hazardCategory: 'mechanical' }),
        finding({ hazardCategory: 'chemical' }),
      ],
    }))

    const byCat = Object.fromEntries(m.byCategory.map(c => [c.category, c.count]))
    expect(byCat.mechanical).toBe(2)
    expect(byCat.chemical).toBe(1)
    expect(byCat.electrical).toBe(0)
    expect(m.byCategory).toHaveLength(9)
  })

  it('orders by count desc, then category name asc for ties', () => {
    const m = summarizeHazardHuntMetrics(input({
      findings: [
        finding({ hazardCategory: 'electrical' }),
        finding({ hazardCategory: 'electrical' }),
        // 'chemical' and 'physical' tie at 1 → alphabetical tie-break.
        finding({ hazardCategory: 'physical' }),
        finding({ hazardCategory: 'chemical' }),
      ],
    }))

    expect(m.byCategory[0]).toEqual({ category: 'electrical', count: 2 })
    expect(m.byCategory[1]).toEqual({ category: 'chemical', count: 1 })
    expect(m.byCategory[2]).toEqual({ category: 'physical', count: 1 })
    // Zero-count categories sort after, also alphabetically.
    expect(m.byCategory[3]?.count).toBe(0)
    expect(m.byCategory[3]?.category).toBe('biological')
  })

  it('topCategories is the top 3 with count > 0', () => {
    const m = summarizeHazardHuntMetrics(input({
      findings: [
        ...Array.from({ length: 3 }, () => finding({ hazardCategory: 'mechanical' })),
        finding({ hazardCategory: 'chemical' }),
        finding({ hazardCategory: 'chemical' }),
        finding({ hazardCategory: 'electrical' }),
      ],
    }))

    expect(m.topCategories.map(c => c.category)).toEqual(['mechanical', 'chemical', 'electrical'])
    expect(m.topCategories.every(c => c.count > 0)).toBe(true)
  })

  it('topCategories excludes zero-count categories and never exceeds 3', () => {
    const m = summarizeHazardHuntMetrics(input({
      findings: [finding({ hazardCategory: 'ergonomic' })],
    }))
    expect(m.topCategories).toEqual([{ category: 'ergonomic', count: 1 }])
  })
})

describe('summarizeHazardHuntMetrics — open / resolved counts', () => {
  it('counts open findings and treats closed + escalated as resolved', () => {
    const m = summarizeHazardHuntMetrics(input({
      findings: [
        finding({ status: 'open' }),
        finding({ status: 'open' }),
        finding({ status: 'in_progress' }), // neither open nor resolved
        finding({ status: 'closed' }),      // resolved
        finding({ status: 'escalated' }),   // resolved (promoted to a risk)
      ],
    }))

    expect(m.totalFindings).toBe(5)
    expect(m.openFindings).toBe(2)
    expect(m.resolvedFindings).toBe(2)
  })
})

describe('summarizeHazardHuntMetrics — cadence adherence passthrough', () => {
  it('forwards generated/completed to cadenceAdherence (clamped 0..1)', () => {
    expect(summarizeHazardHuntMetrics(input({ huntsGenerated: 10, huntsCompleted: 5 })).cadenceAdherence).toBe(0.5)
    expect(summarizeHazardHuntMetrics(input({ huntsGenerated: 10, huntsCompleted: 10 })).cadenceAdherence).toBe(1)
    expect(summarizeHazardHuntMetrics(input({ huntsGenerated: 10, huntsCompleted: 0 })).cadenceAdherence).toBe(0)
    // Over-completion is clamped rather than exceeding 1.
    expect(summarizeHazardHuntMetrics(input({ huntsGenerated: 10, huntsCompleted: 20 })).cadenceAdherence).toBe(1)
  })
})

describe('summarizeHazardHuntMetrics — recent vs prior trend', () => {
  // With windowDays = 90 and asOf = 2026-06-19:
  //   recent = (2026-03-21, 2026-06-19]
  //   prior  = (2025-12-21, 2026-03-21]
  it('splits findings into the two adjacent windows and reports the delta', () => {
    const m = summarizeHazardHuntMetrics(input({
      windowDays: 90,
      findings: [
        finding({ createdAt: '2026-06-10T00:00:00Z' }), // recent
        finding({ createdAt: '2026-04-01T00:00:00Z' }), // recent
        finding({ createdAt: '2026-02-01T00:00:00Z' }), // prior
        finding({ createdAt: '2025-06-01T00:00:00Z' }), // older than prior → neither
      ],
    }))

    expect(m.trend).toEqual({ recentOpened: 2, priorOpened: 1, delta: 1 })
  })

  it('counts a finding created exactly at asOf in the recent window', () => {
    const m = summarizeHazardHuntMetrics(input({
      windowDays: 90,
      findings: [finding({ createdAt: AS_OF })],
    }))
    expect(m.trend.recentOpened).toBe(1)
    expect(m.trend.priorOpened).toBe(0)
  })

  it('respects a custom windowDays for the split', () => {
    // windowDays = 7 → recent = (2026-06-12, 2026-06-19].
    const m = summarizeHazardHuntMetrics(input({
      windowDays: 7,
      findings: [
        finding({ createdAt: '2026-06-15T00:00:00Z' }), // recent
        finding({ createdAt: '2026-06-08T00:00:00Z' }), // prior week
      ],
    }))
    expect(m.trend).toEqual({ recentOpened: 1, priorOpened: 1, delta: 0 })
  })
})
