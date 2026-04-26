'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow,
  Camera, FileText, MapPin, Plus, Sun, Wind,
} from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { timeOfDayGreeting } from '@/components/Greeting'
import { getModules } from '@/lib/features'
import {
  fetchHomeMetrics,
  type HomeMetrics, type ActivePermitSummary, type ActivityEvent, type PermitAlertSummary,
} from '@/lib/homeMetrics'
import { permitCountdown, type CountdownTone } from '@/lib/permitStatus'

// Home screen — the landing page after login.
//
// Information hierarchy (top → bottom):
//   1. Hero band (greeting + clock + weather)
//   2. Critical alert banner — only when expired permits > 0
//   3. Quick actions — common one-tap workflows
//   4. KPI tiles — at-a-glance counts
//   5. Active Permits + Recent Activity (2-col on desktop)
//   6. Coming Soon advert strip
//   7. Module nav grid (deemphasized — drawer is primary nav)
//
// All numbers are real reads via lib/homeMetrics.ts. Coming-soon
// modules render as advertisements only — no fake metrics on a real
// safety dashboard.

const WEATHER_FETCH_MS    = 30 * 60 * 1000   // weather: every 30 min
const CLOCK_TICK_MS       = 1000              // clock: every second so the active-permit countdown ticks visibly
const METRICS_REFRESH_MS  = 60 * 1000         // permits / equipment / activity: every minute

export default function HomePage() {
  const { profile, email } = useAuth()
  const firstName = (profile?.full_name?.trim().split(/\s+/)[0]) || (email?.split('@')[0]) || 'there'

  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const greeting = useMemo(() => timeOfDayGreeting(now), [now])
  const dateLabel = useMemo(() =>
    now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  [now])
  const timeLabel = useMemo(() =>
    now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  [now])

  const [metrics, setMetrics] = useState<HomeMetrics | null>(null)
  const [metricsError, setMetricsError] = useState<string | null>(null)

  const loadMetrics = useCallback(async () => {
    try {
      const m = await fetchHomeMetrics()
      setMetrics(m)
      setMetricsError(null)
    } catch (err) {
      console.error('[home] metrics fetch failed', err)
      setMetricsError(err instanceof Error ? err.message : 'Could not load metrics')
    }
  }, [])

  useEffect(() => {
    loadMetrics()
    const id = setInterval(loadMetrics, METRICS_REFRESH_MS)
    return () => clearInterval(id)
  }, [loadMetrics])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Hero greeting={greeting} firstName={firstName} dateLabel={dateLabel} timeLabel={timeLabel} />

      {metrics && metrics.expiredPermitCount > 0 && (
        <CriticalAlertBanner count={metrics.expiredPermitCount} />
      )}

      {metrics && (metrics.expiringSoonPermits.length > 0 || metrics.pendingStalePermits.length > 0) && (
        <ConfinedSpaceAlertsCard
          expiringSoon={metrics.expiringSoonPermits}
          pendingStale={metrics.pendingStalePermits}
        />
      )}

      <QuickActions />

      <KpiRow metrics={metrics} error={metricsError} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ActivePermitsPanel permits={metrics?.activePermits ?? null} now={now} />
        <RecentActivityPanel events={metrics?.recentActivity ?? null} />
      </div>

      <ComingSoonStrip />
      <ModulesGrid />
    </div>
  )
}

// ── Hero — greeting + clock + weather ─────────────────────────────────────

function Hero({
  greeting, firstName, dateLabel, timeLabel,
}: { greeting: string; firstName: string; dateLabel: string; timeLabel: string }) {
  return (
    <section className="bg-gradient-to-br from-brand-navy to-[#1a3470] text-white rounded-2xl p-6 sm:p-8 shadow-md">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-end">
        <div>
          <p className="text-2xl sm:text-3xl font-bold tracking-tight">
            {greeting}, <span className="text-brand-yellow">{firstName}</span>
          </p>
          <p className="text-sm sm:text-base text-white/80 mt-2">{dateLabel}</p>
          <p className="text-3xl sm:text-4xl font-mono font-bold mt-1 tabular-nums">{timeLabel}</p>
        </div>
        <WeatherCard />
      </div>
    </section>
  )
}

