import { describe, it, expect } from 'vitest'
import {
  craneWindStatus,
  scaffoldWindStatus,
  heatIndexF,
  heatIndexCategory,
  heatCategoryTone,
  uvCategory,
  uvCategoryTone,
  classifySevereAlert,
  windDirectionLabel,
  rollupWeatherConditions,
  resolveSafetyWeatherConfig,
  validateWeatherReadingInput,
  compareReadingToForecast,
  weatherTonePriority,
  DEFAULT_SAFETY_WEATHER_CONFIG,
  type SafetyWeatherSnapshot,
} from '../safetyWeather'

const emptySnapshot: SafetyWeatherSnapshot = {
  observed_at: '2026-06-16T12:00:00Z',
  temp_f: null,
  rel_humidity_pct: null,
  heat_index_f: null,
  wind_mph: null,
  gust_mph: null,
  wind_direction_deg: null,
  uv_index: null,
  precip_in: null,
  severe_alerts: [],
}

describe('craneWindStatus', () => {
  it('classifies at the default boundaries (caution 20, shutdown 28), gust-governed', () => {
    expect(craneWindStatus(10, null).status).toBe('ok')
    expect(craneWindStatus(19, null).status).toBe('ok')
    expect(craneWindStatus(20, null).status).toBe('caution')
    expect(craneWindStatus(27, null).status).toBe('caution')
    expect(craneWindStatus(28, null).status).toBe('shutdown')
    // Gust governs even when sustained wind is calm.
    expect(craneWindStatus(12, 30).status).toBe('shutdown')
    expect(craneWindStatus(12, 30).governingMph).toBe(30)
  })

  it('maps tone: caution→warning, shutdown→critical, ok→null', () => {
    expect(craneWindStatus(10, null).tone).toBeNull()
    expect(craneWindStatus(22, null).tone).toBe('warning')
    expect(craneWindStatus(35, null).tone).toBe('critical')
  })

  it('returns unknown with no data', () => {
    expect(craneWindStatus(null, null).status).toBe('unknown')
    expect(craneWindStatus(null, null).tone).toBeNull()
    expect(craneWindStatus(null, null).governingMph).toBeNull()
  })

  it('honors use_gust_for_classification=false', () => {
    const cfg = { ...DEFAULT_SAFETY_WEATHER_CONFIG.wind, use_gust_for_classification: false }
    expect(craneWindStatus(12, 30, cfg).status).toBe('ok')
    expect(craneWindStatus(12, 30, cfg).governingMph).toBe(12)
  })
})

describe('scaffoldWindStatus', () => {
  it('classifies at the default boundaries (erect-stop 25, work-stop 40)', () => {
    expect(scaffoldWindStatus(24, null).status).toBe('ok')
    expect(scaffoldWindStatus(25, null).status).toBe('erect_dismantle_stop')
    expect(scaffoldWindStatus(39, null).status).toBe('erect_dismantle_stop')
    expect(scaffoldWindStatus(40, null).status).toBe('work_stop')
  })

  it('maps tone: erect-stop→warning, work-stop→critical', () => {
    expect(scaffoldWindStatus(30, null).tone).toBe('warning')
    expect(scaffoldWindStatus(45, null).tone).toBe('critical')
    expect(scaffoldWindStatus(10, null).tone).toBeNull()
  })
})

describe('heatIndexF', () => {
  it('returns null when an input is missing', () => {
    expect(heatIndexF(null, 50)).toBeNull()
    expect(heatIndexF(90, null)).toBeNull()
  })

  it('uses the simple formula below 80°F', () => {
    const hi = heatIndexF(75, 40)
    expect(hi).not.toBeNull()
    expect(hi as number).toBeGreaterThan(70)
    expect(hi as number).toBeLessThan(80)
  })

  it('matches the NWS chart for hot/humid conditions', () => {
    // NWS heat-index chart: ~90°F at 70% RH ≈ 105–106°F.
    const hi = heatIndexF(90, 70) as number
    expect(hi).toBeGreaterThan(104)
    expect(hi).toBeLessThan(108)
    // 100°F at 55% RH ≈ 124°F.
    const hot = heatIndexF(100, 55) as number
    expect(hot).toBeGreaterThan(120)
    expect(hot).toBeLessThan(128)
  })
})

