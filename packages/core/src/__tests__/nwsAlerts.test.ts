import { describe, it, expect } from 'vitest'
import {
  buildNwsAlertsUrl,
  isWithinUsBounds,
  normalizeNwsAlerts,
  type NwsAlertsResponse,
} from '../nwsAlerts'

describe('buildNwsAlertsUrl', () => {
  it('builds a point query rounded to 4 decimals', () => {
    const url = buildNwsAlertsUrl(29.7604, -95.3698)
    expect(url).toContain('/alerts/active?point=')
    expect(url).toContain('29.7604')
    expect(url).toContain('-95.3698')
  })
})

describe('isWithinUsBounds', () => {
  it('accepts US points and rejects far-flung ones', () => {
    expect(isWithinUsBounds(29.76, -95.37)).toBe(true) // Houston
    expect(isWithinUsBounds(61.2, -149.9)).toBe(true) // Anchorage
    expect(isWithinUsBounds(51.5, -0.12)).toBe(false) // London
    expect(isWithinUsBounds(-33.8, 151.2)).toBe(false) // Sydney
  })
})

describe('normalizeNwsAlerts', () => {
  const resp: NwsAlertsResponse = {
    features: [
      { properties: { event: 'High Wind Warning', severity: 'Severe', headline: 'High Wind Warning until 6 PM', expires: '2026-06-16T18:00:00Z' } },
      { properties: { event: 'Tornado Warning', severity: 'Extreme', headline: 'Tornado Warning issued', expires: '2026-06-16T13:30:00Z' } },
      { properties: { event: '', severity: 'Minor' } }, // dropped — no event
      { properties: { severity: 'Minor' } }, // dropped — no event
    ],
  }

  it('normalizes, drops eventless features, and sorts most-severe first', () => {
    const alerts = normalizeNwsAlerts(resp)
    expect(alerts).toHaveLength(2)
    expect(alerts[0].kind).toBe('tornado')
    expect(alerts[0].tone).toBe('critical')
    expect(alerts[1].kind).toBe('high_wind')
    expect(alerts[0].headline).toBe('Tornado Warning issued')
  })

  it('falls back to the event string when headline is absent', () => {
    const alerts = normalizeNwsAlerts({ features: [{ properties: { event: 'Flood Watch', severity: 'Moderate' } }] })
    expect(alerts[0].headline).toBe('Flood Watch')
  })

  it('handles an empty response', () => {
    expect(normalizeNwsAlerts({})).toEqual([])
  })
})
