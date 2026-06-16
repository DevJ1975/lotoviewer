// Open-Meteo (https://open-meteo.com) response shapes and pure normalizers.
//
// One free, keyless forecast call covers current conditions, an hourly series,
// and a multi-day daily series. This module owns the exact request URL (so
// mobile and web build an identical request) and the array-zipping that turns
// Open-Meteo's parallel-arrays-by-variable into row objects the UI renders.
// No fetching happens here — callers pass the parsed JSON in.

import {
  heatIndexF,
  type SafetyWeatherSnapshot,
  type SevereAlertSummary,
} from './safetyWeather'

// --------------------------------------------------------------------------
// Request
// --------------------------------------------------------------------------

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

const CURRENT_FIELDS = [
  'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day',
  'precipitation', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  'uv_index', 'weather_code',
] as const

const HOURLY_FIELDS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'precipitation_probability', 'wind_speed_10m', 'wind_gusts_10m',
  'wind_direction_10m', 'uv_index', 'weather_code',
] as const

const DAILY_FIELDS = [
  'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_max',
  'uv_index_max', 'wind_speed_10m_max', 'wind_gusts_10m_max',
  'wind_direction_10m_dominant', 'precipitation_sum', 'precipitation_probability_max',
  'weather_code', 'sunrise', 'sunset',
] as const

export interface OpenMeteoRequestOptions {
  forecastDays?: number
}

/**
 * Build the Open-Meteo forecast URL for a site. Units are pinned to imperial
 * (°F, mph, inch) so every downstream classifier reads in its native units.
 */
export function buildOpenMeteoUrl(
  latitude: number,
  longitude: number,
  opts: OpenMeteoRequestOptions = {},
): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: CURRENT_FIELDS.join(','),
    hourly: HOURLY_FIELDS.join(','),
    daily: DAILY_FIELDS.join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    forecast_days: String(opts.forecastDays ?? 7),
  })
  return `${OPEN_METEO_FORECAST_URL}?${params.toString()}`
}

// --------------------------------------------------------------------------
// Raw response shape (only the fields we request)
// --------------------------------------------------------------------------

export interface OpenMeteoResponse {
  latitude?: number
  longitude?: number
  timezone?: string
  utc_offset_seconds?: number
  current?: OpenMeteoCurrent
  hourly?: OpenMeteoHourly
  daily?: OpenMeteoDaily
}

export interface OpenMeteoCurrent {
  time?: string
  temperature_2m?: number
  relative_humidity_2m?: number
  apparent_temperature?: number
  is_day?: number
  precipitation?: number
  wind_speed_10m?: number
  wind_direction_10m?: number
  wind_gusts_10m?: number
  uv_index?: number
  weather_code?: number
}

export interface OpenMeteoHourly {
  time?: string[]
  temperature_2m?: (number | null)[]
  apparent_temperature?: (number | null)[]
  relative_humidity_2m?: (number | null)[]
  precipitation_probability?: (number | null)[]
  wind_speed_10m?: (number | null)[]
  wind_gusts_10m?: (number | null)[]
  wind_direction_10m?: (number | null)[]
  uv_index?: (number | null)[]
  weather_code?: (number | null)[]
}

export interface OpenMeteoDaily {
  time?: string[]
  temperature_2m_max?: (number | null)[]
  temperature_2m_min?: (number | null)[]
  apparent_temperature_max?: (number | null)[]
  uv_index_max?: (number | null)[]
  wind_speed_10m_max?: (number | null)[]
  wind_gusts_10m_max?: (number | null)[]
  wind_direction_10m_dominant?: (number | null)[]
  precipitation_sum?: (number | null)[]
  precipitation_probability_max?: (number | null)[]
  weather_code?: (number | null)[]
  sunrise?: string[]
  sunset?: string[]
}

// --------------------------------------------------------------------------
// Normalized shapes
// --------------------------------------------------------------------------

export interface CurrentConditions {
  observed_at: string | null
  temp_f: number | null
  apparent_f: number | null
  heat_index_f: number | null
  rel_humidity_pct: number | null
  wind_mph: number | null
  gust_mph: number | null
  wind_direction_deg: number | null
  uv_index: number | null
  precip_in: number | null
  weather_code: number | null
  is_day: boolean
}

export interface HourlyForecastPoint {
  time: string
  temp_f: number | null
  apparent_f: number | null
  rel_humidity_pct: number | null
  precip_probability_pct: number | null
  wind_mph: number | null
  gust_mph: number | null
  wind_direction_deg: number | null
  uv_index: number | null
  weather_code: number | null
}

export interface DailyForecastPoint {
  date: string
  temp_max_f: number | null
  temp_min_f: number | null
  apparent_max_f: number | null
  uv_index_max: number | null
  wind_max_mph: number | null
  gust_max_mph: number | null
  wind_direction_dominant_deg: number | null
  precip_sum_in: number | null
  precip_probability_max_pct: number | null
  weather_code: number | null
  sunrise: string | null
  sunset: string | null
}