// ── Weather — Open-Meteo, no API key ──────────────────────────────────────

interface Weather {
  temperatureF: number
  windMph:      number
  code:         number
  fetchedAt:    number
}

function WeatherCard() {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [locationName, setLocationName] = useState<string | null>(null)
  const [weather, setWeather] = useState<Weather | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!('geolocation' in navigator)) { setError('Location not available on this device'); return }
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => setError(err.code === err.PERMISSION_DENIED ? 'Allow location for local weather' : 'Could not get location'),
      { timeout: 8000, maximumAge: 10 * 60 * 1000 },
    )
  }, [])

  const fetchWeather = useCallback(async () => {
    if (!coords) return
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Weather API ${res.status}`)
      const json = await res.json() as { current: { temperature_2m: number; weather_code: number; wind_speed_10m: number } }
      setWeather({
        temperatureF: Math.round(json.current.temperature_2m),
        windMph:      Math.round(json.current.wind_speed_10m),
        code:         json.current.weather_code,
        fetchedAt:    Date.now(),
      })
    } catch (err) {
      console.error('[home] weather fetch failed', err)
      setError('Weather unavailable')
    }
  }, [coords])

  useEffect(() => {
    if (!coords) return
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords.lat}&longitude=${coords.lon}&localityLanguage=en`
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then((j: { city?: string; locality?: string; principalSubdivisionCode?: string } | null) => {
        if (!j) return
        const city = j.city || j.locality
        const state = j.principalSubdivisionCode?.split('-').pop()
        if (city && state) setLocationName(`${city}, ${state}`)
        else if (city)     setLocationName(city)
      })
      .catch(() => { /* ignore */ })
  }, [coords])

  useEffect(() => {
    fetchWeather()
    if (!coords) return
    const id = setInterval(fetchWeather, WEATHER_FETCH_MS)
    return () => clearInterval(id)
  }, [coords, fetchWeather])

  if (error && !weather) {
    return (
      <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 min-w-[200px]">
        <p className="text-xs text-white/60 uppercase tracking-widest font-bold">Weather</p>
        <p className="text-sm text-white/80 mt-1">{error}</p>
      </div>
    )
  }
  if (!weather) {
    return (
      <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 min-w-[200px]">
        <p className="text-xs text-white/60 uppercase tracking-widest font-bold">Weather</p>
        <p className="text-sm text-white/80 mt-1">Loading…</p>
      </div>
    )
  }

  const { Icon, label } = weatherIconForCode(weather.code)
  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 min-w-[200px]">
      <div className="flex items-center gap-3">
        <Icon className="h-10 w-10 text-brand-yellow shrink-0" />
        <div>
          <p className="text-3xl font-bold tabular-nums">{weather.temperatureF}°F</p>
          <p className="text-xs text-white/80">{label}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3 text-[11px] text-white/70">
        <span className="inline-flex items-center gap-1"><Wind className="h-3 w-3" /> {weather.windMph} mph</span>
        {locationName && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {locationName}</span>}
      </div>
    </div>
  )
}

function weatherIconForCode(code: number): { Icon: typeof Sun; label: string } {
  if (code === 0)                       return { Icon: Sun,            label: 'Clear' }
  if (code <= 3)                        return { Icon: Cloud,          label: 'Partly cloudy' }
  if (code === 45 || code === 48)       return { Icon: CloudFog,       label: 'Fog' }
  if (code >= 51 && code <= 57)         return { Icon: CloudDrizzle,   label: 'Drizzle' }
  if (code >= 61 && code <= 67)         return { Icon: CloudRain,      label: 'Rain' }
  if (code >= 71 && code <= 77)         return { Icon: CloudSnow,      label: 'Snow' }
  if (code >= 80 && code <= 82)         return { Icon: CloudRain,      label: 'Showers' }
  if (code >= 85 && code <= 86)         return { Icon: CloudSnow,      label: 'Snow showers' }
  if (code >= 95)                       return { Icon: CloudLightning, label: 'Thunderstorm' }
  return                                       { Icon: Cloud,          label: 'Cloudy' }
}

