// Safety Weather Board — threshold logic for outdoor crew operations.
//
// Pure, cross-platform classification of live weather against the conditions
// that govern field safety: wind limits for crane lifts and scaffold work,
// heat-index categories, UV exposure, and official severe-weather alerts.
//
// Every classifier is deterministic and null-safe (mirrors the
// `containerAgeStatus()` style in ./hazardousWaste). The alert tone vocabulary
// and tone→priority ladder match ./incidentSafetyAlerts so weather conditions
// can flow into the same Command Center alert model later.

// --------------------------------------------------------------------------
// Tones (shared vocabulary with incidentSafetyAlerts)
// --------------------------------------------------------------------------

export type WeatherAlertTone = 'critical' | 'warning' | 'attention'

/** Tone → numeric priority, matching alertPriorityForTone() in incidentSafetyAlerts. */
export function weatherTonePriority(tone: WeatherAlertTone): number {
  if (tone === 'critical') return 90
  if (tone === 'warning') return 60
  return 30
}

// --------------------------------------------------------------------------
// Units
// --------------------------------------------------------------------------

export type WeatherUnitSystem = 'imperial' | 'metric'
export const WEATHER_UNIT_SYSTEMS: readonly WeatherUnitSystem[] = ['imperial', 'metric'] as const

// All classifiers below operate in imperial units (mph, °F): the fetch layer
// normalizes provider data to imperial so the safety thresholds — which are
// authored from US OSHA/ANSI guidance — read in their native units.

// --------------------------------------------------------------------------
// Wind safety — crane & scaffolding
// --------------------------------------------------------------------------

export type CraneWindStatus = 'unknown' | 'ok' | 'caution' | 'shutdown'
export type ScaffoldWindStatus = 'unknown' | 'ok' | 'erect_dismantle_stop' | 'work_stop'

export interface WindSafetyThresholds {
  /** Heightened-awareness wind for lifts (ASME B30 guidance varies by rig). */
  crane_caution_mph: number
  /** Manufacturer out-of-service wind for most mobile cranes (~28–30 mph). */
  crane_shutdown_mph: number
  /** Stop erecting / dismantling / altering scaffolds at/above this wind. */
  scaffold_erect_stop_mph: number
  /** Stop work on the scaffold entirely at/above this wind (OSHA storms/winds). */
  scaffold_work_stop_mph: number
  /** Classify on gusts (the conservative, lift-governing choice) when present. */
  use_gust_for_classification: boolean
}

export interface HeatThresholds {
  /** NWS heat-index °F category floors. */
  caution_f: number
  extreme_caution_f: number
  danger_f: number
  extreme_danger_f: number
}

export interface UvThresholds {
  /** WHO UV-index category floors. */
  moderate: number
  high: number
  very_high: number
  extreme: number
}

export interface SafetyWeatherConfig {
  wind: WindSafetyThresholds
  heat: HeatThresholds
  uv: UvThresholds
}

export const DEFAULT_SAFETY_WEATHER_CONFIG: SafetyWeatherConfig = {
  wind: {
    crane_caution_mph: 20,
    crane_shutdown_mph: 28,
    scaffold_erect_stop_mph: 25,
    scaffold_work_stop_mph: 40,
    use_gust_for_classification: true,
  },
  // NWS heat-index chart: Caution 80–90, Extreme Caution 90–103,
  // Danger 103–125, Extreme Danger 125+.
  heat: { caution_f: 80, extreme_caution_f: 90, danger_f: 103, extreme_danger_f: 125 },
  // WHO UV index: Low <3, Moderate 3–5, High 6–7, Very High 8–10, Extreme 11+.
  uv: { moderate: 3, high: 6, very_high: 8, extreme: 11 },
}

/** Partial per-tenant/site override, persisted in `safety_weather_settings.config`. */
export interface PartialSafetyWeatherConfig {
  wind?: Partial<WindSafetyThresholds>
  heat?: Partial<HeatThresholds>
  uv?: Partial<UvThresholds>
}