export interface NormalizedForecast {
  current: CurrentConditions
  hourly: HourlyForecastPoint[]
  daily: DailyForecastPoint[]
  /** Site UTC offset in seconds (timezone=auto). Needed to compare the
   *  offset-less local timestamps below against an absolute epoch. */
  utcOffsetSeconds: number | null
}

export function normalizeCurrentConditions(resp: OpenMeteoResponse): CurrentConditions {
  const c = resp.current ?? {}
  const temp = num(c.temperature_2m)
  const rh = num(c.relative_humidity_2m)
  return {
    observed_at: c.time ?? null,
    temp_f: temp,
    apparent_f: num(c.apparent_temperature),
    // Compute our own NWS heat index rather than trusting apparent_temperature.
    heat_index_f: heatIndexF(temp, rh),
    rel_humidity_pct: rh,
    wind_mph: num(c.wind_speed_10m),
    gust_mph: num(c.wind_gusts_10m),
    wind_direction_deg: num(c.wind_direction_10m),
    uv_index: num(c.uv_index),
    precip_in: num(c.precipitation),
    weather_code: num(c.weather_code),
    is_day: c.is_day !== 0,
  }
}

export function normalizeHourly(resp: OpenMeteoResponse): HourlyForecastPoint[] {
  const h = resp.hourly
  const times = h?.time ?? []
  return times.map((time, i) => ({
    time,
    temp_f: at(h?.temperature_2m, i),
    apparent_f: at(h?.apparent_temperature, i),
    rel_humidity_pct: at(h?.relative_humidity_2m, i),
    precip_probability_pct: at(h?.precipitation_probability, i),
    wind_mph: at(h?.wind_speed_10m, i),
    gust_mph: at(h?.wind_gusts_10m, i),
    wind_direction_deg: at(h?.wind_direction_10m, i),
    uv_index: at(h?.uv_index, i),
    weather_code: at(h?.weather_code, i),
  }))
}

export function normalizeDaily(resp: OpenMeteoResponse): DailyForecastPoint[] {
  const d = resp.daily
  const dates = d?.time ?? []
  return dates.map((date, i) => ({
    date,
    temp_max_f: at(d?.temperature_2m_max, i),
    temp_min_f: at(d?.temperature_2m_min, i),
    apparent_max_f: at(d?.apparent_temperature_max, i),
    uv_index_max: at(d?.uv_index_max, i),
    wind_max_mph: at(d?.wind_speed_10m_max, i),
    gust_max_mph: at(d?.wind_gusts_10m_max, i),
    wind_direction_dominant_deg: at(d?.wind_direction_10m_dominant, i),
    precip_sum_in: at(d?.precipitation_sum, i),
    precip_probability_max_pct: at(d?.precipitation_probability_max, i),
    weather_code: at(d?.weather_code, i),
    sunrise: d?.sunrise?.[i] ?? null,
    sunset: d?.sunset?.[i] ?? null,
  }))
}

export function normalizeForecast(resp: OpenMeteoResponse): NormalizedForecast {
  return {
    current: normalizeCurrentConditions(resp),
    hourly: normalizeHourly(resp),
    daily: normalizeDaily(resp),
    utcOffsetSeconds: num(resp.utc_offset_seconds),
  }
}

/**
 * Convert an Open-Meteo timestamp to an absolute epoch (ms). With timezone=auto
 * the API returns site wall-clock strings with no offset (e.g. "2026-06-16T13:00");
 * JS would otherwise parse those in the *device's* timezone. We treat the string
 * as the site's wall clock and subtract the site offset to recover true UTC, so a
 * "next 24h" comparison against Date.now() is correct regardless of device locale.
 * Falls back to local parsing when the offset is unknown.
 */
export function forecastTimeToEpochMs(time: string, utcOffsetSeconds: number | null): number {
  if (utcOffsetSeconds === null) return Date.parse(time)
  return Date.parse(`${time}Z`) - utcOffsetSeconds * 1000
}

/** Compose the safety snapshot the rollup consumes from current conditions + alerts. */
export function snapshotFromConditions(
  current: CurrentConditions,
  severeAlerts: SevereAlertSummary[] = [],
): SafetyWeatherSnapshot {
  return {
    observed_at: current.observed_at,
    temp_f: current.temp_f,
    rel_humidity_pct: current.rel_humidity_pct,
    heat_index_f: current.heat_index_f,
    wind_mph: current.wind_mph,
    gust_mph: current.gust_mph,
    wind_direction_deg: current.wind_direction_deg,
    uv_index: current.uv_index,
    precip_in: current.precip_in,
    severe_alerts: severeAlerts,
  }
}

// --------------------------------------------------------------------------
// WMO weather codes (https://open-meteo.com/en/docs — WMO Weather interpretation)
// --------------------------------------------------------------------------

const WEATHER_CODE_LABEL: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
}

export function weatherCodeLabel(code: number | null): string {
  if (code === null || !(code in WEATHER_CODE_LABEL)) return 'Unknown'
  return WEATHER_CODE_LABEL[code]
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function num(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function at(arr: (number | null)[] | undefined, i: number): number | null {
  const value = arr?.[i]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
