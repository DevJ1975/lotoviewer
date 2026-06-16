'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Loader2,
  AlertTriangle,
  MapPin,
  Wind,
  Thermometer,
  Sun,
  Droplets,
  ConstructionIcon,
  HardHat,
  ShieldAlert,
  CheckCircle2,
  Crosshair,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  buildOpenMeteoUrl,
  normalizeForecast,
  forecastTimeToEpochMs,
  weatherCodeLabel,
  snapshotFromConditions,
  type CurrentConditions,
  type HourlyForecastPoint,
  type DailyForecastPoint,
  type NormalizedForecast,
} from '@soteria/core/openMeteo'
import {
  craneWindStatus,
  scaffoldWindStatus,
  heatIndexCategory,
  uvCategory,
  windDirectionLabel,
  rollupWeatherConditions,
  resolveSafetyWeatherConfig,
  validateWeatherReadingInput,
  compareReadingToForecast,
  CRANE_WIND_STATUS_LABEL,
  SCAFFOLD_WIND_STATUS_LABEL,
  HEAT_INDEX_CATEGORY_LABEL,
  UV_CATEGORY_LABEL,
  SEVERE_ALERT_KIND_LABEL,
  type WeatherAlertTone,
  type WeatherConditionRollup,
  type SevereAlertSummary,
  type SafetyWeatherSettingsRow,
  type SafetyWeatherReadingRow,
  type WindVerificationDelta,
} from '@soteria/core/safetyWeather'

// /weather — Safety Weather Board. A single-screen, live read of the conditions
// that govern outdoor crew operations: crane/scaffold wind limits, heat index,
// UV, and official NWS severe-weather alerts. Coordinates come from the browser
// (with a manual fallback); the forecast is fetched directly from Open-Meteo
// (CORS-clean, keyless) and alerts/readings go through our authenticated proxy.

// A sensible default site for when geolocation is denied/unavailable so the
// board still renders something actionable. (USACE HQ, Washington DC.)
const DEFAULT_COORDS: Coords = { latitude: 38.8895, longitude: -77.035 }

interface Coords {
  latitude: number
  longitude: number
}

type ReadingsResponse = { readings?: SafetyWeatherReadingRow[] }
type AlertsResponse = { alerts?: SevereAlertSummary[] }
type SettingsResponse = { settings?: SafetyWeatherSettingsRow | null }

