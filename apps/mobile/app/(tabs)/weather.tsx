import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native'

import { Text, View } from '@/components/Themed'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { ForecastChart, type ForecastSeriesPoint } from '@/components/ForecastChart'
import { GaugeArc } from '@/components/GaugeArc'
import { WindCompass } from '@/components/WindCompass'
import { supabase } from '@/lib/supabase'
import { getCurrentSiteCoordinates, type SiteCoordinates } from '@/lib/location'
import { fetchSiteWeather, type SiteWeather } from '@/lib/weather'
import { fetchRecentReadings, submitWeatherReading } from '@/lib/weatherReadings'
import { forecastTimeToEpochMs, weatherCodeLabel } from '@soteria/core/openMeteo'
import {
  compareReadingToForecast,
  craneWindStatus,
  heatCategoryTone,
  heatIndexCategory,
  resolveSafetyWeatherConfig,
  rollupWeatherConditions,
  scaffoldWindStatus,
  uvCategory,
  uvCategoryTone,
  validateWeatherReadingInput,
  windDirectionLabel,
  CRANE_WIND_STATUS_LABEL,
  HEAT_INDEX_CATEGORY_LABEL,
  SCAFFOLD_WIND_STATUS_LABEL,
  SEVERE_ALERT_KIND_LABEL,
  UV_CATEGORY_LABEL,
  type SafetyWeatherConfig,
  type SafetyWeatherReadingRow,
  type WeatherAlertTone,
  type WeatherReadingInput,
  type WindClassification,
} from '@soteria/core/safetyWeather'

// Safety Weather Board — the field crew's at-a-glance read on whether outdoor
// conditions are safe to work in. It pulls the device location, fetches live
// weather + official NWS alerts through the mobile fetch layer, classifies them
// against the tenant's thresholds with @soteria/core, and lets the worker log a
// handheld anemometer reading. The worker on the ground is ground truth: a
// measured reading that crosses a shutdown limit shouts louder than the forecast.

// Tone → hex, matching the web board (apps/web/app/weather/page.tsx) so a crew
// switching between web and mobile reads the same color language.
const TONE_HEX: Record<WeatherAlertTone | 'none', string> = {
  critical: '#e11d48',
  warning: '#f59e0b',
  attention: '#0ea5e9',
  none: '#16a34a',
}

// Heightened-awareness/critical bands a wind gauge fills against. The gauge max
// is the crane shutdown wind so a full arc reads as "out of service".
const WIND_GAUGE_MIN = 0
const HEAT_GAUGE_MIN = 70
const HEAT_GAUGE_MAX = 130
const UV_GAUGE_MIN = 0
const UV_GAUGE_MAX = 12

const HOURS_AHEAD = 24
const MAX_NOTE_CHARS = 1000
const MAX_INSTRUMENT_CHARS = 80

type Phase =
  | { kind: 'loading' }
  | { kind: 'denied' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; coordinates: SiteCoordinates; weather: SiteWeather }

interface ReadingForm {
  windMph: string
  gustMph: string
  instrument: string
  note: string
}

const EMPTY_FORM: ReadingForm = { windMph: '', gustMph: '', instrument: '', note: '' }

