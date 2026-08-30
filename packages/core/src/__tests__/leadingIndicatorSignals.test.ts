import { describe, it, expect } from 'vitest'
import { discoverLeadingSignals, type LeadingSignalSeries } from '../leadingIndicatorSignals'

// Recordables that lag an indicator by exactly 2 months: recordables[i+2] = i.
// (14 months of history.)
const RECORDABLES = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

describe('discoverLeadingSignals', () => {
  it('finds the lag at which an indicator best precedes recordables', () => {
    // Non-monotonic pattern so only the TRUE lag aligns perfectly (a shifted
    // straight line correlates at every lag, which wouldn't isolate the lag).
    const pattern = [2, 5, 1, 8, 3, 7, 2, 9, 4, 6, 1, 8, 5, 3]
    const recs = [0, 0, ...pattern.slice(0, 12)] // recs[i] = pattern[i-2]
    const leads2: LeadingSignalSeries = { key: 'x', label: 'X', monthly: pattern }
    const [sig] = discoverLeadingSignals([leads2], recs)
    expect(sig.bestLag).toBe(2)
    expect(sig.r).toBeCloseTo(1, 6)
    expect(sig.direction).toBe('predicts_more')
    expect(sig.reliable).toBe(true)
    expect(sig.nMonths).toBe(12)
  })

  it('labels an inverse (protective) leader as predicting fewer recordables', () => {
    const protective: LeadingSignalSeries = {
      key: 'nm', label: 'Near-miss reporting',
      monthly: [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], // falls as recordables rise
    }
    const [sig] = discoverLeadingSignals([protective], RECORDABLES)
    expect(sig.r).toBeLessThan(0)
    expect(sig.direction).toBe('predicts_fewer')
  })

  it('marks a signal unreliable when history is too short but still correlatable', () => {
    // overlap ≥ 3 (so not dropped) but < minMonths → present, not reliable.
    const short: LeadingSignalSeries = { key: 's', label: 'S', monthly: [1, 2, 3, 4] }
    const [sig] = discoverLeadingSignals([short], [1, 2, 3, 4], { minMonths: 12 })
    expect(sig.reliable).toBe(false)
  })

  it('drops a series with too little overlap to correlate at any lag', () => {
    const tiny: LeadingSignalSeries = { key: 't', label: 'T', monthly: [1, 2] }
    expect(discoverLeadingSignals([tiny], [1, 2])).toHaveLength(0)
  })

  it('ranks reliable signals ahead of unreliable ones', () => {
    const strong: LeadingSignalSeries = { key: 'strong', label: 'strong', monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] }
    const weak: LeadingSignalSeries = { key: 'weak', label: 'weak', monthly: [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7] }
    const out = discoverLeadingSignals([weak, strong], RECORDABLES)
    expect(out[0].key).toBe('strong') // reliable, strong |r| ranks first
  })
})