// ── Critical alert banner ─────────────────────────────────────────────────

function CriticalAlertBanner({ count }: { count: number }) {
  return (
    <Link
      href="/confined-spaces/status"
      className="block bg-rose-600 hover:bg-rose-700 text-white rounded-xl p-4 ring-2 ring-rose-300 ring-offset-2 transition-colors"
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-6 w-6 shrink-0" />
        <div className="flex-1">
          <p className="text-base sm:text-lg font-black">
            {count} permit{count === 1 ? '' : 's'} expired without cancellation
          </p>
          <p className="text-xs text-white/80 mt-0.5">
            OSHA §1910.146(e)(5)(ii) — verify evacuation, then formally cancel. Tap to open the status board.
          </p>
        </div>
        <span className="text-xs font-bold uppercase tracking-widest opacity-80">→</span>
      </div>
    </Link>
  )
}

// ── Confined-space alerts card ────────────────────────────────────────────
//
// Sits below the critical alert banner (expired permits) but above the KPI
// strip. Only renders when there's at least one alert — empty state would
// be noise on a busy iPad.

function ConfinedSpaceAlertsCard({
  expiringSoon, pendingStale,
}: { expiringSoon: PermitAlertSummary[]; pendingStale: PermitAlertSummary[] }) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {expiringSoon.length > 0 && (
        <AlertList
          tone="amber"
          icon={<AlertTriangle className="h-5 w-5" />}
          title={`${expiringSoon.length} permit${expiringSoon.length === 1 ? '' : 's'} expiring soon`}
          subtitle="Less than 2 hours left — confirm task complete and cancel."
          rows={expiringSoon.slice(0, 3).map(p => ({
            href:  `/confined-spaces/${encodeURIComponent(p.spaceId)}/permits/${p.id}`,
            label: p.serial,
            sub:   `${p.spaceId} · ${p.minutes} min left`,
          }))}
        />
      )}
      {pendingStale.length > 0 && (
        <AlertList
          tone="slate"
          icon={<FileText className="h-5 w-5" />}
          title={`${pendingStale.length} draft${pendingStale.length === 1 ? '' : 's'} pending signature`}
          subtitle="Open >2 hours — sign or abandon so the audit trail stays clean."
          rows={pendingStale.slice(0, 3).map(p => ({
            href:  `/confined-spaces/${encodeURIComponent(p.spaceId)}/permits/${p.id}`,
            label: p.serial,
            sub:   `${p.spaceId} · ${humanizeMinutes(p.minutes)} old`,
          }))}
        />
      )}
    </section>
  )
}