export default function SafetyWeatherPage() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id

  const [coords, setCoords] = useState<Coords | null>(null)
  const [geoState, setGeoState] = useState<'pending' | 'ready' | 'denied'>('pending')
  // Captured once at mount so the "next 24h" hourly slice is a stable, pure
  // render input rather than a fresh Date.now() read on every re-render.
  const [mountedAt] = useState(() => Date.now())

  const [forecast, setForecast] = useState<NormalizedForecast | null>(null)
  const [alerts, setAlerts] = useState<SevereAlertSummary[]>([])
  const [settings, setSettings] = useState<SafetyWeatherSettingsRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Ask the browser for the crew's location once. A denial isn't an error —
  // it drops us into the manual-entry fallback below.
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoState('denied')
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
        setGeoState('ready')
      },
      () => setGeoState('denied'),
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    )
  }, [])

  const load = useCallback(
    async (point: Coords, signal?: AbortSignal) => {
      if (!tenantId) return
      setLoading(true)
      setError(null)
      try {
        const headers = await authHeaders(tenantId)
        if (!headers || signal?.aborted) return

        const params = `lat=${point.latitude}&lon=${point.longitude}`
        const [meteoRes, alertsRes, settingsRes] = await Promise.all([
          fetch(buildOpenMeteoUrl(point.latitude, point.longitude), { signal }),
          fetch(`/api/weather/alerts?${params}`, { headers, signal }),
          fetch('/api/weather/settings', { headers, signal }),
        ])
        if (signal?.aborted) return

        if (!meteoRes.ok) throw new Error(`Open-Meteo HTTP ${meteoRes.status}`)
        const meteoBody = await meteoRes.json()
        const alertsBody: AlertsResponse = alertsRes.ok ? await alertsRes.json() : {}
        const settingsBody: SettingsResponse = settingsRes.ok ? await settingsRes.json() : {}
        if (signal?.aborted) return

        setForecast(normalizeForecast(meteoBody))
        setAlerts(alertsBody.alerts ?? [])
        setSettings(settingsBody.settings ?? null)
      } catch (e) {
        if (signal?.aborted) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [tenantId],
  )

  // Refetch whenever coordinates resolve or change. Abort the in-flight request
  // on unmount / coordinate change so a late response can't clobber newer data.
  useEffect(() => {
    if (!coords) return
    const ac = new AbortController()
    void load(coords, ac.signal)
    return () => ac.abort()
  }, [coords, load])

  // The React Compiler memoizes these derived values; no manual useMemo needed.
  const config = resolveSafetyWeatherConfig(settings?.config)
  const rollup: WeatherConditionRollup | null = forecast
    ? rollupWeatherConditions(snapshotFromConditions(forecast.current, alerts), config)
    : null

  // No coordinates yet: geolocation pending, or denied and not yet entered.
  if (geoState === 'pending' && !coords) {
    return (
      <Centered>
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Locating your site…</p>
      </Centered>
    )
  }
  if (!coords) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Header coords={null} />
        <ManualCoordsForm onSubmit={setCoords} defaultCoords={DEFAULT_COORDS} />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Header coords={coords} />

      <ManualCoordsForm onSubmit={setCoords} defaultCoords={coords} compact />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !forecast && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {forecast && rollup && (
        <>
          <ConditionBanner rollup={rollup} />

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CraneCard current={forecast.current} config={config} />
            <ScaffoldCard current={forecast.current} config={config} />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <CurrentConditionsCard current={forecast.current} config={config} />
            </div>
            <WindCompassCard current={forecast.current} />
          </section>

          <HourlyChart hourly={forecast.hourly} config={config} now={mountedAt} utcOffsetSeconds={forecast.utcOffsetSeconds} />
          <DailyChart daily={forecast.daily} config={config} />

          <AlertsList alerts={alerts} />

          <VerificationSection
            tenantId={tenantId}
            coords={coords}
            current={forecast.current}
            config={config}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Auth + layout primitives
// ---------------------------------------------------------------------------

// Build the headers every authenticated weather API call needs (mirrors
// em385Headers). Returns null when there is no active tenant yet.
async function authHeaders(tenantId: string | undefined): Promise<Record<string, string> | null> {
  if (!tenantId) return null
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-active-tenant': tenantId,
  }
  if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
  return headers
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center justify-center py-20">{children}</div>
}

function Header({ coords }: { coords: Coords | null }) {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Safety Weather Board</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Live wind, heat, UV, and severe-weather conditions against the limits that govern crane,
        scaffold, and outdoor work.
      </p>
      {coords && (
        <p className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
          <MapPin className="h-3.5 w-3.5" />
          {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
        </p>
      )}
    </header>
  )
}

// ---------------------------------------------------------------------------
// Tone styling
// ---------------------------------------------------------------------------

const TONE_BANNER: Record<WeatherConditionRollup['tone'], string> = {
  critical: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  attention: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100',
  none: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
}

const TONE_PILL: Record<WeatherAlertTone, string> = {
  critical: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  attention: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
}

// ---------------------------------------------------------------------------
// Condition banner
// ---------------------------------------------------------------------------

function ConditionBanner({ rollup }: { rollup: WeatherConditionRollup }) {
  const Icon = rollup.tone === 'none' ? CheckCircle2 : ShieldAlert
  return (
    <section className={`rounded-xl border p-4 ${TONE_BANNER[rollup.tone]}`}>
      <div className="flex items-start gap-3">
        <Icon className="h-6 w-6 mt-0.5 shrink-0" />
        <div className="space-y-2">
          <p className="text-lg font-bold">{rollup.headline}</p>
          {rollup.contributors.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {rollup.contributors.map((c, i) => (
                <li
                  key={`${c.domain}-${i}`}
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONE_PILL[c.tone]}`}
                >
                  {c.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Crane / scaffold safety cards
// ---------------------------------------------------------------------------

function StatusCard({
  title,
  Icon,
  label,
  tone,
  governingMph,
}: {
  title: string
  Icon: typeof HardHat
  label: string
  tone: WeatherAlertTone | null
  governingMph: number | null
}) {
  const accent = tone ? TONE_PILL[tone] : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Icon className="h-5 w-5" />
        <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <p className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">{label}</p>
      <span className={`mt-3 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${accent}`}>
        Governing wind: {governingMph === null ? 'n/a' : `${Math.round(governingMph)} mph`}
      </span>
    </div>
  )
}

function CraneCard({ current, config }: { current: CurrentConditions; config: ResolvedConfig }) {
  const status = craneWindStatus(current.wind_mph, current.gust_mph, config.wind)
  return (
    <StatusCard
      title="Crane operations"
      Icon={ConstructionIcon}
      label={CRANE_WIND_STATUS_LABEL[status.status]}
      tone={status.tone}
      governingMph={status.governingMph}
    />
  )
}

function ScaffoldCard({ current, config }: { current: CurrentConditions; config: ResolvedConfig }) {
  const status = scaffoldWindStatus(current.wind_mph, current.gust_mph, config.wind)
  return (
    <StatusCard
      title="Scaffold work"
      Icon={HardHat}
      label={SCAFFOLD_WIND_STATUS_LABEL[status.status]}
      tone={status.tone}
      governingMph={status.governingMph}
    />
  )
}

// ---------------------------------------------------------------------------
// Current conditions
// ---------------------------------------------------------------------------

type ResolvedConfig = ReturnType<typeof resolveSafetyWeatherConfig>

function CurrentConditionsCard({
  current,
  config,
}: {
  current: CurrentConditions
  config: ResolvedConfig
}) {
  const heatCat = heatIndexCategory(current.heat_index_f, config.heat)
  const uvCat = uvCategory(current.uv_index, config.uv)
  const direction = windDirectionLabel(current.wind_direction_deg)

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Current conditions
        </h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {weatherCodeLabel(current.weather_code)}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Metric Icon={Thermometer} label="Temperature" value={fmtTemp(current.temp_f)} />
        <Metric
          Icon={Thermometer}
          label={`Heat index — ${HEAT_INDEX_CATEGORY_LABEL[heatCat]}`}
          value={fmtTemp(current.heat_index_f)}
        />
        <Metric Icon={Droplets} label="Humidity" value={fmtPct(current.rel_humidity_pct)} />
        <Metric
          Icon={Wind}
          label="Wind / gust"
          value={`${fmtMph(current.wind_mph)} / ${fmtMph(current.gust_mph)}${direction ? ` ${direction}` : ''}`}
        />
        <Metric
          Icon={Sun}
          label={`UV — ${UV_CATEGORY_LABEL[uvCat]}`}
          value={current.uv_index === null ? '—' : current.uv_index.toFixed(1)}
        />
        <Metric Icon={Droplets} label="Precipitation" value={fmtIn(current.precip_in)} />
      </dl>
    </div>
  )
}

function Metric({
  Icon,
  label,
  value,
}: {
  Icon: typeof Thermometer
  label: string
  value: string
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4" />
        {label}
      </dt>
      <dd className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wind compass (plain inline SVG — no extra deps)
// ---------------------------------------------------------------------------

function WindCompassCard({ current }: { current: CurrentConditions }) {
  const deg = current.wind_direction_deg
  const label = windDirectionLabel(deg)
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 flex flex-col items-center">
      <h2 className="self-start text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Wind direction
      </h2>
      <WindCompass directionDeg={deg} />
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        {label ? `From the ${label}` : 'No wind direction'}
        {deg !== null && <span className="text-slate-400 dark:text-slate-500"> ({Math.round(deg)}°)</span>}
      </p>
    </div>
  )
}

// `directionDeg` is the meteorological "from" bearing; the arrow points the way
// the wind is blowing (180° opposite), the convention crews expect on a vane.
function WindCompass({ directionDeg }: { directionDeg: number | null }) {
  const size = 140
  const center = size / 2
  const radius = center - 14
  const hasWind = directionDeg !== null
  const blowingTo = hasWind ? ((directionDeg as number) + 180) % 360 : 0

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Wind direction compass">
      <circle cx={center} cy={center} r={radius} className="fill-none stroke-slate-200 dark:stroke-slate-700" strokeWidth={2} />
      {(['N', 'E', 'S', 'W'] as const).map((point, i) => {
        const angle = (i * 90 - 90) * (Math.PI / 180)
        const x = center + Math.cos(angle) * (radius - 10)
        const y = center + Math.sin(angle) * (radius - 10)
        return (
          <text
            key={point}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-slate-400 dark:fill-slate-500"
            fontSize={11}
            fontWeight={600}
          >
            {point}
          </text>
        )
      })}
      {hasWind && (
        <g transform={`rotate(${blowingTo} ${center} ${center})`}>
          <line x1={center} y1={center} x2={center} y2={center - radius + 18} className="stroke-sky-500" strokeWidth={3} strokeLinecap="round" />
          <polygon
            points={`${center},${center - radius + 8} ${center - 6},${center - radius + 22} ${center + 6},${center - radius + 22}`}
            className="fill-sky-500"
          />
        </g>
      )}
      <circle cx={center} cy={center} r={3} className="fill-slate-400 dark:fill-slate-500" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const HOURS_AHEAD = 24

// Color a wind value by its crane status so the chart reads at a glance.
function craneColor(windMph: number | null, gustMph: number | null, config: ResolvedConfig): string {
  const tone = craneWindStatus(windMph, gustMph, config.wind).tone
  if (tone === 'critical') return '#e11d48'
  if (tone === 'warning') return '#f59e0b'
  return '#0ea5e9'
}

function HourlyChart({
  hourly,
  config,
  now,
  utcOffsetSeconds,
}: {
  hourly: HourlyForecastPoint[]
  config: ResolvedConfig
  now: number
  utcOffsetSeconds: number | null
}) {
  // Open-Meteo returns the day's full hourly series in site-local wall-clock
  // time; convert each stamp to an absolute epoch (via the site's UTC offset)
  // before comparing to now so "next 24h" is correct regardless of the viewer's
  // own timezone.
  const upcoming = hourly
    .filter(p => forecastTimeToEpochMs(p.time, utcOffsetSeconds) >= now)
    .slice(0, HOURS_AHEAD)
  const data = upcoming.map(p => ({
    label: shortHour(p.time),
    temp: p.temp_f,
    apparent: p.apparent_f,
    wind: p.wind_mph,
    gust: p.gust_mph,
  }))

  if (data.length === 0) return null

  return (
    <ChartCard title="Next 24 hours">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={3} />
            <YAxis tick={{ fontSize: 11 }} unit="°" width={40} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="temp" name="Temp °F" stroke="#0ea5e9" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="apparent" name="Feels like °F" stroke="#f59e0b" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={3} />
            <YAxis tick={{ fontSize: 11 }} unit=" mph" width={52} />
            <Tooltip />
            <Legend />
            <ReferenceLine y={config.wind.crane_caution_mph} stroke="#f59e0b" strokeDasharray="4 3" />
            <ReferenceLine y={config.wind.crane_shutdown_mph} stroke="#e11d48" strokeDasharray="4 3" />
            <Line type="monotone" dataKey="wind" name="Wind mph" stroke="#0ea5e9" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="gust" name="Gust mph" stroke="#e11d48" dot={false} strokeWidth={2} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

function DailyChart({ daily, config }: { daily: DailyForecastPoint[]; config: ResolvedConfig }) {
  const data = daily.map(d => ({
    label: shortDay(d.date),
    windMax: d.wind_max_mph,
    gustMax: d.gust_max_mph,
    tempMax: d.temp_max_f,
    windColor: craneColor(d.wind_max_mph, d.gust_max_mph, config),
  }))

  if (data.length === 0) return null

  return (
    <ChartCard title="7-day outlook">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit=" mph" width={52} />
            <Tooltip />
            <Legend />
            <Bar dataKey="windMax" name="Max wind mph" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.windColor} />
              ))}
            </Bar>
            <Bar dataKey="gustMax" name="Max gust mph" fill="#94a3b8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="°" width={40} />
            <Tooltip />
            <Legend />
            <Bar dataKey="tempMax" name="Max temp °F" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Active alerts
// ---------------------------------------------------------------------------

function AlertsList({ alerts }: { alerts: SevereAlertSummary[] }) {
  if (alerts.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Active alerts
        </h2>
        <p className="mt-2 inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          No active NWS alerts for this location.
        </p>
      </section>
    )
  }
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Active alerts
      </h2>
      <ul className="mt-3 space-y-2">
        {alerts.map((a, i) => (
          <li key={`${a.kind}-${i}`} className={`rounded-lg border p-3 ${TONE_BANNER[a.tone]}`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-xs font-semibold uppercase tracking-wide">
                {SEVERE_ALERT_KIND_LABEL[a.kind]}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium">{a.headline}</p>
            {a.expires && (
              <p className="mt-1 text-xs opacity-80">Expires {fmtDateTime(a.expires)}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Onsite verification
// ---------------------------------------------------------------------------

function VerificationSection({
  tenantId,
  coords,
  current,
  config,
}: {
  tenantId: string | undefined
  coords: Coords
  current: CurrentConditions
  config: ResolvedConfig
}) {
  const [readings, setReadings] = useState<SafetyWeatherReadingRow[] | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!tenantId) return
    const ac = new AbortController()
    void (async () => {
      const headers = await authHeaders(tenantId)
      if (!headers || ac.signal.aborted) return
      const res = await fetch('/api/weather/readings', { headers, signal: ac.signal })
      if (!res.ok || ac.signal.aborted) return
      const body: ReadingsResponse = await res.json()
      if (ac.signal.aborted) return
      setReadings(body.readings ?? [])
    })()
    return () => ac.abort()
  }, [tenantId, reloadKey])

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <VerificationForm
        tenantId={tenantId}
        coords={coords}
        current={current}
        config={config}
        onSaved={() => setReloadKey(k => k + 1)}
      />
      <RecentReadings readings={readings} config={config} />
    </section>
  )
}

function VerificationForm({
  tenantId,
  coords,
  current,
  config,
  onSaved,
}: {
  tenantId: string | undefined
  coords: Coords
  current: CurrentConditions
  config: ResolvedConfig
  onSaved: () => void
}) {
  const [wind, setWind] = useState('')
  const [gust, setGust] = useState('')
  const [instrument, setInstrument] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastDelta, setLastDelta] = useState<WindVerificationDelta | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const measured_wind_mph = parseNumber(wind)
    const measured_gust_mph = gust.trim() === '' ? null : parseNumber(gust)

    const input = {
      measured_wind_mph,
      measured_gust_mph,
      unit_system: 'imperial' as const,
      instrument: instrument.trim() || null,
      latitude: coords.latitude,
      longitude: coords.longitude,
      forecast_wind_mph: current.wind_mph,
      forecast_gust_mph: current.gust_mph,
      forecast_fetched_at: current.observed_at,
      note: note.trim() || null,
    }
    const validationError = validateWeatherReadingInput(input)
    if (validationError) {
      setError(validationError)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const headers = await authHeaders(tenantId)
      if (!headers) {
        setError('No active tenant — refresh and try again.')
        return
      }
      const res = await fetch('/api/weather/readings', {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      // measured_wind_mph is validated finite above, so the cast is safe.
      setLastDelta(
        compareReadingToForecast(
          {
            measured_wind_mph: measured_wind_mph as number,
            measured_gust_mph,
            forecast_wind_mph: current.wind_mph,
            forecast_gust_mph: current.gust_mph,
          },
          config,
        ),
      )
      setWind('')
      setGust('')
      setNote('')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Crosshair className="h-5 w-5" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">Onsite verification</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
        Log a handheld anemometer reading; we capture the current forecast to compare.
      </p>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {lastDelta && <DeltaSummary delta={lastDelta} />}

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FieldLabel label="Measured wind (mph)" required>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={wind}
              onChange={e => setWind(e.target.value)}
              required
              className={INPUT_CLS}
            />
          </FieldLabel>
          <FieldLabel label="Measured gust (mph)">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={gust}
              onChange={e => setGust(e.target.value)}
              className={INPUT_CLS}
            />
          </FieldLabel>
        </div>
        <FieldLabel label="Instrument">
          <input
            value={instrument}
            onChange={e => setInstrument(e.target.value)}
            placeholder="e.g. Kestrel 3500"
            className={INPUT_CLS}
          />
        </FieldLabel>
        <FieldLabel label="Note">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
            className={INPUT_CLS}
          />
        </FieldLabel>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-5 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Log reading
          </button>
        </div>
      </form>
    </div>
  )
}

function DeltaSummary({ delta }: { delta: WindVerificationDelta }) {
  const tone: WeatherAlertTone | 'none' = delta.exceedsForecast ? 'warning' : 'none'
  const sign = delta.deltaMph === null ? '' : delta.deltaMph >= 0 ? '+' : ''
  return (
    <div className={`mt-3 rounded-lg border p-3 text-sm ${TONE_BANNER[tone]}`}>
      <p className="font-semibold">
        Measured {Math.round(delta.measuredMph)} mph
        {delta.forecastMph !== null && ` vs forecast ${Math.round(delta.forecastMph)} mph`}
        {delta.deltaMph !== null && ` (${sign}${delta.deltaMph} mph)`}
      </p>
      <p className="mt-1 text-xs opacity-90">
        Crane: {CRANE_WIND_STATUS_LABEL[delta.measuredCrane.status]} · Scaffold:{' '}
        {SCAFFOLD_WIND_STATUS_LABEL[delta.measuredScaffold.status]}
      </p>
    </div>
  )
}

function RecentReadings({
  readings,
  config,
}: {
  readings: SafetyWeatherReadingRow[] | null
  config: ResolvedConfig
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Recent readings
      </h2>
      {readings === null && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}
      {readings && readings.length === 0 && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No readings logged yet.</p>
      )}
      {readings && readings.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {readings.map(r => {
            const delta = compareReadingToForecast(r, config)
            return (
              <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {Math.round(r.measured_wind_mph)} mph
                    {r.measured_gust_mph !== null && ` (gust ${Math.round(r.measured_gust_mph)})`}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {fmtDateTime(r.reading_at)}
                    {r.instrument && ` · ${r.instrument}`}
                  </p>
                </div>
                {delta.deltaMph !== null && (
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      delta.exceedsForecast ? TONE_PILL.warning : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {delta.deltaMph >= 0 ? '+' : ''}
                    {delta.deltaMph} vs forecast
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Manual coordinate entry (geolocation fallback / override)
// ---------------------------------------------------------------------------

function ManualCoordsForm({
  onSubmit,
  defaultCoords,
  compact = false,
}: {
  onSubmit: (coords: Coords) => void
  defaultCoords: Coords
  compact?: boolean
}) {
  const [lat, setLat] = useState(String(defaultCoords.latitude))
  const [lon, setLon] = useState(String(defaultCoords.longitude))
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const latitude = parseNumber(lat)
    const longitude = parseNumber(lon)
    if (latitude === null || latitude < -90 || latitude > 90) {
      setError('Latitude must be between -90 and 90.')
      return
    }
    if (longitude === null || longitude < -180 || longitude > 180) {
      setError('Longitude must be between -180 and 180.')
      return
    }
    setError(null)
    onSubmit({ latitude, longitude })
  }

  return (
    <form
      onSubmit={submit}
      className={
        compact
          ? 'flex flex-wrap items-end gap-3'
          : 'mt-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 space-y-4'
      }
    >
      {!compact && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Location access is off. Enter the site coordinates to load the board.
        </p>
      )}
      <div className={compact ? 'flex items-end gap-3' : 'grid grid-cols-2 gap-4'}>
        <FieldLabel label="Latitude" required>
          <input value={lat} onChange={e => setLat(e.target.value)} className={INPUT_CLS} />
        </FieldLabel>
        <FieldLabel label="Longitude" required>
          <input value={lon} onChange={e => setLon(e.target.value)} className={INPUT_CLS} />
        </FieldLabel>
      </div>
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
      >
        <MapPin className="h-4 w-4" />
        {compact ? 'Update location' : 'Load board'}
      </button>
      {error && <p className="w-full text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Form field + formatting helpers
// ---------------------------------------------------------------------------

const INPUT_CLS =
  'w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm'

function FieldLabel({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function fmtTemp(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}°F`
}

function fmtMph(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} mph`
}

function fmtPct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}

function fmtIn(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)} in`
}

function shortHour(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric' })
}

function shortDay(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString([], { weekday: 'short' })
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}
