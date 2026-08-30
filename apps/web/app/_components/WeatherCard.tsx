'use client'

import { useCallback, useEffect, useState } from 'react'
import { MapPin, Wind } from 'lucide-react'
import { AnimatedWeatherIcon } from './AnimatedWeatherIcon'

// Browser-side weather card. Two free, no-key APIs:
//   - Open-Meteo for the actual reading (temperature / wind / weather code)
//   - BigDataCloud for reverse-geocoding lat/lon → city, state
// Both have generous free tiers and CORS enabled. Coordinates come from
// navigator.geolocation; if denied we render a "permission" card and
// stop. Weather refetches every 30 min — anything more frequent burns
// the user's battery without a real-world benefit.

const WEATHER_FETCH_MS = 30 * 60 * 1000

interface Weather {
  temperatureF: number
  windMph:      number
  code:         number
  fetchedAt:    number
}

export function WeatherCard() {
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
      .catch(err => {
        // Reverse-geocode is purely cosmetic — failure just hides the
        // city/state line. Log so we notice if BigDataCloud's free tier
        // gets throttled, but don't surface it to the user.
        console.warn('[home] reverse geocode failed', err)
      })
  }, [coords])

  useEffect(() => {
    fetchWeather()
    if (!coords) return
    const id = setInterval(fetchWeather, WEATHER_FETCH_MS)
    return () => clearInterval(id)
  }, [coords, fetchWeather])

  if (error && !weather) {
    return (
      <div className="bg-white/10 dark:bg-slate-900/10 backdrop-blur-sm rounded-xl p-4 min-w-[200px]">
        <p className="text-xs text-white/60 uppercase tracking-widest font-bold">Weather</p>
        <p className="text-sm text-white/80 mt-1">{error}</p>
      </div>
    )
  }
  if (!weather) {
    return (
      <div className="bg-white/10 dark:bg-slate-900/10 backdrop-blur-sm rounded-xl p-4 min-w-[200px]">
        <p className="text-xs text-white/60 uppercase tracking-widest font-bold">Weather</p>
        <p className="text-sm text-white/80 mt-1">Loading…</p>
      </div>
    )
  }

  const label = weatherLabelForCode(weather.code)
  return (
    <div className="bg-white/10 dark:bg-slate-900/10 backdrop-blur-sm rounded-xl p-4 min-w-[200px]">
      <div className="flex items-center gap-3">
        <AnimatedWeatherIcon code={weather.code} className="h-10 w-10 text-brand-yellow shrink-0" />
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

// The human-readable condition. Finer-grained than the glyph on purpose:
// "Drizzle", "Rain", and "Showers" all draw as falling drops, so the word is
// what carries the distinction. Glyph selection lives in AnimatedWeatherIcon.
export function weatherLabelForCode(code: number): string {
  if (code === 0)                 return 'Clear'
  if (code <= 3)                  return 'Partly cloudy'
  if (code === 45 || code === 48) return 'Fog'
  if (code >= 51 && code <= 57)   return 'Drizzle'
  if (code >= 61 && code <= 67)   return 'Rain'
  if (code >= 71 && code <= 77)   return 'Snow'
  if (code >= 80 && code <= 82)   return 'Showers'
  if (code >= 85 && code <= 86)   return 'Snow showers'
  if (code >= 95)                 return 'Thunderstorm'
  return 'Cloudy'
}
