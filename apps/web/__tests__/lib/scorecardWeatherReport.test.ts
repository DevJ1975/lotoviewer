import { describe, it, expect } from 'vitest'
import {
  buildWeatherRow,
  buildWeatherReport,
  formatDelta,
  type WeatherMetricInput,
} from '@soteria/core/scorecardWeatherReport'

const mk = (o: Partial<WeatherMetricInput>): WeatherMetricInput => ({
  key: 'k', label: 'L', current: 0, previous: 0, higherIsBetter: null, ...o,
})

describe('buildWeatherRow — direction', () => {
  it('flags up/down/flat correctly', () => {
    expect(buildWeatherRow(mk({ current: 5, previous: 3 })).direction).toBe('up')
    expect(buildWeatherRow(mk({ current: 2, previous: 7 })).direction).toBe('down')
    expect(buildWeatherRow(mk({ current: 4, previous: 4 })).direction).toBe('flat')
  })
})

describe('buildWeatherRow — tone (good/bad/neutral)', () => {
  it('lower-is-better metric going down is good', () => {
    expect(buildWeatherRow(mk({ current: 1, previous: 4, higherIsBetter: false })).tone).toBe('good')
  })
  it('lower-is-better metric going up is bad', () => {
    expect(buildWeatherRow(mk({ current: 6, previous: 2, higherIsBetter: false })).tone).toBe('bad')
  })
  it('higher-is-better metric going up is good', () => {
    expect(buildWeatherRow(mk({ current: 9, previous: 5, higherIsBetter: true })).tone).toBe('good')
  })
  it('neutral metric is always neutral', () => {
    expect(buildWeatherRow(mk({ current: 9, previous: 5, higherIsBetter: null })).tone).toBe('neutral')
  })
  it('flat is always neutral regardless of polarity', () => {
    expect(buildWeatherRow(mk({ current: 4, previous: 4, higherIsBetter: false })).tone).toBe('neutral')
  })
})

describe('buildWeatherRow — significance gate', () => {
  it('does not color a within-noise ±1 move (stays neutral)', () => {
    const row = buildWeatherRow(mk({ current: 6, previous: 5, higherIsBetter: false }))
    expect(row.significant).toBe(false)
    expect(row.tone).toBe('neutral') // +1 on a base of 5 is noise, not "bad"
  })
  it('colors a move that clears ~1 Poisson standard deviation', () => {
    const row = buildWeatherRow(mk({ current: 10, previous: 4, higherIsBetter: false }))
    expect(row.significant).toBe(true)
    expect(row.tone).toBe('bad')
  })
})

describe('buildWeatherRow — deltaPct baseline', () => {
  it('computes percent vs last week', () => {
    expect(buildWeatherRow(mk({ current: 12, previous: 10 })).deltaPct).toBe(20)
  })
  it('is null when last week was zero (no baseline)', () => {
    expect(buildWeatherRow(mk({ current: 3, previous: 0 })).deltaPct).toBeNull()
  })
})

describe('formatDelta', () => {
  it('renders arrows + percent, and a dash for flat', () => {
    expect(formatDelta(buildWeatherRow(mk({ current: 12, previous: 10 })))).toBe('↑ 2 (+20%)')
    expect(formatDelta(buildWeatherRow(mk({ current: 8, previous: 10 })))).toBe('↓ 2 (-20%)')
    expect(formatDelta(buildWeatherRow(mk({ current: 5, previous: 5 })))).toBe('—')
    expect(formatDelta(buildWeatherRow(mk({ current: 3, previous: 0 })))).toBe('↑ 3')
  })
})

describe('buildWeatherReport', () => {
  it('maps a list of inputs to rows', () => {
    const rows = buildWeatherReport([
      mk({ key: 'recordables', current: 1, previous: 3, higherIsBetter: false }),
      mk({ key: 'permits', current: 20, previous: 18, higherIsBetter: null }),
    ])
    expect(rows.map(r => r.key)).toEqual(['recordables', 'permits'])
    expect(rows[0]!.tone).toBe('good')
    expect(rows[1]!.tone).toBe('neutral')
  })
})