export default function WeatherBoardScreen() {
  const { tenant } = useTenant()
  const { userId } = useAuth()

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [config, setConfig] = useState<SafetyWeatherConfig>(() => resolveSafetyWeatherConfig(null))

  const [readings, setReadings] = useState<SafetyWeatherReadingRow[]>([])
  const [form, setForm] = useState<ReadingForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Per-tenant thresholds. We read every row for the tenant and apply the
  // facility-null default (the board is site-agnostic on mobile until a
  // facility is bound); missing rows fall back to the core defaults.
  useEffect(() => {
    let cancelled = false
    async function loadConfig() {
      if (!tenant?.id) {
        if (!cancelled) setConfig(resolveSafetyWeatherConfig(null))
        return
      }
      const { data } = await supabase
        .from('safety_weather_settings')
        .select('config, facility_id')
        .eq('tenant_id', tenant.id)
      if (cancelled) return
      const rows = (data ?? []) as Array<{ config: unknown; facility_id: string | null }>
      const tenantDefault = rows.find(row => row.facility_id === null)
      setConfig(resolveSafetyWeatherConfig((tenantDefault?.config ?? null) as never))
    }
    void loadConfig()
    return () => { cancelled = true }
  }, [tenant?.id])

  const loadWeather = useCallback(async () => {
    const location = await getCurrentSiteCoordinates()
    if (location.status === 'denied') return setPhase({ kind: 'denied' })
    if (location.status === 'unavailable') return setPhase({ kind: 'unavailable' })
    try {
      const weather = await fetchSiteWeather(
        location.coordinates.latitude,
        location.coordinates.longitude,
      )
      setPhase({ kind: 'ready', coordinates: location.coordinates, weather })
    } catch (error) {
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Unable to load weather.',
      })
    }
  }, [])

  const loadReadings = useCallback(async () => {
    if (!tenant?.id) { setReadings([]); return }
    try {
      setReadings(await fetchRecentReadings(tenant.id, null))
    } catch {
      // A readings-history failure must never blank the live board; the
      // verification form still works and the next refresh retries.
      setReadings([])
    }
  }, [tenant?.id])

  useEffect(() => {
    setPhase({ kind: 'loading' })
    void loadWeather()
  }, [loadWeather])

  useEffect(() => {
    void loadReadings()
  }, [loadReadings])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadWeather(), loadReadings()])
    setRefreshing(false)
  }, [loadWeather, loadReadings])

  async function onSubmitReading() {
    if (phase.kind !== 'ready') return
    if (!tenant?.id) {
      setFormError('Sign in and confirm the active tenant before logging a reading.')
      return
    }
    const input = buildReadingInput(form, phase.coordinates, phase.weather)
    const validationError = validateWeatherReadingInput(input)
    if (validationError) { setFormError(validationError); return }

    setSubmitting(true)
    setFormError(null)
    try {
      await submitWeatherReading(tenant.id, input)
      setForm(EMPTY_FORM)
      await loadReadings()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to log the reading.'
      setFormError(message)
      Alert.alert('Reading not saved', message)
    } finally {
      setSubmitting(false)
    }
  }

  if (phase.kind === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1e3a8a" />
        <Text style={styles.centeredText}>Reading site location and conditions…</Text>
      </View>
    )
  }

  if (phase.kind === 'denied' || phase.kind === 'unavailable' || phase.kind === 'error') {
    return (
      <LocationGate
        phase={phase}
        onRetry={() => { setPhase({ kind: 'loading' }); void loadWeather() }}
      />
    )
  }

  return (
    <ReadyBoard
      weather={phase.weather}
      coordinates={phase.coordinates}
      config={config}
      readings={readings}
      form={form}
      onFormChange={patch => { setForm(current => ({ ...current, ...patch })); setFormError(null) }}
      formError={formError}
      submitting={submitting}
      canSubmit={Boolean(tenant?.id && userId)}
      onSubmitReading={onSubmitReading}
      refreshing={refreshing}
      onRefresh={onRefresh}
    />
  )
}

// ---------------------------------------------------------------------------
// Empty / error gate (location denied or unavailable, or fetch failed)
// ---------------------------------------------------------------------------

