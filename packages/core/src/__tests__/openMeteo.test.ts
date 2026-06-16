import { describe, it, expect } from 'vitest'
import {
  buildOpenMeteoUrl,
  normalizeCurrentConditions,
  normalizeHourly,
  normalizeDaily,
  normalizeForecast,
  snapshotFromConditions,
  forecastTimeToEpochMs,
  weatherCodeLabel,
  type OpenMeteoResponse,
} from '../openMeteo'

const sample: OpenMeteoResponse = {
  latitude: 29.76,
  longitude: -95.37,
  timezone: 'America/Chicago',
  current: {
    time: '2026-06-16T12:00',
    temperature_2m: 95,
    relative_humidity_2m: 65,
    apparent_temperature: 108,
    is_day: 1,
    precipitation: 0,
    wind_speed_10m: 18,
    wind_direction_10m: 200,
    wind_gusts_10m: 31,
    uv_index: 9,
    weather_code: 2,
  },
  hourly: {
    time: ['2026-06-16T12:00', '2026-06-16T13:00'],
    temperature_2m: [95, 96],
    apparent_temperature: [108, 110],
    relative_humidity_2m: [65, 63],
    precipitation_probability: [10, 20],
    wind_speed_10m: [18, 20],
    wind_gusts_10m: [31, 33],
    wind_direction_10m: [200, 210],
    uv_index: [9, 10],
    weather_code: [2, 3],
  },
  daily: {
    time: ['2026-06-16', '2026-06-17'],
    temperature_2m_max: [97, 98],
    temperature_2m_min: [78, 79],
    apparent_temperature_max: [111, 113],
    uv_index_max: [9, 10],
    wind_speed_10m_max: [22, 24],
    wind_gusts_10m_max: [34, 36],
    wind_direction_10m_dominant: [200, 205],
    precipitation_sum: [0, 0.1],
    precipitation_probability_max: [20, 40],
    weather_code: [2, 95],
    sunrise: ['2026-06-16T06:20', '2026-06-17T06:20'],
    sunset: ['2026-06-16T20:25', '2026-06-17T20:26'],
  },
}

describe('buildOpenMeteoUrl', () => {
  it('pins imperial units and a 7-day window', () => {
    const url = buildOpenMeteoUrl(29.76, -95.37)
    expect(url).toContain('temperature_unit=fahrenheit')
    expect(url).toContain('wind_speed_unit=mph')
    expect(url).toContain('forecast_days=7')
    expect(url).toContain('latitude=29.76')
    expect(url).toContain('uv_index')
  })

  it('respects a custom forecast window', () => {
    expect(buildOpenMeteoUrl(1, 2, { forecastDays: 3 })).toContain('forecast_days=3')
  })
})

describe('normalizeCurrentConditions', () => {
  it('maps fields and computes its own heat index', () => {
    const c = normalizeCurrentConditions(sample)
    expect(c.temp_f).toBe(95)
    expect(c.wind_mph).toBe(18)
    expect(c.gust_mph).toBe(31)
    expect(c.wind_direction_deg).toBe(200)
    expect(c.uv_index).toBe(9)
    expect(c.is_day).toBe(true)
    // Heat index is recomputed (NWS), not copied from apparent_temperature.
    expect(c.heat_index_f).not.toBeNull()
    expect(c.heat_index_f as number).toBeGreaterThan(100)
  })

  it('null-fills a missing current block', () => {
    const c = normalizeCurrentConditions({})
    expect(c.temp_f).toBeNull()
    expect(c.heat_index_f).toBeNull()
    expect(c.is_day).toBe(true) // is_day !== 0 → undefined treated as day
  })
})

describe('normalizeHourly / normalizeDaily', () => {
  it('zips parallel arrays into points', () => {
    const hourly = normalizeHourly(sample)
    expect(hourly).toHaveLength(2)
    expect(hourly[1]).toMatchObject({ time: '2026-06-16T13:00', temp_f: 96, gust_mph: 33, wind_direction_deg: 210 })

    const daily = normalizeDaily(sample)
    expect(daily).toHaveLength(2)
    expect(daily[0]).toMatchObject({ date: '2026-06-16', temp_max_f: 97, wind_max_mph: 22 })
    expect(daily[1].weather_code).toBe(95)
  })

  it('returns empty arrays when blocks are absent', () => {
    expect(normalizeHourly({})).toEqual([])
    expect(normalizeDaily({})).toEqual([])
  })
})

describe('snapshotFromConditions', () => {
  it('builds a rollup-ready snapshot and carries alerts through', () => {
    const snap = snapshotFromConditions(normalizeCurrentConditions(sample), [
      { kind: 'tornado', tone: 'critical', event: 'Tornado Warning', headline: 'Tornado Warning', expires: null },
    ])
    expect(snap.wind_mph).toBe(18)
    expect(snap.gust_mph).toBe(31)
    expect(snap.severe_alerts).toHaveLength(1)
  })
})

describe('forecastTimeToEpochMs', () => {
  it('treats offset-less times as site-local wall clock', () => {
    // 13:00 at a −5h site is 18:00 UTC.
    const epoch = forecastTimeToEpochMs('2026-06-16T13:00', -5 * 3600)
    expect(epoch).toBe(Date.parse('2026-06-16T18:00:00Z'))
  })

  it('falls back to local parsing when offset is unknown', () => {
    expect(forecastTimeToEpochMs('2026-06-16T13:00', null)).toBe(Date.parse('2026-06-16T13:00'))
  })

  it('normalizeForecast surfaces the site offset', () => {
    expect(normalizeForecast({ ...sample, utc_offset_seconds: -18000 }).utcOffsetSeconds).toBe(-18000)
    expect(normalizeForecast(sample).utcOffsetSeconds).toBeNull()
  })
})

describe('weatherCodeLabel', () => {
  it('labels known WMO codes and falls back to Unknown', () => {
    expect(weatherCodeLabel(0)).toBe('Clear sky')
    expect(weatherCodeLabel(95)).toBe('Thunderstorm')
    expect(weatherCodeLabel(404)).toBe('Unknown')
    expect(weatherCodeLabel(null)).toBe('Unknown')
  })
})