/** Merge a stored override over the defaults (shallow, per sub-object). */
export function resolveSafetyWeatherConfig(
  override?: PartialSafetyWeatherConfig | null,
): SafetyWeatherConfig {
  if (!override) return DEFAULT_SAFETY_WEATHER_CONFIG
  return {
    wind: { ...DEFAULT_SAFETY_WEATHER_CONFIG.wind, ...(override.wind ?? {}) },
    heat: { ...DEFAULT_SAFETY_WEATHER_CONFIG.heat, ...(override.heat ?? {}) },
    uv: { ...DEFAULT_SAFETY_WEATHER_CONFIG.uv, ...(override.uv ?? {}) },
  }
}

export interface WindClassification<Status> {
  status: Status
  /** The wind value the status was decided on (the governing gust or sustained wind). */
  governingMph: number | null
  tone: WeatherAlertTone | null
}

/**
 * The wind value a safety decision is made against. Gusts govern lifts, so when
 * configured we classify on the larger of gust/sustained; otherwise sustained
 * wind, falling back to gust if that's all we have.
 */
function governingWind(
  windMph: number | null,
  gustMph: number | null,
  cfg: WindSafetyThresholds,
): number | null {
  const wind = isFiniteNumber(windMph) ? windMph : null
  const gust = isFiniteNumber(gustMph) ? gustMph : null
  if (cfg.use_gust_for_classification) {
    if (gust !== null && wind !== null) return Math.max(gust, wind)
    return gust ?? wind
  }
  return wind ?? gust
}

export function craneWindStatus(
  windMph: number | null,
  gustMph: number | null,
  cfg: WindSafetyThresholds = DEFAULT_SAFETY_WEATHER_CONFIG.wind,
): WindClassification<CraneWindStatus> {
  const governing = governingWind(windMph, gustMph, cfg)
  if (governing === null) return { status: 'unknown', governingMph: null, tone: null }
  if (governing >= cfg.crane_shutdown_mph) return { status: 'shutdown', governingMph: governing, tone: 'critical' }
  if (governing >= cfg.crane_caution_mph) return { status: 'caution', governingMph: governing, tone: 'warning' }
  return { status: 'ok', governingMph: governing, tone: null }
}

export function scaffoldWindStatus(
  windMph: number | null,
  gustMph: number | null,
  cfg: WindSafetyThresholds = DEFAULT_SAFETY_WEATHER_CONFIG.wind,
): WindClassification<ScaffoldWindStatus> {
  const governing = governingWind(windMph, gustMph, cfg)
  if (governing === null) return { status: 'unknown', governingMph: null, tone: null }
  if (governing >= cfg.scaffold_work_stop_mph) return { status: 'work_stop', governingMph: governing, tone: 'critical' }
  if (governing >= cfg.scaffold_erect_stop_mph) return { status: 'erect_dismantle_stop', governingMph: governing, tone: 'warning' }
  return { status: 'ok', governingMph: governing, tone: null }
}

export const CRANE_WIND_STATUS_LABEL: Record<CraneWindStatus, string> = {
  unknown: 'No wind data',
  ok: 'Within crane limits',
  caution: 'Crane caution — heightened awareness',
  shutdown: 'Crane shutdown — winds at or above out-of-service limit',
}

export const SCAFFOLD_WIND_STATUS_LABEL: Record<ScaffoldWindStatus, string> = {
  unknown: 'No wind data',
  ok: 'Within scaffold limits',
  erect_dismantle_stop: 'Stop erecting / dismantling / altering scaffolds',
  work_stop: 'Stop scaffold work — winds at or above the work-stop limit',
}

// --------------------------------------------------------------------------
// Heat index (NWS Rothfusz regression)
// --------------------------------------------------------------------------

export type HeatIndexCategory =
  | 'unknown'
  | 'safe'
  | 'caution'
  | 'extreme_caution'
  | 'danger'
  | 'extreme_danger'