function LocationGate({
  phase,
  onRetry,
}: {
  phase: Extract<Phase, { kind: 'denied' | 'unavailable' | 'error' }>
  onRetry: () => void
}) {
  const copy = gateCopy(phase)
  return (
    <View style={styles.centered}>
      <Text style={styles.gateTitle}>{copy.title}</Text>
      <Text style={styles.gateBody}>{copy.body}</Text>
      <Pressable onPress={onRetry}>
        {({ pressed }) => (
          <View style={[styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>{copy.action}</Text>
          </View>
        )}
      </Pressable>
    </View>
  )
}

function gateCopy(phase: Extract<Phase, { kind: 'denied' | 'unavailable' | 'error' }>): {
  title: string
  body: string
  action: string
} {
  if (phase.kind === 'denied') {
    return {
      title: 'Location needed',
      body: 'The Safety Weather Board uses your site location to pull live wind, heat, UV, and official storm alerts. Enable location for this app in Settings, then try again.',
      action: 'Enable location & retry',
    }
  }
  if (phase.kind === 'unavailable') {
    return {
      title: 'Location unavailable',
      body: 'Couldn’t read a position — location services may be off or the signal is weak. Move to open sky and try again.',
      action: 'Try again',
    }
  }
  return { title: 'Conditions unavailable', body: phase.message, action: 'Retry' }
}

// ---------------------------------------------------------------------------
// Ready board
// ---------------------------------------------------------------------------

function ReadyBoard({
  weather,
  coordinates,
  config,
  readings,
  form,
  onFormChange,
  formError,
  submitting,
  canSubmit,
  onSubmitReading,
  refreshing,
  onRefresh,
}: {
  weather: SiteWeather
  coordinates: SiteCoordinates
  config: SafetyWeatherConfig
  readings: SafetyWeatherReadingRow[]
  form: ReadingForm
  onFormChange: (patch: Partial<ReadingForm>) => void
  formError: string | null
  submitting: boolean
  canSubmit: boolean
  onSubmitReading: () => void
  refreshing: boolean
  onRefresh: () => void
}) {
  const { current } = weather.forecast
  const rollup = useMemo(
    () => rollupWeatherConditions(weather.snapshot, config),
    [weather.snapshot, config],
  )

  const crane = craneWindStatus(current.wind_mph, current.gust_mph, config.wind)
  const scaffold = scaffoldWindStatus(current.wind_mph, current.gust_mph, config.wind)
  const windRingColor = worstWindRingColor(crane, scaffold)

  const heatCat = heatIndexCategory(current.heat_index_f, config.heat)
  const uvCat = uvCategory(current.uv_index, config.uv)

  // A measured reading that crosses a shutdown/work-stop is the loudest signal
  // on the board — the worker felt it. Surface the most recent such reading.
  const measuredCritical = useMemo(
    () => findMeasuredCritical(readings, config),
    [readings, config],
  )

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e3a8a" />}
    >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Safety Weather Board</Text>
        <Text style={styles.title}>{weatherCodeLabel(current.weather_code)}</Text>
        <Text style={styles.subtitle}>
          {coordinates.latitude.toFixed(3)}, {coordinates.longitude.toFixed(3)}
        </Text>
      </View>

      {weather.stale && (
        <View style={styles.staleNotice}>
          <Text style={styles.staleText}>
            Offline — showing last known conditions as of {fmtDateTime(weather.fetchedAt)}.
          </Text>
        </View>
      )}

      {measuredCritical && (
        <View style={[styles.banner, { borderColor: TONE_HEX.critical, backgroundColor: '#fee2e2' }]}>
          <Text style={[styles.bannerHeadline, { color: TONE_HEX.critical }]}>
            Onsite reading crosses a stop-work limit
          </Text>
          <Text style={styles.bannerBody}>{measuredCritical}</Text>
        </View>
      )}

      <RollupBanner rollup={rollup} />

      <View style={styles.compassRow}>
        <WindCompass
          directionDeg={current.wind_direction_deg}
          windMph={current.wind_mph}
          gustMph={current.gust_mph}
          ringColor={windRingColor}
        />
      </View>

      <View style={styles.gaugeRow}>
        <GaugeArc
          value={current.wind_mph}
          min={WIND_GAUGE_MIN}
          max={config.wind.crane_shutdown_mph}
          color={windRingColor}
          label="Wind"
          valueText={`${roundOrDash(current.wind_mph)} mph`}
          size={130}
        />
        <GaugeArc
          value={current.heat_index_f}
          min={HEAT_GAUGE_MIN}
          max={HEAT_GAUGE_MAX}
          color={toneHexOrSafe(heatCategoryTone(heatCat))}
          label="Heat index"
          valueText={`${roundOrDash(current.heat_index_f)}°F`}
          size={130}
        />
        <GaugeArc
          value={current.uv_index}
          min={UV_GAUGE_MIN}
          max={UV_GAUGE_MAX}
          color={toneHexOrSafe(uvCategoryTone(uvCat))}
          label="UV index"
          valueText={`UV ${roundOrDash(current.uv_index)}`}
          size={130}
        />
      </View>

      <View style={styles.conditionsRow}>
        <Condition label="Temp" value={`${roundOrDash(current.temp_f)}°F`} />
        <Condition label="Feels like" value={`${roundOrDash(current.apparent_f)}°F`} />
        <Condition label="Humidity" value={`${roundOrDash(current.rel_humidity_pct)}%`} />
        <Condition
          label="Wind from"
          value={windDirectionLabel(current.wind_direction_deg) ?? '—'}
        />
        <Condition label="Heat index" value={HEAT_INDEX_CATEGORY_LABEL[heatCat]} />
        <Condition label="UV" value={UV_CATEGORY_LABEL[uvCat]} />
      </View>

      <SafetyCard
        title="Crane lifts"
        tone={crane.tone}
        statusLabel={CRANE_WIND_STATUS_LABEL[crane.status]}
        governingMph={crane.governingMph}
      />
      <SafetyCard
        title="Scaffold work"
        tone={scaffold.tone}
        statusLabel={SCAFFOLD_WIND_STATUS_LABEL[scaffold.status]}
        governingMph={scaffold.governingMph}
      />

      <ForecastChart
        title="Next 24h temperature"
        unit="°F"
        kind="line"
        points={hourlyTempPoints(weather)}
      />
      <ForecastChart
        title="Next 24h wind"
        unit="mph"
        kind="line"
        points={hourlyWindPoints(weather, config)}
      />
      <ForecastChart
        title="7-day max wind"
        unit="mph"
        kind="bar"
        points={dailyWindPoints(weather, config)}
      />
      <ForecastChart
        title="7-day max temperature"
        unit="°F"
        kind="bar"
        points={dailyTempPoints(weather)}
      />

      <AlertsSection alerts={weather.snapshot.severe_alerts} />

      <VerificationForm
        form={form}
        onFormChange={onFormChange}
        formError={formError}
        submitting={submitting}
        canSubmit={canSubmit}
        onSubmit={onSubmitReading}
      />

      <ReadingsHistory readings={readings} config={config} />
    </ScrollView>
  )
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function RollupBanner({ rollup }: { rollup: ReturnType<typeof rollupWeatherConditions> }) {
  const color = TONE_HEX[rollup.tone]
  return (
    <View style={[styles.banner, { borderColor: color, backgroundColor: bannerFill(rollup.tone) }]}>
      <Text style={[styles.bannerHeadline, { color }]}>{rollup.headline}</Text>
      {rollup.contributors.map((contributor, index) => (
        <View key={`${contributor.domain}-${index}`} style={styles.contributorRow}>
          <View style={[styles.contributorDot, { backgroundColor: TONE_HEX[contributor.tone] }]} />
          <Text style={styles.contributorText}>{contributor.detail}</Text>
        </View>
      ))}
    </View>
  )
}

function SafetyCard({
  title,
  tone,
  statusLabel,
  governingMph,
}: {
  title: string
  tone: WeatherAlertTone | null
  statusLabel: string
  governingMph: number | null
}) {
  const color = toneHexOrSafe(tone)
  return (
    <View style={[styles.safetyCard, { borderLeftColor: color }]}>
      <Text style={styles.safetyTitle}>{title}</Text>
      <Text style={[styles.safetyStatus, { color }]}>{statusLabel}</Text>
      <Text style={styles.safetyMeta}>
        {governingMph === null ? 'No wind data' : `Governing wind ${Math.round(governingMph)} mph`}
      </Text>
    </View>
  )
}

function AlertsSection({ alerts }: { alerts: SiteWeather['snapshot']['severe_alerts'] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Severe weather alerts</Text>
      {alerts.length === 0 ? (
        <Text style={styles.mutedText}>No active National Weather Service alerts for this site.</Text>
      ) : (
        alerts.map((alert, index) => (
          <View
            key={`${alert.event}-${index}`}
            style={[styles.alertRow, { borderLeftColor: TONE_HEX[alert.tone] }]}
          >
            <Text style={[styles.alertKind, { color: TONE_HEX[alert.tone] }]}>
              {SEVERE_ALERT_KIND_LABEL[alert.kind]}
            </Text>
            <Text style={styles.alertHeadline}>{alert.headline}</Text>
            {alert.expires && (
              <Text style={styles.mutedText}>Until {fmtDateTime(alert.expires)}</Text>
            )}
          </View>
        ))
      )}
    </View>
  )
}

function VerificationForm({
  form,
  onFormChange,
  formError,
  submitting,
  canSubmit,
  onSubmit,
}: {
  form: ReadingForm
  onFormChange: (patch: Partial<ReadingForm>) => void
  formError: string | null
  submitting: boolean
  canSubmit: boolean
  onSubmit: () => void
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Onsite verification</Text>
      <Text style={styles.mutedText}>
        Log a handheld anemometer reading. Your measurement governs the crane and scaffold call — you’re the ground truth.
      </Text>
      <TextInput
        style={styles.input}
        value={form.windMph}
        onChangeText={windMph => onFormChange({ windMph })}
        placeholder="Measured wind (mph)"
        placeholderTextColor="#64748b"
        keyboardType="decimal-pad"
      />
      <TextInput
        style={styles.input}
        value={form.gustMph}
        onChangeText={gustMph => onFormChange({ gustMph })}
        placeholder="Measured gust (mph, optional)"
        placeholderTextColor="#64748b"
        keyboardType="decimal-pad"
      />
      <TextInput
        style={styles.input}
        value={form.instrument}
        onChangeText={instrument => onFormChange({ instrument })}
        placeholder="Instrument (e.g. Kestrel 3000)"
        placeholderTextColor="#64748b"
        maxLength={MAX_INSTRUMENT_CHARS}
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        multiline
        value={form.note}
        onChangeText={note => onFormChange({ note })}
        placeholder="Note (optional)"
        placeholderTextColor="#64748b"
        maxLength={MAX_NOTE_CHARS}
      />
      {formError && <Text style={styles.errorText}>{formError}</Text>}
      <Pressable onPress={onSubmit} disabled={submitting || !canSubmit}>
        {({ pressed }) => (
          <View
            style={[
              styles.primaryButton,
              (submitting || !canSubmit) && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryButtonText}>Log reading</Text>}
          </View>
        )}
      </Pressable>
      {!canSubmit && (
        <Text style={styles.mutedText}>Sign in and confirm the active tenant to log a reading.</Text>
      )}
    </View>
  )
}

function ReadingsHistory({
  readings,
  config,
}: {
  readings: SafetyWeatherReadingRow[]
  config: SafetyWeatherConfig
}) {
  if (readings.length === 0) return null
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Recent readings</Text>
      {readings.map(reading => {
        const delta = compareReadingToForecast(reading, config)
        const craneTone = delta.measuredCrane.tone
        const scaffoldTone = delta.measuredScaffold.tone
        const worstTone = worstTone2(craneTone, scaffoldTone)
        return (
          <View
            key={reading.id}
            style={[styles.readingRow, { borderLeftColor: toneHexOrSafe(worstTone) }]}
          >
            <Text style={styles.readingHeadline}>
              {Math.round(delta.measuredMph)} mph
              {reading.measured_gust_mph != null ? ` (gust ${Math.round(reading.measured_gust_mph)})` : ''}
              {' · '}
              {fmtDateTime(reading.reading_at)}
            </Text>
            <Text style={styles.readingMeta}>{deltaLabel(delta)}</Text>
            <Text style={[styles.readingStatus, { color: toneHexOrSafe(craneTone) }]}>
              {CRANE_WIND_STATUS_LABEL[delta.measuredCrane.status]}
            </Text>
            <Text style={[styles.readingStatus, { color: toneHexOrSafe(scaffoldTone) }]}>
              {SCAFFOLD_WIND_STATUS_LABEL[delta.measuredScaffold.status]}
            </Text>
            {reading.note && <Text style={styles.readingNote}>{reading.note}</Text>}
          </View>
        )
      })}
    </View>
  )
}

function Condition({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.conditionTile}>
      <Text style={styles.conditionValue}>{value}</Text>
      <Text style={styles.conditionLabel}>{label}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function buildReadingInput(
  form: ReadingForm,
  coordinates: SiteCoordinates,
  weather: SiteWeather,
): WeatherReadingInput {
  return {
    measured_wind_mph: parseNumber(form.windMph),
    measured_gust_mph: form.gustMph.trim() === '' ? null : parseNumber(form.gustMph),
    unit_system: 'imperial',
    instrument: form.instrument.trim() || null,
    note: form.note.trim() || null,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    forecast_wind_mph: weather.snapshot.wind_mph,
    forecast_gust_mph: weather.snapshot.gust_mph,
    forecast_fetched_at: weather.fetchedAt,
  }
}

// parseFloat tolerates trailing junk and returns NaN on empty/garbage, which
// validateWeatherReadingInput then rejects as "required". null inputs become
// NaN here so the boundary validator owns the error message.
function parseNumber(raw: string): number {
  return Number.parseFloat(raw)
}

function hourlyTempPoints(weather: SiteWeather): ForecastSeriesPoint[] {
  return upcomingHours(weather).map(point => ({
    label: shortHour(point.time),
    value: point.temp_f,
  }))
}

function hourlyWindPoints(weather: SiteWeather, config: SafetyWeatherConfig): ForecastSeriesPoint[] {
  return upcomingHours(weather).map(point => ({
    label: shortHour(point.time),
    value: point.wind_mph,
    frontColor: craneColor(point.wind_mph, point.gust_mph, config),
  }))
}

function dailyWindPoints(weather: SiteWeather, config: SafetyWeatherConfig): ForecastSeriesPoint[] {
  return weather.forecast.daily.map(day => ({
    label: shortDay(day.date),
    value: day.wind_max_mph,
    frontColor: craneColor(day.wind_max_mph, day.gust_max_mph, config),
  }))
}

function dailyTempPoints(weather: SiteWeather): ForecastSeriesPoint[] {
  return weather.forecast.daily.map(day => ({
    label: shortDay(day.date),
    value: day.temp_max_f,
  }))
}

// Open-Meteo returns the full day's hourly series in site-local wall-clock time;
// convert each stamp to an absolute epoch (via the site's UTC offset) before
// comparing to now, so "next 24h" is correct even when the device's timezone
// differs from the site's.
function upcomingHours(weather: SiteWeather) {
  const now = Date.now()
  const offset = weather.forecast.utcOffsetSeconds
  return weather.forecast.hourly
    .filter(point => forecastTimeToEpochMs(point.time, offset) >= now)
    .slice(0, HOURS_AHEAD)
}

function craneColor(windMph: number | null, gustMph: number | null, config: SafetyWeatherConfig): string {
  return toneHexOrSafe(craneWindStatus(windMph, gustMph, config.wind).tone)
}

function worstWindRingColor(
  crane: WindClassification<unknown>,
  scaffold: WindClassification<unknown>,
): string {
  return toneHexOrSafe(worstTone2(crane.tone, scaffold.tone))
}

// The worse of two tones (critical > warning > attention > null/none).
function worstTone2(a: WeatherAlertTone | null, b: WeatherAlertTone | null): WeatherAlertTone | null {
  if (a === null) return b
  if (b === null) return a
  return tonePriority(a) >= tonePriority(b) ? a : b
}

function tonePriority(tone: WeatherAlertTone): number {
  if (tone === 'critical') return 3
  if (tone === 'warning') return 2
  return 1
}

function toneHexOrSafe(tone: WeatherAlertTone | null): string {
  return tone ? TONE_HEX[tone] : TONE_HEX.none
}

function bannerFill(tone: WeatherAlertTone | 'none'): string {
  switch (tone) {
    case 'critical': return '#fee2e2'
    case 'warning': return '#fef3c7'
    case 'attention': return '#e0f2fe'
    default: return '#dcfce7'
  }
}

// The most recent measured reading that crossed a crane-shutdown or
// scaffold-work-stop limit, summarized for the critical inline banner.
function findMeasuredCritical(
  readings: SafetyWeatherReadingRow[],
  config: SafetyWeatherConfig,
): string | null {
  for (const reading of readings) {
    const delta = compareReadingToForecast(reading, config)
    const craneStop = delta.measuredCrane.status === 'shutdown'
    const scaffoldStop = delta.measuredScaffold.status === 'work_stop'
    if (craneStop || scaffoldStop) {
      const which = craneStop && scaffoldStop
        ? 'crane shutdown and scaffold work-stop'
        : craneStop ? 'crane shutdown' : 'scaffold work-stop'
      return `${Math.round(delta.measuredMph)} mph measured ${fmtDateTime(reading.reading_at)} — ${which} limit reached.`
    }
  }
  return null
}

function deltaLabel(delta: ReturnType<typeof compareReadingToForecast>): string {
  if (delta.forecastMph === null || delta.deltaMph === null) {
    return 'No forecast captured to compare against.'
  }
  const sign = delta.deltaMph > 0 ? '+' : ''
  const suffix = delta.exceedsForecast ? ' — windier than forecast' : ''
  return `Forecast ${Math.round(delta.forecastMph)} mph · ${sign}${delta.deltaMph} mph vs forecast${suffix}`
}

function roundOrDash(value: number | null): string {
  return value === null ? '—' : String(Math.round(value))
}

function shortHour(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: 'numeric' })
}

function shortDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { weekday: 'short' })
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container:        { flex: 1 },
  content:          { padding: 16, paddingBottom: 48, gap: 16 },
  centered:         { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  centeredText:     { fontSize: 13, color: '#475569', textAlign: 'center' },
  gateTitle:        { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  gateBody:         { fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 20 },
  header:           { gap: 4 },
  eyebrow:          { fontSize: 11, fontWeight: '700', color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: 0.5 },
  title:            { fontSize: 24, fontWeight: '800' },
  subtitle:         { fontSize: 13, opacity: 0.68 },
  staleNotice:      { borderRadius: 10, borderWidth: 1, borderColor: '#fcd34d', backgroundColor: '#fffbeb', padding: 10 },
  staleText:        { fontSize: 12, color: '#92400e' },
  banner:           { borderRadius: 12, borderWidth: 1, borderLeftWidth: 6, padding: 14, gap: 8 },
  bannerHeadline:   { fontSize: 15, fontWeight: '800' },
  bannerBody:       { fontSize: 13, color: '#334155', lineHeight: 18 },
  contributorRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' },
  contributorDot:   { width: 8, height: 8, borderRadius: 4 },
  contributorText:  { fontSize: 12, color: '#334155', flex: 1 },
  compassRow:       { alignItems: 'center', backgroundColor: 'transparent' },
  gaugeRow:         { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', backgroundColor: 'transparent' },
  conditionsRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: 'transparent' },
  conditionTile:    { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 10, minWidth: 96, flexGrow: 1, gap: 2, backgroundColor: '#fff' },
  conditionValue:   { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  conditionLabel:   { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  safetyCard:       { borderWidth: 1, borderColor: '#e2e8f0', borderLeftWidth: 6, borderRadius: 12, padding: 14, gap: 4, backgroundColor: '#fff' },
  safetyTitle:      { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', color: '#475569' },
  safetyStatus:     { fontSize: 15, fontWeight: '800' },
  safetyMeta:       { fontSize: 12, color: '#64748b' },
  section:          { gap: 10 },
  sectionTitle:     { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', color: '#475569' },
  mutedText:        { fontSize: 12, color: '#64748b', lineHeight: 17 },
  alertRow:         { borderWidth: 1, borderColor: '#e2e8f0', borderLeftWidth: 6, borderRadius: 10, padding: 11, gap: 3, backgroundColor: '#fff' },
  alertKind:        { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  alertHeadline:    { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  input:            { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0f172a', backgroundColor: '#fff' },
  textArea:         { minHeight: 72, textAlignVertical: 'top' },
  primaryButton:    { backgroundColor: '#1e3a8a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', minWidth: 160 },
  primaryButtonText:{ color: '#fff', fontWeight: '800', fontSize: 14 },
  buttonDisabled:   { opacity: 0.5 },
  errorText:        { color: '#b91c1c', fontSize: 12 },
  readingRow:       { borderWidth: 1, borderColor: '#e2e8f0', borderLeftWidth: 6, borderRadius: 10, padding: 11, gap: 3, backgroundColor: '#fff' },
  readingHeadline:  { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  readingMeta:      { fontSize: 12, color: '#64748b' },
  readingStatus:    { fontSize: 12, fontWeight: '700' },
  readingNote:      { fontSize: 12, color: '#475569', fontStyle: 'italic' },
  pressed:          { opacity: 0.65 },
})
