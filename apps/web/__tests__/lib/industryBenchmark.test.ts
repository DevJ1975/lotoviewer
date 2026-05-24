import { describe, it, expect } from 'vitest'
import {
  benchmarkForNaics,
  ALL_PRIVATE_INDUSTRY,
  BLS_DATA_YEAR,
} from '@soteria/core/industryBenchmark'

describe('benchmarkForNaics', () => {
  it('maps a 6-digit NAICS to its 2-digit sector', () => {
    // 332710 — machine shops → Manufacturing.
    expect(benchmarkForNaics('332710').sector).toBe('Manufacturing')
    // 236220 — commercial building construction → Construction.
    expect(benchmarkForNaics('236220').sector).toBe('Construction')
  })

  it('collapses multi-prefix sectors to one record', () => {
    // Manufacturing spans 31/32/33; retail 44/45; transport 48/49.
    expect(benchmarkForNaics('31').sector).toBe('Manufacturing')
    expect(benchmarkForNaics('33').sector).toBe('Manufacturing')
    expect(benchmarkForNaics('44').sector).toBe('Retail trade')
    expect(benchmarkForNaics('45').sector).toBe('Retail trade')
    expect(benchmarkForNaics('48').sector).toBe('Transportation & warehousing')
    expect(benchmarkForNaics('49').sector).toBe('Transportation & warehousing')
  })

  it('ignores non-digit characters before taking the prefix', () => {
    expect(benchmarkForNaics('62-1111').sector).toBe('Health care & social assistance')
  })

  it('falls back to all-private-industry for unknown / missing codes', () => {
    expect(benchmarkForNaics(null)).toEqual(ALL_PRIVATE_INDUSTRY)
    expect(benchmarkForNaics('')).toEqual(ALL_PRIVATE_INDUSTRY)
    expect(benchmarkForNaics('99')).toEqual(ALL_PRIVATE_INDUSTRY)   // unmapped sector
  })

  it('exposes positive TRIR/DART rates for a mapped sector', () => {
    const b = benchmarkForNaics('236220')
    expect(b.trir).toBeGreaterThan(0)
    expect(b.dart).toBeGreaterThan(0)
    expect(b.dart).toBeLessThanOrEqual(b.trir)   // DART is a subset of recordables
  })

  it('stamps a plausible data year', () => {
    expect(BLS_DATA_YEAR).toBeGreaterThanOrEqual(2020)
  })
})