/**
 * NWS heat index in °F from air temperature (°F) and relative humidity (%).
 * Uses the Steadman simple formula and, when its average with temperature
 * reaches 80°F, the full Rothfusz regression with the low/high-humidity
 * adjustments — the algorithm published by the NWS Weather Prediction Center.
 */
export function heatIndexF(tempF: number | null, relHumidityPct: number | null): number | null {
  if (!isFiniteNumber(tempF) || !isFiniteNumber(relHumidityPct)) return null
  const T = tempF
  const R = clamp(relHumidityPct, 0, 100)

  const simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + R * 0.094)
  if ((simple + T) / 2 < 80) return round1(simple)

  let hi =
    -42.379 +
    2.04901523 * T +
    10.14333127 * R -
    0.22475541 * T * R -
    0.00683783 * T * T -
    0.05481717 * R * R +
    0.00122874 * T * T * R +
    0.00085282 * T * R * R -
    0.00000199 * T * T * R * R

  if (R < 13 && T >= 80 && T <= 112) {
    hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17)
  } else if (R > 85 && T >= 80 && T <= 87) {
    hi += ((R - 85) / 10) * ((87 - T) / 5)
  }
  return round1(hi)
}

export function heatIndexCategory(
  heatIdxF: number | null,
  cfg: HeatThresholds = DEFAULT_SAFETY_WEATHER_CONFIG.heat,
): HeatIndexCategory {
  if (!isFiniteNumber(heatIdxF)) return 'unknown'
  if (heatIdxF >= cfg.extreme_danger_f) return 'extreme_danger'
  if (heatIdxF >= cfg.danger_f) return 'danger'
  if (heatIdxF >= cfg.extreme_caution_f) return 'extreme_caution'
  if (heatIdxF >= cfg.caution_f) return 'caution'
  return 'safe'
}

export function heatCategoryTone(category: HeatIndexCategory): WeatherAlertTone | null {
  switch (category) {
    case 'extreme_danger':
    case 'danger':
      return 'critical'
    case 'extreme_caution':
      return 'warning'
    case 'caution':
      return 'attention'
    default:
      return null
  }
}

export const HEAT_INDEX_CATEGORY_LABEL: Record<HeatIndexCategory, string> = {
  unknown: 'No heat data',
  safe: 'Normal',
  caution: 'Caution',
  extreme_caution: 'Extreme caution',
  danger: 'Danger',
  extreme_danger: 'Extreme danger',
}

// --------------------------------------------------------------------------
// UV index (WHO categories)
// --------------------------------------------------------------------------

export type UvCategory = 'unknown' | 'low' | 'moderate' | 'high' | 'very_high' | 'extreme'

export function uvCategory(
  uvIndex: number | null,
  cfg: UvThresholds = DEFAULT_SAFETY_WEATHER_CONFIG.uv,
): UvCategory {
  if (!isFiniteNumber(uvIndex)) return 'unknown'
  if (uvIndex >= cfg.extreme) return 'extreme'
  if (uvIndex >= cfg.very_high) return 'very_high'
  if (uvIndex >= cfg.high) return 'high'
  if (uvIndex >= cfg.moderate) return 'moderate'
  return 'low'
}

export function uvCategoryTone(category: UvCategory): WeatherAlertTone | null {
  switch (category) {
    case 'extreme':
      return 'critical'
    case 'very_high':
      return 'warning'
    case 'high':
      return 'attention'
    default:
      return null
  }
}

export const UV_CATEGORY_LABEL: Record<UvCategory, string> = {
  unknown: 'No UV data',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  very_high: 'Very high',
  extreme: 'Extreme',
}

// --------------------------------------------------------------------------
// Severe weather alerts (normalized from NWS event strings)
// --------------------------------------------------------------------------

export type SevereAlertKind =
  | 'tornado'
  | 'severe_thunderstorm'
  | 'high_wind'
  | 'flood'
  | 'heat'
  | 'winter'
  | 'other'

export interface SevereAlertSummary {
  kind: SevereAlertKind
  tone: WeatherAlertTone
  event: string
  headline: string
  expires: string | null
}