describe('heatIndexCategory + tone', () => {
  it('classifies at NWS category floors', () => {
    expect(heatIndexCategory(79)).toBe('safe')
    expect(heatIndexCategory(80)).toBe('caution')
    expect(heatIndexCategory(90)).toBe('extreme_caution')
    expect(heatIndexCategory(103)).toBe('danger')
    expect(heatIndexCategory(125)).toBe('extreme_danger')
    expect(heatIndexCategory(null)).toBe('unknown')
  })

  it('maps tone with danger and above critical', () => {
    expect(heatCategoryTone('safe')).toBeNull()
    expect(heatCategoryTone('caution')).toBe('attention')
    expect(heatCategoryTone('extreme_caution')).toBe('warning')
    expect(heatCategoryTone('danger')).toBe('critical')
    expect(heatCategoryTone('extreme_danger')).toBe('critical')
  })
})

describe('uvCategory + tone', () => {
  it('classifies at WHO floors', () => {
    expect(uvCategory(2)).toBe('low')
    expect(uvCategory(3)).toBe('moderate')
    expect(uvCategory(6)).toBe('high')
    expect(uvCategory(8)).toBe('very_high')
    expect(uvCategory(11)).toBe('extreme')
    expect(uvCategory(null)).toBe('unknown')
  })

  it('maps tone with extreme critical', () => {
    expect(uvCategoryTone('low')).toBeNull()
    expect(uvCategoryTone('moderate')).toBeNull()
    expect(uvCategoryTone('high')).toBe('attention')
    expect(uvCategoryTone('very_high')).toBe('warning')
    expect(uvCategoryTone('extreme')).toBe('critical')
  })
})

describe('classifySevereAlert', () => {
  it('escalates tornado warnings to critical regardless of severity', () => {
    expect(classifySevereAlert('Tornado Warning', 'Severe')).toEqual({ kind: 'tornado', tone: 'critical' })
    expect(classifySevereAlert('Tornado Watch', 'Moderate')).toEqual({ kind: 'tornado', tone: 'attention' })
  })

  it('classifies common NWS events', () => {
    expect(classifySevereAlert('Severe Thunderstorm Warning', 'Severe').kind).toBe('severe_thunderstorm')
    expect(classifySevereAlert('High Wind Warning', 'Severe').kind).toBe('high_wind')
    expect(classifySevereAlert('Flood Watch', 'Moderate').kind).toBe('flood')
    expect(classifySevereAlert('Excessive Heat Warning', 'Extreme').kind).toBe('heat')
    expect(classifySevereAlert('Winter Storm Warning', 'Severe').kind).toBe('winter')
    expect(classifySevereAlert('Air Quality Alert', 'Minor').kind).toBe('other')
  })

  it('classifies cold-exposure "Wind Chill" events as winter, not high_wind', () => {
    // "Wind Chill Warning/Advisory" contain "wind" but are cold hazards.
    expect(classifySevereAlert('Wind Chill Warning', 'Severe').kind).toBe('winter')
    expect(classifySevereAlert('Wind Chill Advisory', 'Moderate').kind).toBe('winter')
    expect(classifySevereAlert('Extreme Cold Warning', 'Extreme').kind).toBe('winter')
    // Regression: a real high-wind event still classifies as high_wind.
    expect(classifySevereAlert('High Wind Warning', 'Severe').kind).toBe('high_wind')
  })

  it('derives tone from severity for non-storm events', () => {
    expect(classifySevereAlert('Excessive Heat Warning', 'Extreme').tone).toBe('critical')
    expect(classifySevereAlert('High Wind Warning', 'Severe').tone).toBe('warning')
    expect(classifySevereAlert('Flood Watch', 'Moderate').tone).toBe('attention')
  })
})

describe('windDirectionLabel', () => {
  it('maps degrees to 16-point compass', () => {
    expect(windDirectionLabel(0)).toBe('N')
    expect(windDirectionLabel(360)).toBe('N')
    expect(windDirectionLabel(90)).toBe('E')
    expect(windDirectionLabel(180)).toBe('S')
    expect(windDirectionLabel(270)).toBe('W')
    expect(windDirectionLabel(45)).toBe('NE')
    expect(windDirectionLabel(-90)).toBe('W')
    expect(windDirectionLabel(null)).toBeNull()
  })
})