function AlertList({
  tone, icon, title, subtitle, rows,
}: {
  tone:     'amber' | 'slate'
  icon:     React.ReactNode
  title:    string
  subtitle: string
  rows:     Array<{ href: string; label: string; sub: string }>
}) {
  const toneCls = tone === 'amber'
    ? 'bg-amber-50 border-amber-200 text-amber-900'
    : 'bg-slate-50 border-slate-200 text-slate-800'
  return (
    <div className={`rounded-xl border ${toneCls} p-4 space-y-3`}>
      <header className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">{title}</p>
          <p className="text-[11px] opacity-80">{subtitle}</p>
        </div>
      </header>
      <ul className="space-y-1">
        {rows.map(r => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="flex items-center justify-between gap-2 text-xs bg-white/70 hover:bg-white rounded-md px-2 py-1.5 transition-colors"
            >
              <span className="font-mono font-semibold tracking-wider truncate">{r.label}</span>
              <span className="text-[11px] opacity-70 truncate">{r.sub}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function humanizeMinutes(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// ── Quick actions ─────────────────────────────────────────────────────────

function QuickActions() {
  // 3 most common workflows. Sized for an iPad on a stand — 44pt+ tap
  // targets, big icons. Keep to 3 so each tile gets 33% of the row.
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <QuickAction
        href="/confined-spaces"
        icon={<FileText className="h-6 w-6" />}
        label="Issue Permit"
        sub="Confined-space entry"
      />
      <QuickAction
        href="/loto"
        icon={<Plus className="h-6 w-6" />}
        label="Add Equipment"
        sub="LOTO inventory"
      />
      <QuickAction
        href="/loto"
        icon={<Camera className="h-6 w-6" />}
        label="Take Photo"
        sub="Pick equipment first"
      />
    </section>
  )
}

function QuickAction({ href, icon, label, sub }: { href: string; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="bg-white border border-slate-200 hover:border-brand-navy hover:shadow-sm rounded-xl px-4 py-4 flex items-center gap-3 transition-all group"
    >
      <div className="shrink-0 w-11 h-11 rounded-lg bg-brand-navy/5 group-hover:bg-brand-navy/10 text-brand-navy flex items-center justify-center transition-colors">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-900 group-hover:text-brand-navy transition-colors">{label}</p>
        <p className="text-[11px] text-slate-500">{sub}</p>
      </div>
    </Link>
  )
}

// ── KPI tiles — at-a-glance counts ────────────────────────────────────────

function KpiRow({ metrics, error }: { metrics: HomeMetrics | null; error: string | null }) {
  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
        Couldn't load live metrics: {error}. Check your connection or that migrations 009-011 are applied.
      </div>
    )
  }
  const loading = metrics === null
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Kpi
        label="Permits Active"
        value={loading ? '—' : metrics.activePermitCount}
        href="/confined-spaces/status"
        tone={loading ? 'neutral' : metrics.activePermitCount > 0 ? 'safe' : 'neutral'}
      />
      <Kpi
        label="People In Spaces"
        value={loading ? '—' : metrics.peopleInSpaces}
        href="/confined-spaces/status"
        tone="neutral"
      />
      <Kpi
        label="LOTO Equipment"
        value={loading ? '—' : metrics.totalEquipment}
        href="/loto"
        tone="neutral"
      />
      <Kpi
        label="Photo Coverage"
        value={loading ? '—' : `${metrics.photoCompletionPct}%`}
        href="/loto"
        tone={loading ? 'neutral' : metrics.photoCompletionPct >= 90 ? 'safe' : metrics.photoCompletionPct >= 70 ? 'warning' : 'critical'}
      />
    </section>
  )
}

function Kpi({ label, value, href, tone }: {
  label: string
  value: string | number
  href:  string
  tone:  'safe' | 'warning' | 'critical' | 'neutral'
}) {
  const cls =
    tone === 'critical' ? 'bg-rose-50 border-rose-200'
  : tone === 'warning'  ? 'bg-amber-50 border-amber-200'
  : tone === 'safe'     ? 'bg-emerald-50 border-emerald-200'
  :                       'bg-white border-slate-200'

  const valueCls =
    tone === 'critical' ? 'text-rose-700'
  : tone === 'warning'  ? 'text-amber-700'
  : tone === 'safe'     ? 'text-emerald-700'
  :                       'text-slate-900'

  return (
    <Link href={href} className={`block rounded-xl border ${cls} p-4 hover:shadow-sm transition-shadow`}>
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`text-3xl font-black tabular-nums mt-1 ${valueCls}`}>{value}</p>
    </Link>
  )
}

// ── Active Permits panel ──────────────────────────────────────────────────

function ActivePermitsPanel({ permits, now }: { permits: ActivePermitSummary[] | null; now: Date }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-slate-900">Active Permits</h2>
        <Link href="/confined-spaces/status" className="text-[11px] font-semibold text-brand-navy hover:underline">
          View all →
        </Link>
      </header>
      {permits === null ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : permits.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-slate-500">No active permits.</p>
          <p className="text-[11px] text-slate-400 mt-1">Issue one from the Confined Spaces module.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {permits.map(p => <ActivePermitRow key={p.id} permit={p} now={now} />)}
        </ul>
      )}
    </section>
  )
}