/**
 * Map an NWS `event` string + `severity` to our kind and tone. Tornado/severe
 * warnings are escalated to `critical` regardless of the provider's severity
 * field, since those are immediate life-safety events for outdoor crews.
 */
export function classifySevereAlert(
  event: string,
  severity: string | null,
): { kind: SevereAlertKind; tone: WeatherAlertTone } {
  const e = event.toLowerCase()
  const isWarning = e.includes('warning')

  let kind: SevereAlertKind = 'other'
  if (e.includes('tornado')) kind = 'tornado'
  else if (e.includes('thunderstorm')) kind = 'severe_thunderstorm'
  // Cold/winter hazards must be matched before the generic "wind" branch:
  // "Wind Chill Warning/Advisory" contain "wind" but are cold-exposure events,
  // not lift/scaffold wind hazards, and must not surface as "High wind".
  else if (
    e.includes('chill') || e.includes('cold') || e.includes('freeze') ||
    e.includes('frost') || e.includes('winter') || e.includes('snow') ||
    e.includes('ice') || e.includes('blizzard')
  ) kind = 'winter'
  else if (e.includes('wind')) kind = 'high_wind'
  else if (e.includes('flood')) kind = 'flood'
  else if (e.includes('heat')) kind = 'heat'

  let tone: WeatherAlertTone = toneForSeverity(severity)
  if ((kind === 'tornado' || kind === 'severe_thunderstorm') && isWarning) tone = 'critical'
  return { kind, tone }
}

function toneForSeverity(severity: string | null): WeatherAlertTone {
  switch ((severity ?? '').toLowerCase()) {
    case 'extreme':
      return 'critical'
    case 'severe':
      return 'warning'
    default:
      return 'attention'
  }
}

export const SEVERE_ALERT_KIND_LABEL: Record<SevereAlertKind, string> = {
  tornado: 'Tornado',
  severe_thunderstorm: 'Severe thunderstorm',
  high_wind: 'High wind',
  flood: 'Flood',
  heat: 'Excessive heat',
  winter: 'Winter weather',
  other: 'Weather alert',
}

// --------------------------------------------------------------------------
// Wind direction → compass
// --------------------------------------------------------------------------

export type CompassPoint =
  | 'N' | 'NNE' | 'NE' | 'ENE' | 'E' | 'ESE' | 'SE' | 'SSE'
  | 'S' | 'SSW' | 'SW' | 'WSW' | 'W' | 'WNW' | 'NW' | 'NNW'

const COMPASS_POINTS: CompassPoint[] = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
]

/** 16-point compass label for a meteorological "from" bearing in degrees. */
export function windDirectionLabel(deg: number | null): CompassPoint | null {
  if (!isFiniteNumber(deg)) return null
  const normalized = ((deg % 360) + 360) % 360
  const index = Math.round(normalized / 22.5) % 16
  return COMPASS_POINTS[index]
}

// --------------------------------------------------------------------------
// Snapshot + worst-condition rollup
// --------------------------------------------------------------------------

export interface SafetyWeatherSnapshot {
  observed_at: string | null
  temp_f: number | null
  rel_humidity_pct: number | null
  /** Optional precomputed heat index; rollup derives it from temp+humidity when null. */
  heat_index_f: number | null
  wind_mph: number | null
  gust_mph: number | null
  wind_direction_deg: number | null
  uv_index: number | null
  precip_in: number | null
  severe_alerts: SevereAlertSummary[]
}

export type WeatherConditionDomain = 'crane' | 'scaffold' | 'heat' | 'uv' | 'severe'

export interface WeatherConditionContributor {
  domain: WeatherConditionDomain
  status: string
  tone: WeatherAlertTone
  detail: string
}

export interface WeatherConditionRollup {
  tone: WeatherAlertTone | 'none'
  priority: number
  headline: string
  contributors: WeatherConditionContributor[]
}

/**
 * Run every classifier over a current-conditions snapshot and return the worst
 * contributing condition as the board's headline tone + priority. This is the
 * single source of truth for the top banner and any future Command Center
 * weather-alert insert.
 */
