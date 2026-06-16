import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  buildOpenMeteoUrl,
  normalizeForecast,
  snapshotFromConditions,
  type NormalizedForecast,
} from '@soteria/core/openMeteo'
import {
  buildNwsAlertsUrl,
  normalizeNwsAlerts,
  isWithinUsBounds,
  NWS_USER_AGENT,
} from '@soteria/core/nwsAlerts'
import {
  type SafetyWeatherSnapshot,
  type SevereAlertSummary,
} from '@soteria/core/safetyWeather'

// Mobile fetch layer for the Safety Weather Board. The device talks to the two
// keyless providers directly — Open-Meteo for the forecast and the US National
// Weather Service for official severe-weather alerts — and normalizes both
// through @soteria/core so web and mobile classify identical data. Each good
// result is cached in AsyncStorage so a crew in a weak-signal area still sees
// the last conditions (flagged stale) instead of an empty board.

export interface SiteWeather {
  forecast: NormalizedForecast
  snapshot: SafetyWeatherSnapshot
  alerts: SevereAlertSummary[]
  fetchedAt: string
  stale: boolean
}

// Cache key rounds the coordinate to ~2 decimals (~1 km): fine enough that a
// site keeps its own cache, coarse enough that small GPS jitter between fetches
// reuses the same entry instead of orphaning stale blobs under near-duplicate
// keys.
function cacheKey(lat: number, lon: number): string {
  return `soteria.safetyWeather.v1.${roundCoord(lat)},${roundCoord(lon)}`
}

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Fetch and normalize current weather for a site, falling back to the last good
 * cached value (with `stale: true`) when the live refresh fails. NWS alerts are
 * only requested inside US bounds and their failure never blocks the forecast.
 * Throws only when the network is down *and* there is no cache to serve.
 */
export async function fetchSiteWeather(lat: number, lon: number): Promise<SiteWeather> {
  const key = cacheKey(lat, lon)
  try {
    const forecast = await fetchForecast(lat, lon)
    const alerts = await fetchAlerts(lat, lon)
    const snapshot = snapshotFromConditions(forecast.current, alerts)
    const result: SiteWeather = {
      forecast,
      snapshot,
      alerts,
      fetchedAt: new Date().toISOString(),
      stale: false,
    }
    await AsyncStorage.setItem(key, JSON.stringify(result)).catch(() => {})
    return result
  } catch (error) {
    const cached = await readCache(key)
    if (cached) return { ...cached, stale: true }
    throw error
  }
}

async function fetchForecast(lat: number, lon: number): Promise<NormalizedForecast> {
  const res = await fetch(buildOpenMeteoUrl(lat, lon))
  if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`)
  return normalizeForecast(await res.json())
}

// NWS covers only US points and is rate-limited; treat any failure (out of
// bounds, network, non-200) as "no alerts" so it can never sink the forecast.
async function fetchAlerts(lat: number, lon: number): Promise<SevereAlertSummary[]> {
  if (!isWithinUsBounds(lat, lon)) return []
  try {
    const res = await fetch(buildNwsAlertsUrl(lat, lon), {
      headers: { 'User-Agent': NWS_USER_AGENT, Accept: 'application/geo+json' },
    })
    if (!res.ok) return []
    return normalizeNwsAlerts(await res.json())
  } catch {
    return []
  }
}

async function readCache(key: string): Promise<SiteWeather | null> {
  const raw = await AsyncStorage.getItem(key).catch(() => null)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SiteWeather
  } catch {
    return null
  }
}
