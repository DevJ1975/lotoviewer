// US National Weather Service (api.weather.gov) active-alerts shapes and pure
// normalizers. NWS is the authoritative source for tornado / severe-storm /
// high-wind / flood / heat watches and warnings — Open-Meteo does not carry
// official government alerts, so a safety product must pull them separately.
//
// US-only by design (crews in scope are US-based); callers gate on a rough US
// bounding box and degrade gracefully outside it. No fetching here.

import {
  classifySevereAlert,
  weatherTonePriority,
  type SevereAlertSummary,
} from './safetyWeather'

const NWS_ACTIVE_ALERTS_URL = 'https://api.weather.gov/alerts/active'

/**
 * Build the NWS active-alerts-by-point URL. The point form returns only alerts
 * whose polygon/zone covers the site, which is exactly what a single site needs.
 */
export function buildNwsAlertsUrl(latitude: number, longitude: number): string {
  const point = `${roundCoord(latitude)},${roundCoord(longitude)}`
  return `${NWS_ACTIVE_ALERTS_URL}?point=${encodeURIComponent(point)}`
}

/**
 * Descriptive User-Agent NWS asks every client to send (their documented
 * etiquette). Pass when fetching from a context that can set the header
 * (React Native, or a server route — not a browser).
 */
export const NWS_USER_AGENT = 'SoteriaField/1.0 (jamil@trainovations.com)'

/** Rough continental-US + AK/HI bounding box; outside it NWS has no coverage. */
export function isWithinUsBounds(latitude: number, longitude: number): boolean {
  return latitude >= 18 && latitude <= 72 && longitude >= -180 && longitude <= -66
}

export interface NwsAlertFeature {
  properties?: {
    event?: string | null
    severity?: string | null
    certainty?: string | null
    urgency?: string | null
    headline?: string | null
    description?: string | null
    instruction?: string | null
    onset?: string | null
    expires?: string | null
    ends?: string | null
  }
}

export interface NwsAlertsResponse {
  features?: NwsAlertFeature[]
}

/**
 * Normalize NWS GeoJSON features to our severe-alert shape, classifying each
 * event string into a kind + tone and sorting most-severe first. Features
 * without an `event` are dropped (nothing actionable to show).
 */
export function normalizeNwsAlerts(resp: NwsAlertsResponse): SevereAlertSummary[] {
  const features = resp.features ?? []
  const summaries: SevereAlertSummary[] = []

  for (const feature of features) {
    const props = feature.properties
    const event = props?.event?.trim()
    if (!event) continue

    const { kind, tone } = classifySevereAlert(event, props?.severity ?? null)
    summaries.push({
      kind,
      tone,
      event,
      headline: props?.headline?.trim() || event,
      expires: props?.expires ?? props?.ends ?? null,
    })
  }

  summaries.sort((a, b) => weatherTonePriority(b.tone) - weatherTonePriority(a.tone))
  return summaries
}

// NWS points endpoint accepts at most 4 decimal places; trim to stay valid.
function roundCoord(value: number): number {
  return Math.round(value * 10000) / 10000
}