export function rollupWeatherConditions(
  snapshot: SafetyWeatherSnapshot,
  cfg: SafetyWeatherConfig = DEFAULT_SAFETY_WEATHER_CONFIG,
): WeatherConditionRollup {
  const contributors: WeatherConditionContributor[] = []

  const crane = craneWindStatus(snapshot.wind_mph, snapshot.gust_mph, cfg.wind)
  if (crane.tone) {
    contributors.push({
      domain: 'crane',
      status: crane.status,
      tone: crane.tone,
      detail: `${CRANE_WIND_STATUS_LABEL[crane.status]} (${formatMph(crane.governingMph)})`,
    })
  }

  const scaffold = scaffoldWindStatus(snapshot.wind_mph, snapshot.gust_mph, cfg.wind)
  if (scaffold.tone) {
    contributors.push({
      domain: 'scaffold',
      status: scaffold.status,
      tone: scaffold.tone,
      detail: `${SCAFFOLD_WIND_STATUS_LABEL[scaffold.status]} (${formatMph(scaffold.governingMph)})`,
    })
  }

  const hiF = isFiniteNumber(snapshot.heat_index_f)
    ? snapshot.heat_index_f
    : heatIndexF(snapshot.temp_f, snapshot.rel_humidity_pct)
  const heatCat = heatIndexCategory(hiF, cfg.heat)
  const heatTone = heatCategoryTone(heatCat)
  if (heatTone && isFiniteNumber(hiF)) {
    contributors.push({
      domain: 'heat',
      status: heatCat,
      tone: heatTone,
      detail: `${HEAT_INDEX_CATEGORY_LABEL[heatCat]} — heat index ${Math.round(hiF)}°F`,
    })
  }

  const uvCat = uvCategory(snapshot.uv_index, cfg.uv)
  const uvTone = uvCategoryTone(uvCat)
  if (uvTone && isFiniteNumber(snapshot.uv_index)) {
    contributors.push({
      domain: 'uv',
      status: uvCat,
      tone: uvTone,
      detail: `${UV_CATEGORY_LABEL[uvCat]} UV — index ${round1(snapshot.uv_index)}`,
    })
  }

  for (const alert of snapshot.severe_alerts) {
    contributors.push({
      domain: 'severe',
      status: alert.kind,
      tone: alert.tone,
      detail: alert.headline || `${SEVERE_ALERT_KIND_LABEL[alert.kind]}: ${alert.event}`,
    })
  }

  if (contributors.length === 0) {
    return { tone: 'none', priority: 0, headline: 'Conditions within safe limits', contributors: [] }
  }

  contributors.sort((a, b) => weatherTonePriority(b.tone) - weatherTonePriority(a.tone))
  const worst = contributors[0]
  return {
    tone: worst.tone,
    priority: weatherTonePriority(worst.tone),
    headline: worst.detail,
    contributors,
  }
}

// --------------------------------------------------------------------------
// Onsite verification — readings + forecast comparison
// --------------------------------------------------------------------------

/** Mirrors the `safety_weather_readings` table (see migration 234). */
export interface SafetyWeatherReadingRow {
  id: string
  tenant_id: string
  facility_id: string | null
  reading_at: string
  measured_wind_mph: number
  measured_gust_mph: number | null
  unit_system: WeatherUnitSystem
  instrument: string | null
  latitude: number | null
  longitude: number | null
  forecast_wind_mph: number | null
  forecast_gust_mph: number | null
  forecast_fetched_at: string | null
  note: string | null
  created_at: string
  created_by: string | null
}

/** Mirrors the `safety_weather_settings` table (see migration 233). */
export interface SafetyWeatherSettingsRow {
  tenant_id: string
  facility_id: string | null
  config: PartialSafetyWeatherConfig
  updated_at: string
  updated_by: string | null
}