describe('rollupWeatherConditions', () => {
  it('reports none when all conditions are within limits', () => {
    const r = rollupWeatherConditions({ ...emptySnapshot, wind_mph: 5, temp_f: 70, rel_humidity_pct: 40, uv_index: 1 })
    expect(r.tone).toBe('none')
    expect(r.priority).toBe(0)
    expect(r.contributors).toHaveLength(0)
  })

  it('selects the worst contributor as the headline tone', () => {
    const r = rollupWeatherConditions({
      ...emptySnapshot,
      wind_mph: 22, // crane caution → warning
      gust_mph: 22,
      uv_index: 9, // very high → warning
      severe_alerts: [{ kind: 'tornado', tone: 'critical', event: 'Tornado Warning', headline: 'Tornado Warning', expires: null }],
    })
    expect(r.tone).toBe('critical')
    expect(r.priority).toBe(90)
    expect(r.contributors[0].domain).toBe('severe')
    // every contributing condition is listed
    expect(r.contributors.map(c => c.domain)).toContain('crane')
    expect(r.contributors.map(c => c.domain)).toContain('uv')
  })

  it('derives heat index from temp + humidity when not precomputed', () => {
    const r = rollupWeatherConditions({ ...emptySnapshot, temp_f: 100, rel_humidity_pct: 60 })
    const heat = r.contributors.find(c => c.domain === 'heat')
    expect(heat).toBeDefined()
    expect(heat?.tone).toBe('critical')
  })
})

describe('resolveSafetyWeatherConfig', () => {
  it('returns defaults when no override given', () => {
    expect(resolveSafetyWeatherConfig()).toEqual(DEFAULT_SAFETY_WEATHER_CONFIG)
    expect(resolveSafetyWeatherConfig(null)).toEqual(DEFAULT_SAFETY_WEATHER_CONFIG)
  })

  it('shallow-merges per sub-object', () => {
    const cfg = resolveSafetyWeatherConfig({ wind: { crane_shutdown_mph: 35 } })
    expect(cfg.wind.crane_shutdown_mph).toBe(35)
    expect(cfg.wind.crane_caution_mph).toBe(20) // untouched default
    expect(cfg.heat).toEqual(DEFAULT_SAFETY_WEATHER_CONFIG.heat)
  })

  it('lets a site lower its crane shutdown threshold', () => {
    const cfg = resolveSafetyWeatherConfig({ wind: { crane_shutdown_mph: 22 } })
    expect(craneWindStatus(24, null, cfg.wind).status).toBe('shutdown')
  })
})

describe('validateWeatherReadingInput', () => {
  it('requires a measured wind speed', () => {
    expect(validateWeatherReadingInput({})).toMatch(/measured_wind_mph/)
    expect(validateWeatherReadingInput({ measured_wind_mph: 12 })).toBeNull()
  })

  it('rejects out-of-range and inconsistent values', () => {
    expect(validateWeatherReadingInput({ measured_wind_mph: -1 })).toMatch(/measured_wind_mph/)
    expect(validateWeatherReadingInput({ measured_wind_mph: 999 })).toMatch(/measured_wind_mph/)
    expect(validateWeatherReadingInput({ measured_wind_mph: 20, measured_gust_mph: 10 })).toMatch(/cannot be less/)
    expect(validateWeatherReadingInput({ measured_wind_mph: 10, unit_system: 'furlongs' as never })).toMatch(/unit_system/)
    expect(validateWeatherReadingInput({ measured_wind_mph: 10, latitude: 200 })).toMatch(/latitude/)
    expect(validateWeatherReadingInput({ measured_wind_mph: 10, forecast_fetched_at: 'not-a-date' })).toMatch(/ISO/)
  })

  it('accepts a complete valid reading', () => {
    expect(validateWeatherReadingInput({
      measured_wind_mph: 18, measured_gust_mph: 26, unit_system: 'imperial',
      instrument: 'Kestrel 3000', latitude: 29.76, longitude: -95.37,
      forecast_wind_mph: 12, forecast_fetched_at: '2026-06-16T12:00:00Z', note: 'gusty on the deck',
    })).toBeNull()
  })
})

describe('compareReadingToForecast', () => {
  it('computes the delta and flags exceedance', () => {
    const d = compareReadingToForecast({ measured_wind_mph: 32, measured_gust_mph: 38, forecast_wind_mph: 18, forecast_gust_mph: 24 })
    expect(d.deltaMph).toBe(14)
    expect(d.exceedsForecast).toBe(true)
    expect(d.measuredScaffold.status).toBe('erect_dismantle_stop')
    expect(d.measuredCrane.status).toBe('shutdown')
  })

  it('handles a missing forecast', () => {
    const d = compareReadingToForecast({ measured_wind_mph: 15, measured_gust_mph: null, forecast_wind_mph: null, forecast_gust_mph: null })
    expect(d.forecastMph).toBeNull()
    expect(d.deltaMph).toBeNull()
    expect(d.exceedsForecast).toBe(false)
  })
})

describe('weatherTonePriority', () => {
  it('orders critical > warning > attention', () => {
    expect(weatherTonePriority('critical')).toBeGreaterThan(weatherTonePriority('warning'))
    expect(weatherTonePriority('warning')).toBeGreaterThan(weatherTonePriority('attention'))
  })
})
