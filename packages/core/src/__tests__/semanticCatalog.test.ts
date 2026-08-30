import { describe, it, expect } from 'vitest'
import {
  METRICS,
  DIMENSIONS,
  getMetric,
  availableMetrics,
  planQuery,
} from '../semanticCatalog'

const RANGE = { from: '2026-01-01', to: '2026-06-30' }

describe('catalog integrity', () => {
  it('has unique metric ids and unique dimension ids', () => {
    expect(new Set(METRICS.map(m => m.id)).size).toBe(METRICS.length)
    expect(new Set(DIMENSIONS.map(d => d.id)).size).toBe(DIMENSIONS.length)
  })

  it('only references dimensions that exist', () => {
    const known = new Set(DIMENSIONS.map(d => d.id))
    for (const m of METRICS) {
      for (const d of m.dimensions) expect(known.has(d)).toBe(true)
    }
  })

  it('gives every metric a symbolic formula with no interpolated values', () => {
    for (const m of METRICS) {
      expect(m.formula.length).toBeGreaterThan(0)
      // A wiki formula must teach the shape, not echo one tenant's numbers.
      expect(m.formula).not.toMatch(/\$\{/)
    }
  })

  it('requires a blockedReason for anything not exposed, and never a bare block', () => {
    for (const m of METRICS) {
      if (m.blockedReason !== undefined) {
        expect(m.blockedReason.trim().length).toBeGreaterThan(20)
      }
    }
  })

  it('excludes blocked metrics from the available set', () => {
    const available = availableMetrics().map(m => m.id)
    expect(available).toContain('recordable_cases')
    expect(available).not.toContain('trir')
    expect(available).not.toContain('near_miss_reports')
  })
})

describe('planQuery — the happy path', () => {
  it('plans recordable cases by facility and month', () => {
    const res = planQuery({
      metricId: 'recordable_cases', dimensions: ['facility', 'time'], grain: 'month', ...RANGE,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.table).toBe('incidents')
    expect(res.plan.timeColumn).toBe('occurred_at')
    expect(res.plan.groupBy).toEqual(['facility_id', 'occurred_at'])
  })

  it('carries the metric caveats into the plan disclosures', () => {
    const res = planQuery({
      metricId: 'recordable_cases', dimensions: ['time'], grain: 'month', ...RANGE,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.disclosures.some(d => /restates history/i.test(d))).toBe(true)
  })

  it('adds the facility-dimension caveat when slicing by facility', () => {
    const res = planQuery({
      metricId: 'recordable_cases', dimensions: ['facility'], grain: 'month', ...RANGE,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.disclosures.some(d => /primary facility/i.test(d))).toBe(true)
  })
})

describe('planQuery — refusals', () => {
  it('refuses an unknown metric', () => {
    const res = planQuery({ metricId: 'nope', dimensions: [], grain: 'month', ...RANGE })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/unknown metric/i)
  })

  it('refuses a blocked metric and explains why', () => {
    const res = planQuery({ metricId: 'trir', dimensions: ['time'], grain: 'month', ...RANGE })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/cannot be reported yet/i)
    expect(res.error).toMatch(/hours worked/i)
  })

  it('refuses a facility breakdown of a tenant-only metric rather than silently widening', () => {
    // Even if trir were unblocked, asking for it per facility must fail loudly.
    const trir = getMetric('trir')
    expect(trir?.scope).toBe('tenant_only')
    const res = planQuery({
      metricId: 'trir', dimensions: ['facility'], grain: 'month', ...RANGE,
    })
    expect(res.ok).toBe(false)
  })

  it('refuses a dimension the metric does not support', () => {
    const res = planQuery({
      metricId: 'recordable_cases', dimensions: ['incident_type'], grain: 'month', ...RANGE,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/cannot be broken down/i)
  })

  it('refuses an invalid or inverted date range', () => {
    expect(planQuery({
      metricId: 'recordable_cases', dimensions: [], grain: 'month', from: 'yesterday', to: '2026-06-30',
    }).ok).toBe(false)
    expect(planQuery({
      metricId: 'recordable_cases', dimensions: [], grain: 'month', from: '2026-06-30', to: '2026-01-01',
    }).ok).toBe(false)
  })

  it('refuses a facilityId filter on a tenant-only metric even with no facility dimension', () => {
    const res = planQuery({
      metricId: 'trir', dimensions: ['time'], grain: 'month', facilityId: 'abc', ...RANGE,
    })
    expect(res.ok).toBe(false)
  })
})