export interface WeatherReadingInput {
  facility_id?: string | null
  measured_wind_mph?: number | null
  measured_gust_mph?: number | null
  unit_system?: WeatherUnitSystem
  instrument?: string | null
  latitude?: number | null
  longitude?: number | null
  forecast_wind_mph?: number | null
  forecast_gust_mph?: number | null
  forecast_fetched_at?: string | null
  note?: string | null
}

const MAX_PLAUSIBLE_WIND_MPH = 250

/** Validate an onsite verification reading; returns the first error message or null. */
export function validateWeatherReadingInput(input: WeatherReadingInput): string | null {
  if (!isFiniteNumber(input.measured_wind_mph)) return 'measured_wind_mph is required'
  if (input.measured_wind_mph < 0 || input.measured_wind_mph > MAX_PLAUSIBLE_WIND_MPH) {
    return `measured_wind_mph must be between 0 and ${MAX_PLAUSIBLE_WIND_MPH}`
  }
  if (input.measured_gust_mph != null) {
    if (!isFiniteNumber(input.measured_gust_mph) || input.measured_gust_mph < 0 || input.measured_gust_mph > MAX_PLAUSIBLE_WIND_MPH) {
      return `measured_gust_mph must be between 0 and ${MAX_PLAUSIBLE_WIND_MPH}`
    }
    if (input.measured_gust_mph < input.measured_wind_mph) {
      return 'measured_gust_mph cannot be less than measured_wind_mph'
    }
  }
  if (input.unit_system != null && !WEATHER_UNIT_SYSTEMS.includes(input.unit_system)) {
    return "unit_system must be 'imperial' or 'metric'"
  }
  if (input.latitude != null && (!isFiniteNumber(input.latitude) || input.latitude < -90 || input.latitude > 90)) {
    return 'latitude must be between -90 and 90'
  }
  if (input.longitude != null && (!isFiniteNumber(input.longitude) || input.longitude < -180 || input.longitude > 180)) {
    return 'longitude must be between -180 and 180'
  }
  if (input.note != null && input.note.length > 1000) {
    return 'note must be 1000 characters or fewer'
  }
  if (input.forecast_fetched_at != null && Number.isNaN(Date.parse(input.forecast_fetched_at))) {
    return 'forecast_fetched_at must be an ISO timestamp'
  }
  return null
}

export interface WindVerificationDelta {
  measuredMph: number
  forecastMph: number | null
  /** measured − forecast; positive means the field reading is windier than forecast. */
  deltaMph: number | null
  /** The measured wind meaningfully exceeds the forecast (≥ 5 mph windier). */
  exceedsForecast: boolean
  measuredCrane: WindClassification<CraneWindStatus>
  measuredScaffold: WindClassification<ScaffoldWindStatus>
}

const FORECAST_EXCEEDANCE_MPH = 5

/**
 * Compare a measured onsite reading against the captured forecast. The crane
 * and scaffold statuses are computed on the *measured* value — the worker on
 * the ground is the ground truth.
 */
export function compareReadingToForecast(
  reading: Pick<
    SafetyWeatherReadingRow,
    'measured_wind_mph' | 'measured_gust_mph' | 'forecast_wind_mph' | 'forecast_gust_mph'
  >,
  cfg: SafetyWeatherConfig = DEFAULT_SAFETY_WEATHER_CONFIG,
): WindVerificationDelta {
  const measured = reading.measured_wind_mph
  const forecast = isFiniteNumber(reading.forecast_wind_mph) ? reading.forecast_wind_mph : null
  const delta = forecast === null ? null : round1(measured - forecast)
  return {
    measuredMph: measured,
    forecastMph: forecast,
    deltaMph: delta,
    exceedsForecast: delta !== null && delta >= FORECAST_EXCEEDANCE_MPH,
    measuredCrane: craneWindStatus(reading.measured_wind_mph, reading.measured_gust_mph, cfg.wind),
    measuredScaffold: scaffoldWindStatus(reading.measured_wind_mph, reading.measured_gust_mph, cfg.wind),
  }
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function formatMph(mph: number | null): string {
  return mph === null ? 'n/a' : `${Math.round(mph)} mph`
}