function ActivePermitRow({ permit, now }: { permit: ActivePermitSummary; now: Date }) {
  // Live countdown — recomputed on every parent render (1Hz from the home
  // clock tick).
  const c = permitCountdown({ expires_at: permit.expiresAt }, now.getTime())
  const timerCls: Record<CountdownTone, string> = {
    safe:     'text-emerald-700',
    warning:  'text-amber-700',
    critical: 'text-rose-700',
    expired:  'text-rose-700',
  }
  return (
    <li className="py-2.5">
      <Link
        href={`/confined-spaces/${encodeURIComponent(permit.spaceId)}/permits/${permit.id}`}
        className="block hover:bg-slate-50 -mx-2 px-2 py-1 rounded-lg transition-colors"
      >
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold tracking-wider text-slate-700">{permit.serial}</p>
            <p className="text-sm font-semibold text-slate-900 truncate">
              {permit.spaceId}
              {permit.spaceDescription && <span className="text-slate-500 font-normal"> · {permit.spaceDescription}</span>}
            </p>
          </div>
          <p className={`text-lg font-black font-mono tabular-nums ${timerCls[c.tone]}`}>{c.label}</p>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          {permit.entrants.length === 0
            ? 'No entrants recorded'
            : <>{permit.entrants.length} entrant{permit.entrants.length === 1 ? '' : 's'}: {permit.entrants.join(', ')}</>}
          {permit.attendants.length > 0 && (
            <> · attendant: {permit.attendants.join(', ')}</>
          )}
        </p>
      </Link>
    </li>
  )
}

// ── Recent Activity feed ──────────────────────────────────────────────────

function RecentActivityPanel({ events }: { events: ActivityEvent[] | null }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-bold text-slate-900">Recent Activity</h2>
      {events === null ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : events.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-slate-500">No recent activity.</p>
          <p className="text-[11px] text-slate-400 mt-1">
            Audit log is admin-only — non-admins won't see entries here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map(e => <ActivityRow key={e.id} event={e} />)}
        </ul>
      )}
    </section>
  )
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const time = new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const body = (
    <div className="flex items-baseline gap-3">
      <span className="text-[11px] font-mono font-semibold text-slate-400 tabular-nums shrink-0 w-12">{time}</span>
      <span className="text-sm text-slate-800 flex-1">{event.description}</span>
      {event.actorEmail && (
        <span className="text-[11px] text-slate-400 hidden sm:inline truncate max-w-[140px]">{event.actorEmail.split('@')[0]}</span>
      )}
    </div>
  )
  if (event.link) {
    return (
      <li>
        <Link href={event.link} className="block -mx-2 px-2 py-1 rounded-lg hover:bg-slate-50 transition-colors">
          {body}
        </Link>
      </li>
    )
  }
  return <li className="-mx-2 px-2 py-1">{body}</li>
}

// ── Coming-soon advert strip ──────────────────────────────────────────────

function ComingSoonStrip() {
  const upcoming = getModules('safety').filter(m => m.comingSoon)
  if (upcoming.length === 0) return null
  return (
    <section className="rounded-xl border border-dashed border-violet-200 bg-violet-50/40 p-4 space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-widest text-violet-800">Coming Soon</p>
      <div className="flex flex-wrap gap-3">
        {upcoming.map(m => (
          <div key={m.id} className="flex-1 min-w-[200px]">
            <p className="text-sm font-semibold text-slate-800">{m.name}</p>
            <p className="text-[11px] text-slate-500 leading-snug">{m.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Module navigation grid ────────────────────────────────────────────────

function ModulesGrid() {
  const modules = getModules('safety').filter(m => !m.comingSoon)
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold text-slate-900">Modules</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {modules.map(m => (
          <Link
            key={m.id}
            href={m.href!}
            className="bg-white border border-slate-200 rounded-xl p-4 hover:border-brand-navy hover:shadow-sm transition-all group"
          >
            <p className="text-base font-bold text-slate-900 group-hover:text-brand-navy transition-colors">{m.name}</p>
            <p className="text-[11px] text-slate-500 mt-1 leading-snug">{m.description}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
