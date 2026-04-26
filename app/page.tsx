'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, MapPin, Sun, Wind } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { timeOfDayGreeting } from '@/components/Greeting'
import { getModules, getChildren } from '@/lib/features'
import { permitCountdown } from '@/lib/permitStatus'
import type { ConfinedSpacePermit } from '@/lib/types'

// Home screen — the landing page after login. Replaces the old LOTO
// dashboard (which moved to /loto). The job here is orientation: greet
// the user, anchor them in time/place, surface today's safety state at
// a glance, and route them into a module.
//
// All numbers are real reads against the live tables. Coming-soon
// modules render a "—" with a Coming Soon pill rather than fake data,
// so the demo accurately advertises what ships when we connect the
// near-miss / hot-work / JHA flows.

const WEATHER_FETCH_MS = 30 * 60 * 1000   // refresh every 30 min
const CLOCK_TICK_MS    = 30 * 1000        // 30s clock update is plenty for a home screen

interface Weather {
  temperatureF: number
  windMph:      number
  code:         number
  fetchedAt:    number
}

interface SafetyMetrics {
  activePermits:  number
  peopleInSpaces: number
  expiredPermits: number
  totalEquipment: number
  loading:        boolean
}

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

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <Hero greeting={greeting} firstName={firstName} dateLabel={dateLabel} timeLabel={timeLabel} />
      <SafetyMetricsRow />
      <ModulesGrid />
      <ComingSoonStrip />
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

// ── Weather card — Open-Meteo (no API key needed) ─────────────────────────

function WeatherCard() {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [locationName, setLocationName] = useState<string | null>(null)
  const [weather, setWeather] = useState<Weather | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Geolocation — ask once, fall back gracefully if denied. We don't
  // store the coords; if the user revokes permission later, the next
  // mount just shows the no-location fallback again.
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('Location not available on this device')
      return
    }
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

  // Reverse-geocode for a friendly location name. Open-Meteo also has a
  // separate geocoding endpoint but BigDataCloud's reverse is free + no
  // key for the locality tier.
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
        else if (city) setLocationName(city)
      })
      .catch(() => { /* ignore — we'll just skip the location label */ })
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
        {locationName && (
          <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {locationName}</span>
        )}
      </div>
    </div>
  )
}

// WMO weather code to icon + short label. The Open-Meteo docs list the
// full table; we collapse to the buckets a user would actually distinguish
// at a glance.
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

// ── Safety metrics — real reads ───────────────────────────────────────────

function SafetyMetricsRow() {
  const [m, setM] = useState<SafetyMetrics>({
    activePermits: 0, peopleInSpaces: 0, expiredPermits: 0, totalEquipment: 0, loading: true,
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [permitRes, equipRes] = await Promise.all([
        supabase
          .from('loto_confined_space_permits')
          .select('expires_at, canceled_at, entry_supervisor_signature_at, entrants')
          .is('canceled_at', null)
          .not('entry_supervisor_signature_at', 'is', null),
        supabase
          .from('loto_equipment')
          .select('equipment_id', { count: 'exact', head: true })
          .eq('decommissioned', false),
      ])

      if (cancelled) return

      const permits = (permitRes.data ?? []) as Pick<ConfinedSpacePermit, 'expires_at' | 'canceled_at' | 'entry_supervisor_signature_at' | 'entrants'>[]
      const nowMs = Date.now()
      let active = 0, people = 0, expired = 0
      for (const p of permits) {
        const c = permitCountdown(p, nowMs)
        if (c.expired) {
          expired += 1
        } else {
          active += 1
          people += p.entrants.length
        }
      }

      setM({
        activePermits:  active,
        peopleInSpaces: people,
        expiredPermits: expired,
        totalEquipment: equipRes.count ?? 0,
        loading:        false,
      })
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-bold text-slate-900">Today's safety</h2>
        <p className="text-[11px] text-slate-400">Real-time</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric
          label="Permits Active"
          value={m.loading ? '—' : String(m.activePermits)}
          tone={m.activePermits > 0 ? 'safe' : 'neutral'}
          href="/confined-spaces/status"
        />
        <Metric
          label="People In Spaces"
          value={m.loading ? '—' : String(m.peopleInSpaces)}
          tone="neutral"
          href="/confined-spaces/status"
        />
        <Metric
          label="Expired — Verify Evac"
          value={m.loading ? '—' : String(m.expiredPermits)}
          tone={m.expiredPermits > 0 ? 'critical' : 'neutral'}
          href="/confined-spaces/status"
        />
        <Metric
          label="LOTO Equipment"
          value={m.loading ? '—' : String(m.totalEquipment)}
          tone="neutral"
          href="/loto"
        />
      </div>

      {/* Coming-soon metrics — surfaced so the home looks complete on demo
          day but accurately marked as not-yet-live. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Metric label="Near-Miss Reports"  value="—" tone="coming" comingSoon />
        <Metric label="Open Hot-Work Permits" value="—" tone="coming" comingSoon />
        <Metric label="Open JHAs"          value="—" tone="coming" comingSoon />
      </div>
    </section>
  )
}

function Metric({
  label, value, tone, href, comingSoon,
}: {
  label:       string
  value:       string
  tone:        'safe' | 'critical' | 'neutral' | 'coming'
  href?:       string
  comingSoon?: boolean
}) {
  const cls =
    tone === 'critical' ? 'bg-rose-50 border-rose-200'
  : tone === 'safe'     ? 'bg-emerald-50 border-emerald-200'
  : tone === 'coming'   ? 'bg-slate-50 border-dashed border-slate-300'
  :                       'bg-white border-slate-200'

  const valueCls =
    tone === 'critical' ? 'text-rose-700'
  : tone === 'safe'     ? 'text-emerald-700'
  : tone === 'coming'   ? 'text-slate-400'
  :                       'text-slate-900'

  const inner = (
    <>
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
        {label}
        {comingSoon && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800">
            Soon
          </span>
        )}
      </p>
      <p className={`text-3xl font-black tabular-nums mt-1 ${valueCls}`}>{value}</p>
    </>
  )

  if (href && !comingSoon) {
    return (
      <Link href={href} className={`rounded-xl border ${cls} p-4 hover:shadow-sm transition-shadow block`}>
        {inner}
      </Link>
    )
  }

  return <div className={`rounded-xl border ${cls} p-4`}>{inner}</div>
}

// ── Module navigation tiles ────────────────────────────────────────────────

function ModulesGrid() {
  // Only "live" modules (skip Coming Soon — those have their own strip
  // below). getModules('safety') returns LOTO + Confined Spaces + the
  // three coming-soon entries; filter to clickable ones.
  const modules = getModules('safety').filter(m => !m.comingSoon)

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold text-slate-900">Jump in</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {modules.map(m => {
          const childCount = getChildren(m.id).length
          return (
            <Link
              key={m.id}
              href={m.href!}
              className="bg-white border border-slate-200 rounded-xl p-5 hover:border-brand-navy hover:shadow-md transition-all group"
            >
              <p className="text-lg font-bold text-slate-900 group-hover:text-brand-navy transition-colors">{m.name}</p>
              <p className="text-xs text-slate-500 mt-1 leading-snug">{m.description}</p>
              {childCount > 0 && (
                <p className="text-[11px] text-slate-400 mt-3">
                  {childCount} sub-page{childCount === 1 ? '' : 's'} →
                </p>
              )}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

// ── Coming-soon strip ──────────────────────────────────────────────────────

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

